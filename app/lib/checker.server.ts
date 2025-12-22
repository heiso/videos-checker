import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import {
  claimNextPendingJob,
  createJobs,
  deletePendingAndProcessingJobs,
  getJobStats,
  updateFileDuration,
  updateJobStatus,
  type CheckMode,
  type FileRecord,
} from './db.server'
import { emitFileEvent } from './events.server'
import {
  appendWorkerOutput,
  clearWorkers,
  initWorker,
  setWorkerFile,
  stopWorker,
} from './logs.server'

const DEFAULT_CONCURRENCY = Math.max(1, Math.floor(availableParallelism() * 0.75))

// Track running state per mode
const runningModes = new Set<CheckMode>()
const activeWorkersByMode = new Map<CheckMode, number>()
let workerIdCounter = 0
let checkStartTime: number | null = null
let checkEndTime: number | null = null

function getCheckCommand(mode: CheckMode, filePath: string): { cmd: string; args: string[] } {
  if (mode === 'full') {
    return {
      cmd: 'ffmpeg',
      args: ['-v', 'error', '-i', filePath, '-f', 'null', '-'],
    }
  }
  // ffprobe -v error -show_error -show_entries formatduration -of defaultnoprint_wrappers=1 -sexagesimal
  return {
    cmd: 'ffprobe',
    args: [
      '-v',
      'error',
      '-show_error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1',
      '-sexagesimal',
      filePath,
    ],
  }
}

function parseDuration(stdout: string): string | undefined {
  const match = stdout.match(/duration=(\d+):(\d{2}):(\d{2})\.\d+/)
  if (match) {
    const hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    const seconds = parseInt(match[3], 10)
    const totalMinutes = hours * 60 + minutes
    return `${totalMinutes}:${seconds.toString().padStart(2, '0')}`
  }
  return undefined
}

function runCommand(
  cmd: string,
  args: string[],
  workerId: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    appendWorkerOutput(workerId, 'stdout', `${cmd} ${args.join(' ')}\n`)
    const proc = spawn(cmd, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      const output = data.toString()
      stdout += output
      appendWorkerOutput(workerId, 'stdout', output)
    })

    proc.stderr.on('data', (data: Buffer) => {
      const output = data.toString()
      stderr += output
      appendWorkerOutput(workerId, 'stderr', output)
    })

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })

    proc.on('error', (err) => {
      appendWorkerOutput(workerId, 'stderr', `Failed to spawn ${cmd}: ${err.message}\n`)
      resolve({ code: 1, stdout: '', stderr: `Failed to spawn ${cmd}: ${err.message}` })
    })
  })
}

export async function checkFile(
  file: FileRecord,
  workerId: number,
  mode: CheckMode,
): Promise<{ success: boolean; error?: string; duration?: string }> {
  // For quick mode, ffprobe outputs duration to stdout
  // For full mode, we first get duration via ffprobe, then run ffmpeg check
  let duration: string | undefined

  if (mode === 'full') {
    const durationArgs = [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1',
      '-sexagesimal',
      file.path,
    ]
    const durationResult = await runCommand('ffprobe', durationArgs, workerId)
    duration = parseDuration(durationResult.stdout)
  }

  const { cmd, args } = getCheckCommand(mode, file.path)
  const result = await runCommand(cmd, args, workerId)

  if (mode === 'quick') {
    duration = parseDuration(result.stdout)
  }

  if (result.code !== 0 || result.stderr.trim().length > 0) {
    return {
      success: false,
      error: result.stderr.trim() || `${cmd} exited with code ${result.code}`,
      duration,
    }
  }

  return { success: true, duration }
}

async function worker(workerId: number, mode: CheckMode): Promise<void> {
  const currentCount = activeWorkersByMode.get(mode) || 0
  activeWorkersByMode.set(mode, currentCount + 1)
  initWorker(workerId)

  try {
    while (runningModes.has(mode)) {
      const result = claimNextPendingJob(mode)

      if (!result) {
        break
      }

      const { job, file } = result
      setWorkerFile(workerId, file.path)

      emitFileEvent({
        type: 'job_update',
        jobId: job.id,
        fileId: file.id,
        mode,
        status: 'processing',
      })

      const checkResult = await checkFile(file, workerId, mode)

      // Check if we were stopped - if so, don't update the job (it was already reset to pending)
      if (!runningModes.has(mode)) {
        break
      }

      if (checkResult.duration) {
        updateFileDuration(file.id, checkResult.duration)
      }

      if (checkResult.success) {
        updateJobStatus(job.id, 'completed', undefined, checkResult.duration)
        emitFileEvent({
          type: 'job_update',
          jobId: job.id,
          fileId: file.id,
          mode,
          status: 'completed',
        })
      } else {
        updateJobStatus(job.id, 'error', checkResult.error, checkResult.duration)
        emitFileEvent({
          type: 'job_update',
          jobId: job.id,
          fileId: file.id,
          mode,
          status: 'error',
          errorMessage: checkResult.error,
        })
      }
    }
  } finally {
    const count = activeWorkersByMode.get(mode) || 1
    activeWorkersByMode.set(mode, count - 1)
    stopWorker(workerId)

    if ((activeWorkersByMode.get(mode) || 0) === 0) {
      runningModes.delete(mode)

      if (runningModes.size === 0) {
        checkEndTime = Date.now()
        emitFileEvent({
          type: 'check_complete',
          stats: getJobStats(),
        })
      }
    }
  }
}

export function startChecking(
  mode: CheckMode,
  fileIds: number[],
  concurrency: number = DEFAULT_CONCURRENCY,
): boolean {
  if (runningModes.has(mode)) {
    return false
  }

  if (fileIds.length === 0) {
    return false
  }

  // Create job entries for each file
  createJobs(fileIds, mode)

  runningModes.add(mode)

  if (runningModes.size === 1) {
    checkStartTime = Date.now()
    checkEndTime = null
    clearWorkers()
    workerIdCounter = 0
  }

  for (let i = 0; i < concurrency; i++) {
    worker(++workerIdCounter, mode)
  }

  return true
}

export function isCheckerRunning(mode?: CheckMode): boolean {
  if (mode) {
    return runningModes.has(mode)
  }
  return runningModes.size > 0
}

export function getActiveWorkers(mode?: CheckMode): number {
  if (mode) {
    return activeWorkersByMode.get(mode) || 0
  }
  let total = 0
  for (const count of activeWorkersByMode.values()) {
    total += count
  }
  return total
}

export function getRunningModes(): CheckMode[] {
  return Array.from(runningModes)
}

export function getCheckTiming(): { startTime: number | null; endTime: number | null } {
  return { startTime: checkStartTime, endTime: checkEndTime }
}

export function stopChecking(mode?: CheckMode): void {
  if (mode) {
    runningModes.delete(mode)
    deletePendingAndProcessingJobs(mode)
  } else {
    runningModes.clear()
    deletePendingAndProcessingJobs()
  }

  // Emit event to update UI
  emitFileEvent({
    type: 'check_complete',
    stats: getJobStats(),
  })
}

import { EventEmitter } from 'node:events'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || '.'
const LOGS_DIR = path.join(DATA_DIR, 'logs')

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true })
}

export const workerEvents = new EventEmitter()
workerEvents.setMaxListeners(100)

export interface LogLine {
  time: string
  stream: 'stdout' | 'stderr'
  data: string
}

export interface WorkerOutput {
  workerId: number
  line: LogLine
}

export interface WorkerState {
  workerId: number
  status: 'running' | 'stopped'
}

const workerStatus = new Map<number, { currentFile?: string; status: 'running' | 'stopped' }>()

function getLogFilePath(workerId: number): string {
  return path.join(LOGS_DIR, `worker-${workerId}.log`)
}

function formatLogLine(line: LogLine): string {
  return `${line.time} [${line.stream}] ${line.data}`
}

function parseLogLine(raw: string): LogLine | null {
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \[(stdout|stderr)\] (.*)$/,
  )
  if (match) {
    return {
      time: match[1],
      stream: match[2] as 'stdout' | 'stderr',
      data: match[3],
    }
  }
  return null
}

function readWorkerLogs(workerId: number): LogLine[] {
  const filePath = getLogFilePath(workerId)
  if (!existsSync(filePath)) {
    return []
  }
  const content = readFileSync(filePath, 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map(parseLogLine)
    .filter((line): line is LogLine => line !== null)
}

export function initWorker(workerId: number): void {
  // Clear previous log file for this worker
  const filePath = getLogFilePath(workerId)
  writeFileSync(filePath, '')
  workerStatus.set(workerId, { status: 'running' })
  workerEvents.emit('state', { workerId, status: 'running' } as WorkerState)
}

export function appendWorkerOutput(
  workerId: number,
  stream: 'stdout' | 'stderr',
  data: string,
): void {
  const worker = workerStatus.get(workerId)
  if (worker) {
    const line: LogLine = {
      time: new Date().toISOString(),
      stream,
      data,
    }
    // Append to file
    const filePath = getLogFilePath(workerId)
    appendFileSync(filePath, formatLogLine(line) + '\n')
    workerEvents.emit('output', { workerId, line } as WorkerOutput)
  }
}

export function setWorkerFile(workerId: number, filePath: string): void {
  const worker = workerStatus.get(workerId)
  if (worker) {
    worker.currentFile = filePath
    workerEvents.emit('file', { workerId, filePath })
  }
}

export function stopWorker(workerId: number): void {
  const worker = workerStatus.get(workerId)
  if (worker) {
    worker.status = 'stopped'
    worker.currentFile = undefined
  }
  workerEvents.emit('state', { workerId, status: 'stopped' } as WorkerState)
}

export function clearWorkers(): void {
  workerStatus.clear()
  // Clear all log files
  if (existsSync(LOGS_DIR)) {
    const files = readdirSync(LOGS_DIR)
    for (const file of files) {
      if (file.startsWith('worker-') && file.endsWith('.log')) {
        rmSync(path.join(LOGS_DIR, file))
      }
    }
  }
  workerEvents.emit('clear')
}

export function getWorkerOutputs(): Map<
  number,
  { logs: LogLine[]; currentFile?: string; status: 'running' | 'stopped' }
> {
  const result = new Map<
    number,
    { logs: LogLine[]; currentFile?: string; status: 'running' | 'stopped' }
  >()

  // Read all worker log files
  if (existsSync(LOGS_DIR)) {
    const files = readdirSync(LOGS_DIR)
    for (const file of files) {
      const match = file.match(/^worker-(\d+)\.log$/)
      if (match) {
        const workerId = parseInt(match[1], 10)
        const logs = readWorkerLogs(workerId)
        const status = workerStatus.get(workerId) || { status: 'stopped' as const }
        result.set(workerId, { logs, ...status })
      }
    }
  }

  return result
}

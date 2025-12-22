import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Form, Link, useLoaderData, useRevalidator } from 'react-router'
import { getCheckTiming, getRunningModes, isCheckerRunning } from '../lib/checker.server'
import { getAllFilesWithJobs, getFileStats, getJobStats, type FileWithJobs } from '../lib/db.server'

export async function loader() {
  const files = getAllFilesWithJobs()
  const jobStats = getJobStats()
  const fileStats = getFileStats()
  const isRunning = isCheckerRunning()
  const runningModes = getRunningModes()
  const timing = getCheckTiming()

  return { files, jobStats, fileStats, isRunning, runningModes, timing }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

function parseDurationToSeconds(duration: string | null): number | null {
  if (!duration) return null
  const parts = duration.split(':')
  if (parts.length !== 2) return null
  const minutes = parseInt(parts[0], 10)
  const seconds = parseInt(parts[1], 10)
  if (isNaN(minutes) || isNaN(seconds)) return null
  return minutes * 60 + seconds
}

// Tree structure types
interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  files: FileWithJobs[]
}

interface FolderStats {
  total: number
  pending: number
  processing: number
  completed: number
  error: number
}

function buildFileTree(files: FileWithJobs[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), files: [] }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let current = root

    // Navigate/create folder structure
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: '/' + parts.slice(0, i + 1).join('/'),
          children: new Map(),
          files: [],
        })
      }
      current = current.children.get(part)!
    }

    // Add file to current folder
    current.files.push(file)
  }

  return root
}

function getFolderStats(node: TreeNode): FolderStats {
  const stats: FolderStats = { total: 0, pending: 0, processing: 0, completed: 0, error: 0 }

  // Count jobs in this folder's files
  for (const file of node.files) {
    for (const job of file.jobs) {
      stats.total++
      if (job.status === 'pending') stats.pending++
      else if (job.status === 'processing') stats.processing++
      else if (job.status === 'completed') stats.completed++
      else if (job.status === 'error') stats.error++
    }
  }

  // Recursively count children
  for (const child of node.children.values()) {
    const childStats = getFolderStats(child)
    stats.total += childStats.total
    stats.pending += childStats.pending
    stats.processing += childStats.processing
    stats.completed += childStats.completed
    stats.error += childStats.error
  }

  return stats
}

function hasProcessingJob(file: FileWithJobs): boolean {
  return file.jobs.some((j) => j.status === 'processing')
}

function getSelectableFileIds(node: TreeNode): number[] {
  const ids: number[] = []
  for (const file of node.files) {
    if (!hasProcessingJob(file)) {
      ids.push(file.id)
    }
  }
  for (const child of node.children.values()) {
    ids.push(...getSelectableFileIds(child))
  }
  return ids
}

interface FolderRowProps {
  node: TreeNode
  depth: number
  selectedIds: Set<number>
  onToggleFolder: (ids: number[]) => void
  onToggleFile: (id: number) => void
  onShowError: (file: FileWithJobs) => void
  disabled: boolean
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  fileDeviations: Map<number, number>
}

function FolderRow({
  node,
  depth,
  selectedIds,
  onToggleFolder,
  onToggleFile,
  onShowError,
  disabled,
  expandedPaths,
  onToggleExpand,
  fileDeviations,
}: FolderRowProps) {
  const stats = getFolderStats(node)
  const selectableIds = getSelectableFileIds(node)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const someSelected = selectableIds.some((id) => selectedIds.has(id))
  const isExpanded = expandedPaths.has(node.path)

  const sortedChildren = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const sortedFiles = [...node.files].sort((a, b) => a.filename.localeCompare(b.filename))

  return (
    <>
      {/* Folder row */}
      {node.name && (
        <div
          className="flex items-center gap-2 py-2 px-3 hover:bg-gray-800 border-b border-gray-700 cursor-pointer"
          onClick={(e) => {
            // Don't toggle if clicking on checkbox
            if ((e.target as HTMLElement).tagName !== 'INPUT') {
              onToggleExpand(node.path)
            }
          }}
        >
          <div style={{ width: depth * 20 }} />
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected
            }}
            onChange={() => onToggleFolder(selectableIds)}
            disabled={disabled || selectableIds.length === 0}
            className="w-4 h-4 rounded bg-gray-700 border-gray-600 disabled:opacity-50"
          />
          <span className="text-gray-400 w-5">{isExpanded ? '▼' : '▶'}</span>
          <span className="font-medium text-gray-200">{node.name}/</span>
          <div className="flex gap-2 ml-auto text-xs">
            {stats.completed > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-green-600/30 text-green-400">
                {stats.completed}
              </span>
            )}
            {stats.error > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-600/30 text-red-400">
                {stats.error}
              </span>
            )}
            {stats.processing > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-400 animate-pulse">
                {stats.processing}
              </span>
            )}
            {stats.pending > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-600/30 text-yellow-400">
                {stats.pending}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Children (if expanded or root) */}
      {(isExpanded || !node.name) && (
        <>
          {sortedChildren.map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={node.name ? depth + 1 : depth}
              selectedIds={selectedIds}
              onToggleFolder={onToggleFolder}
              onToggleFile={onToggleFile}
              onShowError={onShowError}
              disabled={disabled}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              fileDeviations={fileDeviations}
            />
          ))}
          {sortedFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              depth={node.name ? depth + 1 : depth}
              selected={selectedIds.has(file.id)}
              onToggle={onToggleFile}
              onShowError={onShowError}
              disabled={disabled}
              deviation={fileDeviations.get(file.id)}
            />
          ))}
        </>
      )}
    </>
  )
}

interface FileRowProps {
  file: FileWithJobs
  depth: number
  selected: boolean
  onToggle: (id: number) => void
  onShowError: (file: FileWithJobs) => void
  disabled: boolean
  deviation?: number
}

function FileRow({
  file,
  depth,
  selected,
  onToggle,
  onShowError,
  disabled,
  deviation,
}: FileRowProps) {
  const canSelect = !hasProcessingJob(file)
  const hasError = file.jobs.some((j) => j.status === 'error')

  // Compute job stats for this file
  const jobStats = useMemo(() => {
    const stats = { pending: 0, processing: 0, completed: 0, error: 0 }
    for (const job of file.jobs) {
      if (job.status === 'pending') stats.pending++
      else if (job.status === 'processing') stats.processing++
      else if (job.status === 'completed') stats.completed++
      else if (job.status === 'error') stats.error++
    }
    return stats
  }, [file.jobs])

  // Compute duration display
  const absDeviation = deviation !== undefined ? Math.abs(deviation) : 0
  const isAnomaly = absDeviation > 0.1
  let arrowColor = 'rgb(107, 114, 128)'
  let arrow = '▲'
  if (isAnomaly && deviation !== undefined) {
    const t = Math.min(1, absDeviation)
    if (deviation > 0) {
      arrow = '▲'
      const r = Math.round(107 + (248 - 107) * t)
      const g = Math.round(114 + (113 - 114) * t)
      const b = Math.round(128 + (113 - 128) * t)
      arrowColor = `rgb(${r}, ${g}, ${b})`
    } else {
      arrow = '▼'
      const r = Math.round(107 + (96 - 107) * t)
      const g = Math.round(114 + (165 - 114) * t)
      const b = Math.round(128 + (250 - 128) * t)
      arrowColor = `rgb(${r}, ${g}, ${b})`
    }
  }
  const durationMinutes = file.duration?.split(':')[0]

  return (
    <div
      className={`grid items-center gap-3 py-2 px-3 hover:bg-gray-800 border-b border-gray-700 ${hasError ? 'cursor-pointer' : ''}`}
      style={{ gridTemplateColumns: `${depth * 20}px auto 1rem 1fr auto auto` }}
      onClick={() => hasError && onShowError(file)}
    >
      <div />
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => {
          e.stopPropagation()
          onToggle(file.id)
        }}
        onClick={(e) => e.stopPropagation()}
        disabled={disabled || !canSelect}
        className="w-4 h-4 rounded bg-gray-700 border-gray-600 disabled:opacity-50"
      />
      <div />
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-sm text-gray-300 truncate">{file.filename}</span>
      </div>
      <div className="flex items-center gap-1 text-xs">
        {file.jobs.length === 0 && <span className="text-gray-500">no checks</span>}
        {jobStats.completed > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-green-600/30 text-green-400">
            {jobStats.completed}
          </span>
        )}
        {jobStats.error > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-red-600/30 text-red-400">{jobStats.error}</span>
        )}
        {jobStats.processing > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-400 animate-pulse">
            {jobStats.processing}
          </span>
        )}
        {jobStats.pending > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-yellow-600/30 text-yellow-400">
            {jobStats.pending}
          </span>
        )}
      </div>
      <span
        className="text-xs font-mono font-bold flex items-center gap-1 justify-end"
        title={
          isAnomaly
            ? `${deviation! > 0 ? '+' : ''}${Math.round(deviation! * 100)}% from folder median`
            : undefined
        }
      >
        <span
          className="text-sm"
          style={{ color: arrowColor, visibility: isAnomaly ? 'visible' : 'hidden' }}
        >
          {arrow}
        </span>
        {durationMinutes && <span className="text-gray-500">{durationMinutes}m</span>}
      </span>
    </div>
  )
}

function getCheckCommand(mode: string | null, filePath: string): string {
  if (mode === 'full') {
    return `ffmpeg -v error -i "${filePath}" -f null -`
  }
  return `ffprobe -v error -show_error -show_entries format=duration -of default=noprint_wrappers=1 -sexagesimal "${filePath}"`
}

function ErrorModal({ file, onClose }: { file: FileWithJobs | null; onClose: () => void }) {
  if (!file) return null

  const errorJobs = file.jobs.filter((j) => j.status === 'error')

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-red-400">Error Details</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white cursor-pointer text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="p-4 overflow-auto space-y-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">File</p>
            <p className="text-sm text-gray-300 font-mono break-all">{file.path}</p>
          </div>
          {errorJobs.map((job) => (
            <div key={job.id}>
              <div>
                <p className="text-xs text-gray-500 mb-1">{job.mode} Check Command</p>
                <pre className="bg-gray-900 p-3 rounded text-sm text-gray-300 whitespace-pre-wrap break-all select-all">
                  {getCheckCommand(job.mode, file.path)}
                </pre>
              </div>
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">{job.mode} Check Error</p>
                <pre className="bg-gray-900 p-3 rounded text-sm text-red-300 whitespace-pre-wrap break-all">
                  {job.error_message}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Get the overall status of a file based on its jobs
// Priority: processing > pending > error > completed
function getFileStatus(
  file: FileWithJobs,
): 'processing' | 'pending' | 'error' | 'completed' | null {
  if (file.jobs.length === 0) return null
  if (file.jobs.some((j) => j.status === 'processing')) return 'processing'
  if (file.jobs.some((j) => j.status === 'pending')) return 'pending'
  if (file.jobs.some((j) => j.status === 'error')) return 'error'
  if (file.jobs.some((j) => j.status === 'completed')) return 'completed'
  return null
}

export default function Index() {
  const { files, fileStats, isRunning, timing } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()
  const [path, setPath] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const revalidatorRef = useRef(revalidator)
  const throttleRef = useRef<NodeJS.Timeout | null>(null)
  const [elapsed, setElapsed] = useState<number>(0)
  const [errorFile, setErrorFile] = useState<FileWithJobs | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  // Compute file-based stats for progress bar
  // Selected files are removed from their current status and counted separately
  const fileBasedStats = useMemo(() => {
    const stats = { processing: 0, pending: 0, error: 0, completed: 0, selected: 0 }
    for (const file of files) {
      const status = getFileStatus(file)
      if (selectedIds.has(file.id) && status !== 'processing') {
        // Selected files (except processing) go to "selected" bucket
        stats.selected++
      } else if (status) {
        stats[status]++
      }
    }
    return stats
  }, [files, selectedIds])

  // Compute folder duration stats (median per folder)
  const folderDurationStats = useMemo(() => {
    const folderFiles = new Map<string, number[]>()

    for (const file of files) {
      const seconds = parseDurationToSeconds(file.duration)
      if (seconds === null) continue

      const folder = file.path.substring(0, file.path.lastIndexOf('/'))
      if (!folderFiles.has(folder)) {
        folderFiles.set(folder, [])
      }
      folderFiles.get(folder)!.push(seconds)
    }

    const stats = new Map<string, number>()
    for (const [folder, durations] of folderFiles) {
      if (durations.length < 2) continue
      durations.sort((a, b) => a - b)
      const mid = Math.floor(durations.length / 2)
      const median =
        durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2
      stats.set(folder, median)
    }

    return stats
  }, [files])

  // Calculate signed deviation for each file (positive = longer, negative = shorter)
  const fileDeviations = useMemo(() => {
    const deviations = new Map<number, number>()

    for (const file of files) {
      const seconds = parseDurationToSeconds(file.duration)
      if (seconds === null) continue

      const folder = file.path.substring(0, file.path.lastIndexOf('/'))
      const median = folderDurationStats.get(folder)
      if (median === undefined) continue

      const deviation = (seconds - median) / median
      deviations.set(file.id, deviation)
    }

    return deviations
  }, [files, folderDurationStats])

  // Build file tree
  const fileTree = buildFileTree(files)

  // Get selectable files (not processing)
  const selectableFiles = files.filter((f) => !hasProcessingJob(f))
  const allSelected =
    selectableFiles.length > 0 && selectableFiles.every((f) => selectedIds.has(f.id))
  const someSelected = selectableFiles.some((f) => selectedIds.has(f.id))

  // Keep ref up to date
  useEffect(() => {
    revalidatorRef.current = revalidator
  }, [revalidator])

  // Throttled revalidate function
  const throttledRevalidate = useCallback(() => {
    if (throttleRef.current) return

    revalidatorRef.current.revalidate()
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
    }, 500)
  }, [])

  // Subscribe to SSE for real-time updates
  useEffect(() => {
    const eventSource = new EventSource('/events')

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'check_complete') {
          // Force revalidation on completion, bypass throttle
          if (throttleRef.current) {
            clearTimeout(throttleRef.current)
            throttleRef.current = null
          }
          revalidatorRef.current.revalidate()
        } else if (data.type === 'status_change' || data.type === 'job_update') {
          throttledRevalidate()
        }
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
    }

    return () => {
      eventSource.close()
      if (throttleRef.current) {
        clearTimeout(throttleRef.current)
      }
    }
  }, [throttledRevalidate])

  // Clear selection when files change (after check completes)
  useEffect(() => {
    setSelectedIds((prev) => {
      // Keep selection for files that can still be selected
      const validIds = new Set(files.filter((f) => !hasProcessingJob(f)).map((f) => f.id))
      const newSelected = new Set<number>()
      prev.forEach((id) => {
        if (validIds.has(id)) newSelected.add(id)
      })
      return newSelected
    })
  }, [files])

  // Update elapsed time every second when running
  useEffect(() => {
    if (!timing.startTime) {
      setElapsed(0)
      return
    }

    const updateElapsed = () => {
      const endTime = timing.endTime || Date.now()
      setElapsed(endTime - timing.startTime!)
    }

    updateElapsed()

    if (isRunning) {
      const interval = setInterval(updateElapsed, 1000)
      return () => clearInterval(interval)
    }
  }, [timing.startTime, timing.endTime, isRunning])

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleFolderSelection = (ids: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allInFolder = ids.every((id) => next.has(id))
      if (allInFolder) {
        ids.forEach((id) => next.delete(id))
      } else {
        ids.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableFiles.map((f) => f.id)))
    }
  }

  const hasFiles = files.length > 0
  const hasSelection = selectedIds.size > 0

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Media Integrity Checker</h1>
          <p className="text-gray-400">Check video files for errors using ffprobe</p>
        </div>
        <Link
          to="/logs"
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium transition-colors"
        >
          View Logs
        </Link>
      </header>

      {/* Scan Form */}
      <section className="mb-8 p-6 bg-gray-800 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Scan Directory</h2>
        <Form method="post" action="/scan" className="flex gap-4">
          <input
            type="text"
            name="path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/videos"
            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors cursor-pointer"
          >
            Scan
          </button>
        </Form>
      </section>

      {/* Stats & Actions */}
      {hasFiles && (
        <section className="mb-6">
          <div className="flex items-center justify-end mb-3">
            <div className="flex gap-3">
              <Form method="post" action="/check" onSubmit={() => setSelectedIds(new Set())}>
                <input type="hidden" name="mode" value="quick" />
                <input type="hidden" name="fileIds" value={JSON.stringify([...selectedIds])} />
                <button
                  type="submit"
                  disabled={isRunning || !hasSelection}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition-colors cursor-pointer"
                >
                  {isRunning ? 'Checking...' : 'Quick Check'}
                </button>
              </Form>
              <Form method="post" action="/check" onSubmit={() => setSelectedIds(new Set())}>
                <input type="hidden" name="mode" value="full" />
                <input type="hidden" name="fileIds" value={JSON.stringify([...selectedIds])} />
                <button
                  type="submit"
                  disabled={isRunning || !hasSelection}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition-colors cursor-pointer"
                >
                  {isRunning ? 'Checking...' : 'Full Check'}
                </button>
              </Form>
              {isRunning && (
                <Form method="post" action="/stop">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors cursor-pointer"
                  >
                    Stop
                  </button>
                </Form>
              )}
              <a
                href="/export"
                download
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition-colors"
              >
                Export JSON
              </a>
              <Form method="post" action="/clear">
                <button
                  type="submit"
                  disabled={isRunning}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              </Form>
            </div>
          </div>

          {/* Progress Bar */}
          {fileStats.total > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-4 bg-gray-700 rounded-full overflow-hidden flex relative">
                <div
                  className="h-full bg-green-600 transition-all duration-300"
                  style={{ width: `${(fileBasedStats.completed / fileStats.total) * 100}%` }}
                />
                <div
                  className="h-full bg-red-600 transition-all duration-300"
                  style={{ width: `${(fileBasedStats.error / fileStats.total) * 100}%` }}
                />
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${(fileBasedStats.processing / fileStats.total) * 100}%` }}
                />
                <div
                  className="h-full bg-yellow-600 transition-all duration-300"
                  style={{ width: `${(fileBasedStats.pending / fileStats.total) * 100}%` }}
                />
                {/* Selected files (soon to be processed) */}
                {fileBasedStats.selected > 0 && (
                  <div
                    className="h-full bg-yellow-600/40 transition-all duration-300"
                    style={{ width: `${(fileBasedStats.selected / fileStats.total) * 100}%` }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Stats Counters */}
          {fileStats.total > 0 && (
            <div className="flex gap-6 text-sm mt-2">
              <span className="text-green-400">
                Completed: <strong>{fileBasedStats.completed}</strong>
              </span>
              <span className="text-red-400">
                Errors: <strong>{fileBasedStats.error}</strong>
              </span>
              <span className="text-blue-400">
                Processing: <strong>{fileBasedStats.processing}</strong>
              </span>
              <span className="text-yellow-400">
                Pending: <strong>{fileBasedStats.pending}</strong>
              </span>
              {selectedIds.size > 0 && (
                <span className="text-yellow-400/60">
                  Selected: <strong>{selectedIds.size}</strong>
                </span>
              )}
              <span className="ml-auto">
                Files: <strong>{fileStats.total}</strong>
              </span>
            </div>
          )}

          {/* Timing Info */}
          {timing.startTime && (
            <div className="flex items-center gap-4 text-sm text-gray-400 mt-2">
              <span>Started: {formatTime(timing.startTime)}</span>
              {timing.endTime ? (
                <>
                  <span>Ended: {formatTime(timing.endTime)}</span>
                  <span>Duration: {formatDuration(elapsed)}</span>
                </>
              ) : (
                <span className="text-blue-400">Elapsed: {formatDuration(elapsed)}</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* File Tree */}
      {hasFiles ? (
        <section className="bg-gray-800 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 py-2 px-3 bg-gray-700 border-b border-gray-600">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected
              }}
              onChange={toggleAll}
              disabled={isRunning || selectableFiles.length === 0}
              className="w-4 h-4 rounded bg-gray-700 border-gray-600 disabled:opacity-50"
            />
            <span className="text-sm text-gray-400 ml-7">Select all</span>
          </div>
          {/* Tree */}
          <div>
            <FolderRow
              node={fileTree}
              depth={0}
              selectedIds={selectedIds}
              onToggleFolder={toggleFolderSelection}
              onToggleFile={toggleSelection}
              onShowError={setErrorFile}
              disabled={isRunning}
              expandedPaths={expandedPaths}
              onToggleExpand={toggleExpand}
              fileDeviations={fileDeviations}
            />
          </div>
        </section>
      ) : (
        <section className="text-center py-16 text-gray-400">
          <p className="text-lg">No files scanned yet.</p>
          <p className="mt-2">Enter a directory path above to scan for video files.</p>
        </section>
      )}

      <ErrorModal file={errorFile} onClose={() => setErrorFile(null)} />
    </div>
  )
}

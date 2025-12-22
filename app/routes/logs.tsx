import { useEffect, useRef, useState } from 'react'
import { Form, Link } from 'react-router'

interface LogLine {
  time: string
  stream: 'stdout' | 'stderr'
  data: string
}

interface WorkerData {
  status: 'running' | 'stopped'
  currentFile?: string
  logs: LogLine[]
}

function WorkerCard({ workerId, data }: { workerId: number; data: WorkerData }) {
  const logsRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [data.logs])

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden flex flex-col h-full">
      <div className="px-4 py-2 bg-gray-700 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold">Worker {workerId}</span>
          <span
            className={`px-2 py-0.5 rounded text-xs ${
              data.status === 'running'
                ? 'bg-green-600 text-green-100'
                : 'bg-gray-600 text-gray-300'
            }`}
          >
            {data.status}
          </span>
        </div>
        {data.status === 'running' && data.currentFile && (
          <span className="text-gray-400 text-sm font-mono truncate max-w-md">
            {data.currentFile}
          </span>
        )}
      </div>

      <pre ref={logsRef} className="font-mono text-xs bg-gray-950 p-3 flex-1 overflow-auto min-h-0">
        {data.logs.length === 0 ? (
          <span className="text-gray-600">No output</span>
        ) : (
          data.logs.map((line, i) => {
            const time = new Date(line.time).toLocaleTimeString()
            const color = line.stream === 'stderr' ? 'text-red-400' : 'text-gray-300'
            return (
              <div key={i} className="flex gap-2">
                <span className="text-gray-500 shrink-0">{time}</span>
                <span className={`${color} break-all text-wrap`}>{line.data}</span>
              </div>
            )
          })
        )}
      </pre>
    </div>
  )
}

export default function Logs() {
  const [workers, setWorkers] = useState<Map<number, WorkerData>>(new Map())

  useEffect(() => {
    // Fetch initial state
    fetch('/logs-data')
      .then((res) => res.json())
      .then((data) => {
        const map = new Map<number, WorkerData>()
        for (const [id, worker] of Object.entries(data.workers)) {
          map.set(Number(id), worker as WorkerData)
        }
        setWorkers(map)
      })
      .catch(() => {})

    const eventSource = new EventSource('/logs-stream')

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'state') {
          setWorkers((prev) => {
            const next = new Map(prev)
            const existing = next.get(data.workerId) || { logs: [], status: 'running' }
            next.set(data.workerId, { ...existing, status: data.status })
            return next
          })
        } else if (data.type === 'output') {
          setWorkers((prev) => {
            const next = new Map(prev)
            const existing = next.get(data.workerId) || { logs: [], status: 'running' }
            next.set(data.workerId, {
              ...existing,
              logs: [...existing.logs, data.line],
            })
            return next
          })
        } else if (data.type === 'file') {
          setWorkers((prev) => {
            const next = new Map(prev)
            const existing = next.get(data.workerId) || { logs: [], status: 'running' }
            next.set(data.workerId, { ...existing, currentFile: data.filePath })
            return next
          })
        } else if (data.type === 'clear') {
          setWorkers(new Map())
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
    }
  }, [])

  const workerEntries = Array.from(workers.entries()).sort((a, b) => a[0] - b[0])

  return (
    <div className="h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-blue-400 hover:text-blue-300">
            &larr; Back
          </Link>
          <h1 className="text-xl font-bold">Worker Logs</h1>
          <span className="text-gray-400 text-sm">{workers.size} workers</span>
        </div>
        <Form method="post" action="/clear-logs">
          <button
            type="submit"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors cursor-pointer"
          >
            Clear Logs
          </button>
        </Form>
      </header>

      <div className="p-6 flex-1 overflow-hidden">
        {workerEntries.length === 0 ? (
          <p className="text-gray-500 text-center py-16">
            No workers running. Start a check to see worker output.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 auto-rows-fr gap-4 h-full overflow-hidden">
            {workerEntries.map(([id, data]) => (
              <WorkerCard key={id} workerId={id} data={data} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

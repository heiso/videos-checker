import { workerEvents, type WorkerOutput } from '../lib/logs.server'

export async function loader() {
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          cleanup?.()
        }
      }

      send(JSON.stringify({ type: 'connected' }))

      const onState = (data: { workerId: number; status: string }) => {
        send(JSON.stringify({ type: 'state', ...data }))
      }

      const onOutput = (data: WorkerOutput) => {
        send(JSON.stringify({ type: 'output', workerId: data.workerId, line: data.line }))
      }

      const onFile = (data: { workerId: number; filePath: string }) => {
        send(JSON.stringify({ type: 'file', ...data }))
      }

      const onClear = () => {
        send(JSON.stringify({ type: 'clear' }))
      }

      workerEvents.on('state', onState)
      workerEvents.on('output', onOutput)
      workerEvents.on('file', onFile)
      workerEvents.on('clear', onClear)

      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup?.()
        }
      }, 30000)

      cleanup = () => {
        workerEvents.off('state', onState)
        workerEvents.off('output', onOutput)
        workerEvents.off('file', onFile)
        workerEvents.off('clear', onClear)
        clearInterval(pingInterval)
      }
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

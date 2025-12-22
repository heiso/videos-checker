import { fileEvents, type FileEvent } from '../lib/events.server'

export async function loader() {
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          // Stream closed, cleanup
          cleanup?.()
        }
      }

      // Send initial connection message
      send(JSON.stringify({ type: 'connected' }))

      // Handler for file events
      const handler = (event: FileEvent) => {
        send(JSON.stringify(event))
      }

      fileEvents.on('file_update', handler)

      // Keep connection alive with periodic pings
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          // Stream closed
          cleanup?.()
        }
      }, 30000)

      // Cleanup function
      cleanup = () => {
        fileEvents.off('file_update', handler)
        clearInterval(pingInterval)
      }
    },
    cancel() {
      // Called when the client disconnects
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}

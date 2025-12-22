import { EventEmitter } from 'node:events'

// Global event emitter for broadcasting file status changes
export const fileEvents = new EventEmitter()

// Increase max listeners since we may have many SSE connections
fileEvents.setMaxListeners(100)

export type FileEvent = {
  type: 'status_change' | 'job_update' | 'check_complete'
  jobId?: number
  fileId?: number
  mode?: string
  status?: string
  errorMessage?: string
  stats?: {
    total: number
    pending: number
    processing: number
    completed: number
    error: number
  }
}

export function emitFileEvent(event: FileEvent): void {
  fileEvents.emit('file_update', event)
}

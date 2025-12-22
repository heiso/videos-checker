import { getWorkerOutputs } from '../lib/logs.server'

export async function loader() {
  const outputs = getWorkerOutputs()
  const workers: Record<
    number,
    {
      logs: Array<{ time: string; stream: string; data: string }>
      currentFile?: string
      status: string
    }
  > = {}

  for (const [id, data] of outputs) {
    workers[id] = { logs: data.logs, currentFile: data.currentFile, status: data.status }
  }

  return Response.json({ workers })
}

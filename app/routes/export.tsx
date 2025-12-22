import { getAllFilesWithJobs, getFileStats, getJobStats } from '../lib/db.server'

export async function loader() {
  const files = getAllFilesWithJobs()
  const jobStats = getJobStats()
  const fileStats = getFileStats()

  const report = {
    generatedAt: new Date().toISOString(),
    stats: { ...jobStats, totalFiles: fileStats.total },
    files: files.map((file) => ({
      path: file.path,
      filename: file.filename,
      duration: file.duration,
      jobs: file.jobs.map((job) => ({
        mode: job.mode,
        status: job.status,
        error: job.error_message,
        duration: job.duration,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      })),
    })),
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="media-check-report-${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}

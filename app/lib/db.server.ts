import Database from 'better-sqlite3'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || '.'
const db = new Database(path.join(DATA_DIR, 'videos-checker.db'))

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    check_mode TEXT,
    error_message TEXT,
    checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
`)

// Migration: add check_mode column if it doesn't exist
try {
  db.exec(`ALTER TABLE files ADD COLUMN check_mode TEXT`)
} catch {
  // Column already exists
}

// Migration: add duration column if it doesn't exist
try {
  db.exec(`ALTER TABLE files ADD COLUMN duration TEXT`)
} catch {
  // Column already exists
}

// Create jobs table for tracking check jobs
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    duration TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_file_id ON jobs(file_id);
`)

export type JobStatus = 'pending' | 'processing' | 'completed' | 'error'
export type CheckMode = 'quick' | 'full'

export interface JobRecord {
  id: number
  file_id: number
  mode: CheckMode
  status: JobStatus
  error_message: string | null
  duration: string | null
  created_at: string
  completed_at: string | null
}

export interface FileRecord {
  id: number
  path: string
  filename: string
  duration: string | null
  created_at: string
}

export interface FileWithJobs extends FileRecord {
  jobs: JobRecord[]
}

export function getAllFiles(): FileRecord[] {
  return db
    .prepare('SELECT id, path, filename, duration, created_at FROM files ORDER BY path ASC')
    .all() as FileRecord[]
}

export function getAllFilesWithJobs(): FileWithJobs[] {
  const files = getAllFiles()
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRecord[]

  const jobsByFileId = new Map<number, JobRecord[]>()
  for (const job of jobs) {
    if (!jobsByFileId.has(job.file_id)) {
      jobsByFileId.set(job.file_id, [])
    }
    jobsByFileId.get(job.file_id)!.push(job)
  }

  return files.map((file) => ({
    ...file,
    jobs: jobsByFileId.get(file.id) || [],
  }))
}

export function getFileById(id: number): FileRecord | undefined {
  return db
    .prepare('SELECT id, path, filename, duration, created_at FROM files WHERE id = ?')
    .get(id) as FileRecord | undefined
}

export function insertFile(filePath: string, filename: string): void {
  db.prepare('INSERT OR IGNORE INTO files (path, filename) VALUES (?, ?)').run(filePath, filename)
}

export function createJobs(fileIds: number[], mode: CheckMode): void {
  if (fileIds.length === 0) return
  const insert = db.prepare("INSERT INTO jobs (file_id, mode, status) VALUES (?, ?, 'pending')")
  const insertMany = db.transaction((ids: number[]) => {
    for (const id of ids) {
      insert.run(id, mode)
    }
  })
  insertMany(fileIds)
}

export function claimNextPendingJob(
  mode: CheckMode,
): { job: JobRecord; file: FileRecord } | undefined {
  const claim = db.transaction(() => {
    const job = db
      .prepare("SELECT * FROM jobs WHERE mode = ? AND status = 'pending' LIMIT 1")
      .get(mode) as JobRecord | undefined

    if (job) {
      db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?").run(job.id)
      const file = db
        .prepare('SELECT id, path, filename, duration, created_at FROM files WHERE id = ?')
        .get(job.file_id) as FileRecord
      return { job: { ...job, status: 'processing' as JobStatus }, file }
    }
    return undefined
  })

  return claim()
}

export function updateJobStatus(
  jobId: number,
  status: JobStatus,
  errorMessage?: string,
  duration?: string,
): void {
  if (status === 'completed' || status === 'error') {
    db.prepare(
      "UPDATE jobs SET status = ?, error_message = ?, duration = ?, completed_at = datetime('now') WHERE id = ?",
    ).run(status, errorMessage || null, duration || null, jobId)
  } else {
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId)
  }
}

export function updateFileDuration(fileId: number, duration: string): void {
  db.prepare('UPDATE files SET duration = ? WHERE id = ?').run(duration, fileId)
}

export function resetProcessingJobs(mode?: CheckMode): void {
  if (mode) {
    db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'processing' AND mode = ?").run(
      mode,
    )
  } else {
    db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'processing'").run()
  }
}

export function deletePendingAndProcessingJobs(mode?: CheckMode): void {
  if (mode) {
    db.prepare(
      "DELETE FROM jobs WHERE (status = 'pending' OR status = 'processing') AND mode = ?",
    ).run(mode)
  } else {
    db.prepare("DELETE FROM jobs WHERE status = 'pending' OR status = 'processing'").run()
  }
}

export function clearAllFiles(): void {
  db.prepare('DELETE FROM jobs').run()
  db.prepare('DELETE FROM files').run()
}

export function getJobStats(): {
  total: number
  pending: number
  processing: number
  completed: number
  error: number
} {
  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error
    FROM jobs
  `,
    )
    .get() as {
    total: number
    pending: number
    processing: number
    completed: number
    error: number
  }

  return stats
}

export function getFileStats(): { total: number } {
  const stats = db.prepare('SELECT COUNT(*) as total FROM files').get() as { total: number }
  return stats
}

export function getPendingJobCount(mode: CheckMode): number {
  const result = db
    .prepare("SELECT COUNT(*) as count FROM jobs WHERE mode = ? AND status = 'pending'")
    .get(mode) as { count: number }
  return result.count
}

export function getProcessingJobCount(mode: CheckMode): number {
  const result = db
    .prepare("SELECT COUNT(*) as count FROM jobs WHERE mode = ? AND status = 'processing'")
    .get(mode) as { count: number }
  return result.count
}

export { db }

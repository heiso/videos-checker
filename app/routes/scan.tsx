import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { redirect } from 'react-router'
import { insertFile } from '../lib/db.server'
import type { Route } from './+types/scan'

// Supported video extensions
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.ts',
  '.mts',
])

function isVideoFile(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return VIDEO_EXTENSIONS.has(ext)
}

function scanDirectory(dirPath: string): string[] {
  const files: string[] = []

  function scan(currentPath: string) {
    try {
      const entries = readdirSync(currentPath)

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.startsWith('.')) continue

        const fullPath = join(currentPath, entry)

        try {
          const stat = statSync(fullPath)

          if (stat.isDirectory()) {
            scan(fullPath)
          } else if (stat.isFile() && isVideoFile(entry)) {
            files.push(fullPath)
          }
        } catch {
          // Skip files we can't access
        }
      }
    } catch {
      // Skip directories we can't access
    }
  }

  scan(dirPath)
  return files
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const path = formData.get('path') as string

  if (!path) {
    throw new Response('Path is required', { status: 400 })
  }

  // Scan directory for video files
  const files = scanDirectory(path)

  // Insert files into database
  for (const filePath of files) {
    const filename = basename(filePath)
    insertFile(filePath, filename)
  }

  return redirect('/')
}

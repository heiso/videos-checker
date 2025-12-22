import { redirect } from 'react-router'
import { startChecking } from '../lib/checker.server'
import type { CheckMode } from '../lib/db.server'
import type { Route } from './+types/check'

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const mode = (formData.get('mode') as CheckMode) || 'quick'
  const fileIdsJson = formData.get('fileIds') as string

  let fileIds: number[] = []
  try {
    const parsed = JSON.parse(fileIdsJson || '[]')
    if (Array.isArray(parsed) && parsed.length > 0) {
      fileIds = parsed.map(Number).filter((n) => !isNaN(n))
    }
  } catch {
    // Invalid JSON, ignore
  }

  if (fileIds.length > 0) {
    startChecking(mode, fileIds)
  }
  return redirect('/')
}

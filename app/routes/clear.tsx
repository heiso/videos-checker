import { redirect } from 'react-router'
import { clearAllFiles } from '../lib/db.server'

export async function action() {
  clearAllFiles()
  return redirect('/')
}

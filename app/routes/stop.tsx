import { redirect } from 'react-router'
import { stopChecking } from '../lib/checker.server'

export async function action() {
  stopChecking()
  return redirect('/')
}

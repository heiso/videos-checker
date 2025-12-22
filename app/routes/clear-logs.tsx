import { redirect } from 'react-router'
import { clearWorkers } from '../lib/logs.server'

export async function action() {
  clearWorkers()
  return redirect('/logs')
}

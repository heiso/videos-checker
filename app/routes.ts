import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/_index.tsx'),
  route('scan', 'routes/scan.tsx'),
  route('check', 'routes/check.tsx'),
  route('stop', 'routes/stop.tsx'),
  route('clear', 'routes/clear.tsx'),
  route('events', 'routes/events.tsx'),
  route('export', 'routes/export.tsx'),
  route('logs', 'routes/logs.tsx'),
  route('logs-stream', 'routes/logs-stream.tsx'),
  route('logs-data', 'routes/logs-data.tsx'),
  route('clear-logs', 'routes/clear-logs.tsx'),
] satisfies RouteConfig

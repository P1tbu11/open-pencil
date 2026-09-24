const server = Bun.spawn(['bun', 'tools/ui-slicing/server.ts'], {
  stdout: 'inherit',
  stderr: 'inherit'
})
const app = Bun.spawn(['bun', 'run', 'dev', '--host', '127.0.0.1', '--port', '1420'], {
  stdout: 'inherit',
  stderr: 'inherit'
})
function stop() {
  server.kill()
  app.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race([server.exited, app.exited])
stop()

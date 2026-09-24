import { expect, test } from 'bun:test'

import { requestSlices } from '@/app/ui-slicing/provider'

test('rejects invalid remote coordinates and missing assets before returning an importable result', async () => {
  const source = { name: 'test', width: 100, height: 100, dataURL: 'data:image/png;base64,YWJj' }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      Response.json({
        layers: [
          {
            id: 'a',
            name: 'image',
            kind: 'image',
            x: new URL(request.url).pathname === '/detect' ? 999 : 0,
            y: 0,
            width: 10,
            height: 10,
            z: 0
          }
        ]
      })
  })
  try {
    for (const action of ['detect', 'split'] as const) {
      await expect(
        requestSlices(
          { url: `http://127.0.0.1:${server.port}`, token: '' },
          action,
          source,
          [],
          new AbortController().signal
        )
      ).rejects.toThrow()
    }
  } finally {
    server.stop(true)
  }
})

import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { computeImageHash } from '@open-pencil/scene-graph'

import { canvasImageNode, sourceFromCanvasImage } from '@/app/ui-slicing/canvas-source'

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (char) => char.charCodeAt(0)
)

test('reads the single selected canvas image without a file import', async () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const imageHash = computeImageHash(PNG)
  editor.graph.images.set(imageHash, PNG)
  const image = editor.graph.createNode('RECTANGLE', page, {
    name: '大厅截图',
    width: 120,
    height: 80,
    fills: [
      {
        type: 'IMAGE',
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        imageHash,
        imageScaleMode: 'FILL'
      }
    ]
  })
  editor.select([image.id])

  const selected = canvasImageNode(editor.graph, editor.state.selectedIds)
  expect(selected?.id).toBe(image.id)
  const source = await sourceFromCanvasImage(editor.graph, image)
  expect(source.name).toBe('大厅截图')
  expect(source.width).toBe(1)
  expect(source.height).toBe(1)
  expect(source.dataURL.startsWith('data:image/png;base64,')).toBe(true)

  const frame = editor.graph.createNode('FRAME', page, { name: '包装', width: 120, height: 80 })
  const wrapped = editor.graph.createNode('RECTANGLE', frame.id, {
    name: '包装里的图',
    width: 120,
    height: 80,
    fills: image.fills
  })
  editor.select([frame.id])
  expect(canvasImageNode(editor.graph, editor.state.selectedIds)?.id).toBe(wrapped.id)

  editor.select([page])
  expect(canvasImageNode(editor.graph, editor.state.selectedIds)).toBeNull()
})

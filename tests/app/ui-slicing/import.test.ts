import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

import { importSliceResult } from '@/app/ui-slicing/import'

test('imports image and editable text at original coordinates as one undoable operation', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const originalIds = editor.graph.getChildren(page).map((node) => node.id)
  const result = importSliceResult(
    editor,
    {
      version: 1,
      name: '游戏大厅',
      width: 800,
      height: 600,
      layers: [
        {
          id: 'coin',
          name: '金币',
          kind: 'image',
          x: 30,
          y: 20,
          width: 40,
          height: 40,
          bytes: new Uint8Array([137, 80, 78, 71]),
          z: 0
        },
        {
          id: 'amount',
          name: '金币数量',
          kind: 'text',
          x: 78,
          y: 25,
          width: 90,
          height: 30,
          text: '3680',
          fontSize: 24,
          fontFamily: 'Inter',
          color: '#ffffff',
          z: 1
        }
      ]
    },
    { x: 920, y: 0 }
  )

  const frame = editor.graph.getNode(result.frameId)
  expect(frame).toMatchObject({ type: 'FRAME', x: 920, y: 0, width: 800, height: 600 })
  expect(frame?.childIds).toHaveLength(2)
  const children = editor.graph.getChildren(result.frameId)
  expect(children[0]).toMatchObject({ name: '金币', x: 30, y: 20, width: 40, height: 40 })
  expect(children[1]).toMatchObject({ type: 'TEXT', text: '3680', x: 78, y: 25, fontSize: 24 })
  editor.undo.undo()
  expect(editor.graph.getChildren(page).map((node) => node.id)).toEqual(originalIds)
  editor.undo.redo()
  expect(editor.graph.getChildren(result.frameId)[1]?.text).toBe('3680')
  expect(editor.graph.getChildren(result.frameId)[0]?.fills[0]?.imageHash).toBeTruthy()
})

test('native save and reopen retains image assets and editable text', async () => {
  const editor = createEditor()
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    ),
    (char) => char.charCodeAt(0)
  )
  importSliceResult(editor, {
    version: 1,
    name: 'Save test',
    width: 100,
    height: 100,
    layers: [
      { id: 'a', name: 'Icon', kind: 'image', x: 0, y: 0, width: 20, height: 20, z: 0, bytes: png },
      {
        id: 'b',
        name: 'Amount',
        kind: 'text',
        x: 20,
        y: 0,
        width: 80,
        height: 20,
        z: 1,
        text: '3680',
        fontSize: 16
      }
    ]
  })
  const file = await exportFigFile(editor.graph)
  const restored = await parseFigFile(new Uint8Array(file).buffer)
  const frame = [...restored.nodes.values()].find((node) => node.name === 'Save test')
  expect(frame).toBeDefined()
  const children = restored.getChildren(frame?.id ?? '')
  expect(children.find((node) => node.name === 'Amount')?.text).toBe('3680')
  const hash = children.find((node) => node.name === 'Icon')?.fills[0]?.imageHash
  expect(restored.images.get(hash ?? '')).toEqual(png)
})

test('invalid results leave the current document and undo history untouched', () => {
  const editor = createEditor()
  const before = editor.graph.getChildren(editor.state.currentPageId).map((node) => node.id)
  for (const layers of [
    [
      { id: 'bad', name: '缺素材', kind: 'image' as const, x: 0, y: 0, width: 10, height: 10, z: 0 }
    ],
    [
      {
        id: 'bad',
        name: '越界',
        kind: 'text' as const,
        x: 799,
        y: 0,
        width: 10,
        height: 10,
        z: 0,
        text: '1'
      }
    ]
  ]) {
    expect(() =>
      importSliceResult(editor, { version: 1, name: 'test', width: 800, height: 600, layers })
    ).toThrow()
    expect(editor.graph.getChildren(editor.state.currentPageId).map((node) => node.id)).toEqual(
      before
    )
  }
})

import type { Editor } from '@open-pencil/core/editor'
import { computeImageHash, type SceneNode } from '@open-pencil/scene-graph'

import { parseResult } from './schema'
import type { SliceResult } from './types'

export function importSliceResult(editor: Editor, result: SliceResult, position = { x: 0, y: 0 }) {
  result = parseResult(result)
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('画板位置无效')
  const pageId = editor.state.currentPageId
  const previousSelection = [...editor.state.selectedIds]
  const frame = editor.graph.createNode('FRAME', pageId, {
    name: result.name,
    ...position,
    width: result.width,
    height: result.height,
    fills: [],
    clipsContent: true
  })
  for (const layer of [...result.layers].sort((a, b) => a.z - b.z)) {
    const color = layer.color ?? '#ffffff'
    const rgb = {
      r: parseInt(color.slice(1, 3), 16) / 255,
      g: parseInt(color.slice(3, 5), 16) / 255,
      b: parseInt(color.slice(5, 7), 16) / 255,
      a: 1
    }
    const props: Partial<SceneNode> = {
      name: layer.name,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height
    }
    if (layer.kind === 'text') {
      Object.assign(props, {
        text: layer.text ?? '',
        fontSize: layer.fontSize ?? 24,
        fontFamily: layer.fontFamily ?? 'Inter',
        textAutoResize: 'NONE',
        fills: [{ type: 'SOLID', color: rgb, opacity: 1, visible: true }]
      })
    } else if (layer.bytes) {
      const imageHash = computeImageHash(layer.bytes)
      editor.graph.images.set(imageHash, layer.bytes)
      props.fills = [
        {
          type: 'IMAGE',
          color: rgb,
          opacity: 1,
          visible: true,
          imageHash,
          imageScaleMode: 'FILL'
        }
      ]
    }
    editor.graph.createNode(layer.kind === 'text' ? 'TEXT' : 'RECTANGLE', frame.id, props)
  }
  const snapshots = [frame, ...editor.graph.getChildren(frame.id)].map((node) =>
    structuredClone({ ...node, childIds: [] })
  )
  editor.pushUndoEntry({
    label: '导入 UI 拆分结果',
    forward: () => {
      for (const node of snapshots)
        editor.graph.createNode(node.type, node.parentId ?? pageId, node)
      editor.select([frame.id])
    },
    inverse: () => {
      editor.graph.deleteNode(frame.id)
      editor.select(previousSelection.filter((id) => editor.graph.getNode(id)))
    }
  })
  editor.select([frame.id])
  editor.requestRender()
  return { frameId: frame.id }
}

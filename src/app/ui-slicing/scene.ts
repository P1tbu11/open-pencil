import type { Editor } from '@open-pencil/core/editor'

import { parseResult } from './schema'
import type { SliceLayer } from './types'

export async function readFrame(
  editor: Editor,
  frameId: string,
  rasterize: (ids: string[], scale: number, format: 'PNG') => Promise<Uint8Array | null>
) {
  const frame = editor.graph.getNode(frameId)
  if (frame?.type !== 'FRAME') throw new Error('请先选择一个结果画板')
  const layers: SliceLayer[] = []
  async function visit(id: string, parentX: number, parentY: number) {
    const node = editor.graph.getNode(id)
    if (!node || !node.visible) return
    if (node.rotation !== 0) throw new Error('当前导出暂不支持旋转图层，请先归零旋转')
    const x = parentX + node.x
    const y = parentY + node.y
    if (node.childIds.length) {
      for (const child of node.childIds) await visit(child, x, y)
      return
    }
    const base = {
      id: node.id,
      name: node.name,
      x,
      y,
      width: node.width,
      height: node.height,
      z: layers.length
    }
    if (node.type === 'TEXT') {
      const color = node.fills.find((fill) => fill.visible && fill.type === 'SOLID')?.color
      const hex =
        '#' +
        [color?.r ?? 1, color?.g ?? 1, color?.b ?? 1]
          .map((channel) =>
            Math.round(channel * 255)
              .toString(16)
              .padStart(2, '0')
          )
          .join('')
      layers.push({
        ...base,
        kind: 'text',
        text: node.text,
        fontSize: node.fontSize,
        fontFamily: node.fontFamily,
        color: hex
      })
    } else {
      const bytes = await rasterize([node.id], 1, 'PNG')
      if (!bytes) throw new Error(`无法渲染图层：${node.name}`)
      layers.push({ ...base, kind: 'image', bytes })
    }
  }
  for (const id of frame.childIds) await visit(id, 0, 0)
  return parseResult({
    version: 1,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    layers
  })
}

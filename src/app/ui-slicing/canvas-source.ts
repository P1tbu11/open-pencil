import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { parseRegions } from './schema'
import type { SliceSource } from './types'

const MAX_BYTES = 30_000_000

export function canvasImageNode(
  graph: SceneGraph,
  selectedIds: Iterable<string>
): SceneNode | null {
  const ids = [...selectedIds]
  if (ids.length !== 1) return null
  const node = graph.getNode(ids[0] ?? '')
  if (!node) return null
  const direct = imageRectangle(node)
  if (direct) return direct
  if ((node.type !== 'FRAME' && node.type !== 'GROUP') || node.childIds.length !== 1) return null
  const child = graph.getNode(node.childIds[0] ?? '')
  return child ? imageRectangle(child) : null
}

function imageRectangle(node: SceneNode) {
  if (node.type !== 'RECTANGLE' || node.fills.length !== 1) return null
  const fill = node.fills[0]
  if (!fill || fill.type !== 'IMAGE' || !fill.imageHash || fill.visible === false) return null
  return node
}

export async function sourceFromCanvasImage(
  graph: SceneGraph,
  node: SceneNode
): Promise<SliceSource> {
  const fill = node.fills[0]
  if (!fill?.imageHash) throw new Error('请选中画布上的一张图片')
  const bytes = graph.images.get(fill.imageHash)
  if (!bytes?.byteLength) throw new Error('这张图片的像素不在当前文件里，请重新放入后再拆分')
  if (bytes.byteLength > MAX_BYTES) throw new Error('请选择 30 MB 以内的 PNG、JPG 或 WebP 图片')
  const mime = imageMediaType(bytes)
  if (!mime) throw new Error('画布图片需要是 PNG、JPG 或 WebP')
  const size = imageSize(bytes, mime)
  if (!size) throw new Error('无法读取这张图片的尺寸')
  const name = (node.name.trim() || '画布图片').slice(0, 200)
  const source = {
    name,
    width: size.width,
    height: size.height,
    dataURL: bytesToDataURL(bytes, mime)
  }
  try {
    parseRegions({ version: 1, ...source, layers: [] })
  } catch {
    throw new Error('这张图片超出可拆分尺寸')
  }
  return source
}

function imageMediaType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function imageSize(bytes: Uint8Array, mime: string) {
  if (mime === 'image/png') return pngSize(bytes)
  if (mime === 'image/jpeg') return jpegSize(bytes)
  return webpSize(bytes)
}

function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) return null
  return { width, height }
}

function jpegSize(bytes: Uint8Array) {
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1] ?? 0
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0)
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
      if (!width || !height) return null
      return { width, height }
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function webpSize(bytes: Uint8Array) {
  if (bytes.length < 30) return null
  const format = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (format === 'VP8X') {
    const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16)
    const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16)
    if (!width || !height) return null
    return { width, height }
  }
  if (format === 'VP8 ' && bytes.length >= 30) {
    const width = view.getUint16(26, true) & 0x3fff
    const height = view.getUint16(28, true) & 0x3fff
    if (!width || !height) return null
    return { width, height }
  }
  if (format === 'VP8L' && bytes.length >= 25) {
    const bits = view.getUint32(21, true)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    if (!width || !height) return null
    return { width, height }
  }
  return null
}

function bytesToDataURL(bytes: Uint8Array, mime: string) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

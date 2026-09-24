import { extractLocalLayers, type LocalOptions, type PixelImage } from './pixels'
import { parseRegions, parseResult } from './schema'
import type { SliceRegion, SliceResult, SliceSource } from './types'

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 32_000_000) {
    throw new Error('请使用 3200 万像素以内的图片')
  }
  return image
}

export async function readSource(file: File): Promise<SliceSource> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 30_000_000) {
    throw new Error('请选择 30 MB 以内的 PNG、JPG 或 WebP 图片')
  }
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('图片读取失败'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
  const image = await loadImage(dataURL)
  const source = {
    name: file.name.replace(/\.[^.]+$/, ''),
    width: image.naturalWidth,
    height: image.naturalHeight,
    dataURL
  }
  parseRegions({ version: 1, ...source, layers: [] })
  return source
}

export function imageCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器无法处理图片')
  return { canvas, context }
}

export async function canvasPNG(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (!value) {
        reject(new Error('图片编码失败'))
        return
      }
      resolve(value)
    }, 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

async function encodePixels(image: PixelImage) {
  const { canvas, context } = imageCanvas(image.width, image.height)
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0
  )
  return canvasPNG(canvas)
}

export async function splitLocally(
  source: SliceSource,
  regions: SliceRegion[],
  options: LocalOptions,
  signal: AbortSignal,
  progress: (message: string) => void
): Promise<SliceResult> {
  if (!regions.length) throw new Error('请先添加区域')
  parseRegions({ version: 1, ...source, layers: regions })
  const image = await loadImage(source.dataURL)
  signal.throwIfAborted()
  const { canvas, context } = imageCanvas(source.width, source.height)
  context.drawImage(image, 0, 0)
  progress('正在提取区域并修复简单底色…')
  // Yield once before pixel work so cancellation and progress can be displayed.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  signal.throwIfAborted()
  const { background, crops } = extractLocalLayers(
    context.getImageData(0, 0, canvas.width, canvas.height),
    regions,
    options
  )
  const layers: SliceResult['layers'] = [
    {
      id: crypto.randomUUID(),
      name: options.repairBackground ? '背景 · 本地修复' : '原始底图',
      kind: 'image',
      x: 0,
      y: 0,
      width: source.width,
      height: source.height,
      z: Math.min(...regions.map((region) => region.z)) - 1,
      bytes: await encodePixels(background)
    }
  ]
  for (let i = 0; i < regions.length; i++) {
    signal.throwIfAborted()
    progress(`正在生成图层 ${i + 1} / ${regions.length}…`)
    layers.push({
      ...regions[i],
      ...(regions[i].kind === 'image' ? { bytes: await encodePixels(crops[i]) } : {})
    })
  }
  signal.throwIfAborted()
  return parseResult({
    version: 1,
    name: source.name,
    width: source.width,
    height: source.height,
    layers
  })
}

export function downloadFile(bytes: Uint8Array, name: string, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.replace(/[/\\]/g, '_')
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

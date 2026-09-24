import type { PixelData } from 'ag-psd'

import type { EditorStore } from '@/app/editor/session'

import { exportEngine, type EngineTarget } from './engines'
import { imageCanvas, loadImage } from './media'
import { encodePSD } from './psd'
import { readFrame } from './scene'

async function pngPixels(bytes: Uint8Array): Promise<PixelData> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  try {
    const image = await loadImage(url)
    const { context } = imageCanvas(image.naturalWidth, image.naturalHeight)
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportSlices(
  editor: EditorStore,
  frameId: string,
  target: EngineTarget | 'psd'
) {
  const result = await readFrame(editor, frameId, editor.renderExportImage)
  if (target !== 'psd')
    return { name: `${result.name}-${target}.zip`, bytes: exportEngine(result, target) }
  const pixels = new Map<string, PixelData>()
  for (const layer of result.layers) {
    const bytes = layer.bytes ?? (await editor.renderExportImage([layer.id], 1, 'PNG'))
    if (!bytes) throw new Error(`无法导出：${layer.name}`)
    pixels.set(layer.id, await pngPixels(bytes))
  }
  const composite = await editor.renderExportImage([frameId], 1, 'PNG')
  if (!composite) throw new Error('画布还未准备好，请稍后重试')
  return {
    name: `${result.name}.psd`,
    bytes: encodePSD(result, pixels, await pngPixels(composite))
  }
}

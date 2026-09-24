import { writePsdUint8Array, type Layer, type PixelData } from 'ag-psd'

import { parseResult } from './schema'
import type { SliceResult } from './types'

export function encodePSD(
  result: SliceResult,
  pixels: Map<string, PixelData>,
  composite?: PixelData
) {
  parseResult(result)
  const children: Layer[] = [...result.layers]
    .sort((a, b) => b.z - a.z)
    .map((layer) => {
      const imageData = pixels.get(layer.id)
      if (!imageData) throw new Error(`缺少图层预览：${layer.name}`)
      const color = layer.color ?? '#ffffff'
      return {
        name: layer.name,
        left: Math.round(layer.x),
        top: Math.round(layer.y),
        imageData,
        ...(layer.kind === 'text'
          ? {
              text: {
                text: layer.text ?? '',
                shapeType: 'box' as const,
                boxBounds: [0, 0, layer.width, layer.height],
                transform: [1, 0, 0, 1, layer.x, layer.y],
                style: {
                  font: { name: layer.fontFamily ?? 'Inter' },
                  fontSize: layer.fontSize ?? 24,
                  fillColor: {
                    r: Number.parseInt(color.slice(1, 3), 16),
                    g: Number.parseInt(color.slice(3, 5), 16),
                    b: Number.parseInt(color.slice(5, 7), 16)
                  }
                }
              }
            }
          : {})
      }
    })
  return writePsdUint8Array(
    {
      width: Math.round(result.width),
      height: Math.round(result.height),
      children,
      imageData: composite
    },
    { generateThumbnail: false }
  )
}

import type { SliceRegion } from './types'

export interface PixelImage {
  width: number
  height: number
  data: Uint8ClampedArray
}
export interface LocalOptions {
  removeBackground: boolean
  repairBackground: boolean
  tolerance: number
}

// Deliberately conservative: only edge-connected pixels close to the dominant
// border colour are removed. This is a local aid for flat UI, not semantic AI.
function clearBorder(image: PixelImage, tolerance: number) {
  const { width, height, data } = image
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
  const buckets = new Map<string, number[]>()
  for (const p of border) {
    const key = [0, 1, 2].map((c) => Math.round(data[p * 4 + c] / 24)).join(',')
    const points = buckets.get(key) ?? []
    points.push(p)
    buckets.set(key, points)
  }
  const points = [...buckets.values()].sort((a, b) => b.length - a.length)[0] ?? [0]
  const colour = [0, 1, 2].map(
    (c) => points.reduce((sum, p) => sum + data[p * 4 + c], 0) / points.length
  )
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  function push(p: number) {
    if (visited[p]) return
    visited[p] = 1
    if ([0, 1, 2].every((c) => Math.abs(data[p * 4 + c] - colour[c]) <= tolerance))
      queue[tail++] = p
  }
  border.forEach(push)
  while (head < tail) {
    const p = queue[head++]
    data[p * 4 + 3] = 0
    if (p % width > 0) push(p - 1)
    if (p % width < width - 1) push(p + 1)
    if (p >= width) push(p - width)
    if (p < width * (height - 1)) push(p + width)
  }
}

export function extractLocalLayers(
  source: PixelImage,
  regions: SliceRegion[],
  options: LocalOptions
) {
  const background: PixelImage = {
    width: source.width,
    height: source.height,
    data: source.data.slice()
  }
  const crops: PixelImage[] = []
  for (const region of regions) {
    const x = Math.round(region.x)
    const y = Math.round(region.y)
    const width = Math.min(Math.round(region.width), source.width - x)
    const height = Math.min(Math.round(region.height), source.height - y)
    const crop = { width, height, data: new Uint8ClampedArray(width * height * 4) }
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * source.width + x) * 4
      crop.data.set(source.data.subarray(start, start + width * 4), row * width * 4)
    }
    if (options.repairBackground && region.kind === 'image') {
      const containedText = regions
        .filter(
          (text) =>
            text.kind === 'text' &&
            text.x >= x &&
            text.y >= y &&
            text.x + text.width <= x + width &&
            text.y + text.height <= y + height
        )
        .map((text) => ({ ...text, x: text.x - x, y: text.y - y }))
      if (containedText.length) {
        crop.data.set(
          extractLocalLayers(crop, containedText, { ...options, removeBackground: false })
            .background.data
        )
      }
    }
    if (options.removeBackground && region.kind === 'image') clearBorder(crop, options.tolerance)
    crops.push(crop)
    if (!options.repairBackground) continue
    // Interpolate outside the box on the immutable source. Accurate for solid
    // backgrounds; textured/occluded backgrounds require the model provider.
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const left = ((y + row) * source.width + Math.max(0, x - 1)) * 4
        const right = ((y + row) * source.width + Math.min(source.width - 1, x + width)) * 4
        const top = (Math.max(0, y - 1) * source.width + x + col) * 4
        const bottom = (Math.min(source.height - 1, y + height) * source.width + x + col) * 4
        const destination = ((y + row) * source.width + x + col) * 4
        const tx = (col + 1) / (width + 1)
        const ty = (row + 1) / (height + 1)
        for (let c = 0; c < 4; c++) {
          background.data[destination + c] =
            (source.data[left + c] * (1 - tx) +
              source.data[right + c] * tx +
              source.data[top + c] * (1 - ty) +
              source.data[bottom + c] * ty) /
            2
        }
      }
  }
  return { background, crops }
}

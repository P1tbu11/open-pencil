import { expect, test } from 'bun:test'

import { extractLocalLayers } from '@/app/ui-slicing/pixels'

test('separates a simple icon and repairs the exposed flat background', () => {
  const pixels = new Uint8ClampedArray(10 * 10 * 4).fill(255)
  for (let y = 3; y < 7; y++)
    for (let x = 3; x < 7; x++) {
      pixels[(y * 10 + x) * 4] = 0
      pixels[(y * 10 + x) * 4 + 1] = 0
      pixels[(y * 10 + x) * 4 + 2] = 0
    }
  const result = extractLocalLayers(
    { width: 10, height: 10, data: pixels },
    [{ id: 'icon', name: 'icon', kind: 'image', x: 2, y: 2, width: 6, height: 6, z: 1 }],
    { removeBackground: true, repairBackground: true, tolerance: 20 }
  )
  expect(result.crops[0]?.data[3]).toBe(0)
  expect(result.crops[0]?.data[(2 * 6 + 2) * 4 + 3]).toBe(255)
  expect(result.background.data[(5 * 10 + 5) * 4]).toBe(255)
  expect(pixels[(5 * 10 + 5) * 4]).toBe(0)
})

test('removes baked-in text from a containing button before adding editable text', () => {
  const pixels = new Uint8ClampedArray(12 * 12 * 4).fill(100)
  for (let p = 0; p < 144; p++) pixels[p * 4 + 3] = 255
  for (let y = 5; y < 7; y++) for (let x = 5; x < 7; x++) pixels[(y * 12 + x) * 4] = 255
  const result = extractLocalLayers(
    { width: 12, height: 12, data: pixels },
    [
      { id: 'button', name: 'button', kind: 'image', x: 2, y: 2, width: 8, height: 8, z: 0 },
      { id: 'text', name: 'text', kind: 'text', x: 5, y: 5, width: 2, height: 2, z: 1, text: 'GO' }
    ],
    { removeBackground: false, repairBackground: true, tolerance: 20 }
  )
  expect(result.crops[0]?.data[(3 * 8 + 3) * 4]).toBe(100)
})

test('accepts browser ImageData dimensions implemented as accessors', () => {
  const source = {
    get width() {
      return 2
    },
    get height() {
      return 2
    },
    data: new Uint8ClampedArray(16)
  }
  Object.defineProperties(source, { width: { enumerable: false }, height: { enumerable: false } })
  const result = extractLocalLayers(source, [], {
    removeBackground: false,
    repairBackground: false,
    tolerance: 0
  })
  expect([result.background.width, result.background.height]).toEqual([2, 2])
})

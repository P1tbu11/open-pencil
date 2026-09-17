import { expect, test } from 'bun:test'

import { configureDrawingBufferColorSpace } from '#vue/canvas/surface/color-space'

test('sRGB buffers already match CanvasKit RGBA8 surfaces', () => {
  const context = { drawingBufferColorSpace: 'srgb' as PredefinedColorSpace }
  expect(configureDrawingBufferColorSpace(context)).toBe(true)
  expect(context.drawingBufferColorSpace).toBe('srgb')
})

test('a retained P3 context returns to sRGB without changing storage', () => {
  const context = { drawingBufferColorSpace: 'display-p3' as PredefinedColorSpace }
  expect(configureDrawingBufferColorSpace(context)).toBe(true)
  expect(context.drawingBufferColorSpace).toBe('srgb')
})

test('browsers without color-space control use their default sRGB buffer', () => {
  expect(configureDrawingBufferColorSpace(null)).toBe(true)
  expect(configureDrawingBufferColorSpace({})).toBe(true)
  const readOnly = {
    get drawingBufferColorSpace(): PredefinedColorSpace {
      return 'srgb'
    }
  }
  expect(configureDrawingBufferColorSpace(readOnly)).toBe(true)
})

test('an incompatible buffer that rejects sRGB cannot be wrapped', () => {
  const throwing = {
    get drawingBufferColorSpace(): PredefinedColorSpace {
      return 'display-p3'
    }
  }
  expect(configureDrawingBufferColorSpace(throwing)).toBe(false)
  const ignored = {
    get drawingBufferColorSpace(): PredefinedColorSpace {
      return 'display-p3'
    },
    set drawingBufferColorSpace(_value: PredefinedColorSpace) {
      // Model browsers that silently ignore an unsupported color-space request.
    }
  }
  expect(configureDrawingBufferColorSpace(ignored)).toBe(false)
})

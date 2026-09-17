import type { CanvasKit, Surface } from 'canvaskit-wasm'

import { IS_BROWSER } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'

import type { UseCanvasOptions } from '#vue/canvas/surface/types'

import { configureDrawingBufferColorSpace } from './color-space'

type GLContext = ReturnType<CanvasKit['MakeGrContext']>

export type CanvasGLContext = GLContext

export function sizeCanvas(
  canvas: HTMLCanvasElement,
  editor: Editor,
  onViewportResize?: (width: number, height: number) => void
) {
  const dpr = IS_BROWSER ? window.devicePixelRatio || 1 : 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  if (onViewportResize) {
    onViewportResize(width, height)
  } else if ('setViewportSize' in editor && typeof editor.setViewportSize === 'function') {
    editor.setViewportSize(width, height)
  }
}

export function makeGLSurface(
  ck: CanvasKit,
  canvas: HTMLCanvasElement,
  options: UseCanvasOptions | undefined,
  glContext: GLContext | null
): { surface: Surface | null; glContext: GLContext | null } {
  let context = glContext
  const glAttrs = options?.preserveDrawingBuffer ? { preserveDrawingBuffer: 1 } : undefined
  const handle = context ? null : ck.GetWebGLContext(canvas, glAttrs)
  if (!context && !handle) return { surface: null, glContext: context }

  const buffer = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!configureDrawingBufferColorSpace(buffer)) {
    if (handle) ck.deleteContext(handle)
    return { surface: null, glContext: context }
  }
  if (!context && handle) context = ck.MakeGrContext(handle)
  if (!context) return { surface: null, glContext: context }

  return {
    surface: ck.MakeOnScreenGLSurface(context, canvas.width, canvas.height, ck.ColorSpace.SRGB),
    glContext: context
  }
}

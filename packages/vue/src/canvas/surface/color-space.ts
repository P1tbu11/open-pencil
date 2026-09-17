type ColorManagedContext = Partial<Pick<WebGLRenderingContext, 'drawingBufferColorSpace'>>

/**
 * CanvasKit 0.41 wraps sRGB on-screen surfaces as RGBA8, but all other color spaces
 * as RGBA16F. Browser drawing buffers remain RGBA8 when their color space changes,
 * so using DISPLAY_P3 causes invalid destination copies and broken blend modes.
 * Keep presentation in sRGB until CanvasKit can wrap an RGBA8 P3 framebuffer.
 * This does not change the document's color space or its stored colors.
 */
export function configureDrawingBufferColorSpace(context: ColorManagedContext | null): boolean {
  if (!context?.drawingBufferColorSpace) return true
  try {
    if (context.drawingBufferColorSpace !== 'srgb') context.drawingBufferColorSpace = 'srgb'
  } catch {
    return false
  }
  // A browser may silently ignore the setter; read back rather than trusting TS narrowing.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return context.drawingBufferColorSpace === 'srgb'
}

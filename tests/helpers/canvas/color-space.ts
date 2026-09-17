import type { Page } from '@playwright/test'

/** Exercise the P3 surface negotiation even on an sRGB CI display. */
export async function emulateWideGamutDisplay(page: Page) {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      const result = matchMedia(query)
      if (query === '(color-gamut: p3)') Object.defineProperty(result, 'matches', { value: true })
      return result
    }
  })
}

export async function focusReferenceEffects(page: Page) {
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    const effects = store.graph
      .getChildren(store.state.currentPageId)
      .find((n) => n.name === 'Effects')
    if (!effects) throw new Error('Reference effects unavailable')
    store.setDocumentColorSpace('display-p3')
    store.select([effects.id])
    store.zoomToSelection()
    store.clearSelection()
  })
}

export async function waitForSettledScene(page: Page) {
  await page.waitForFunction(() => {
    const store = window.openPencil?.getStore?.()
    const renderer = store?.canvasRenderers.find((r) => r.tracksSceneSettlement)
    return (
      store?.state.navigation.phase === 'idle' &&
      renderer &&
      !renderer.sceneBackingNeedsCrispRender &&
      !renderer.sceneBackingBuild
    )
  })
}

export async function sceneBufferState(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-test-id="scene-canvas-element"]'
    )
    const gl = canvas?.getContext('webgl2')
    if (!gl) throw new Error('Scene WebGL context unavailable')
    return {
      colorSpace: gl.drawingBufferColorSpace,
      documentColorSpace: window.openPencil?.getStore?.().graph.documentColorSpace,
      error: gl.getError()
    }
  })
}

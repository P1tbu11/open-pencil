import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
  dismissWideGamutBanner,
  emulateWideGamutDisplay,
  focusReferenceEffects,
  sceneBufferState,
  waitForSettledScene
} from '#tests/helpers/canvas/color-space'
import { selectDemoReferencePage } from '#tests/helpers/demo'

test.use({ viewport: { width: 1200, height: 900 } })

test('P3 reference blends and masks survive pan, zoom, and surface resize', async ({ page }) => {
  await emulateWideGamutDisplay(page)
  await page.goto('/demo?no-chrome&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await dismissWideGamutBanner(page)
  await selectDemoReferencePage(page)
  await focusReferenceEffects(page)
  await waitForSettledScene(page)

  async function expectEffects() {
    const buffer = await sceneBufferState(page)
    expect(buffer).toEqual({ colorSpace: 'srgb', documentColorSpace: 'display-p3', error: 0 })
    expect(await canvas.screenshotCanvas()).toMatchSnapshot('reference-effects.png')
    canvas.assertNoErrors()
  }
  await expectEffects()

  await canvas.canvas.hover()
  await page.mouse.wheel(80, 40)
  await page.keyboard.down('Control')
  try {
    await page.mouse.wheel(0, -120)
  } finally {
    await page.keyboard.up('Control')
  }
  await waitForSettledScene(page)
  expect((await sceneBufferState(page)).error).toBe(0)

  await page.setViewportSize({ width: 1320, height: 960 })
  await waitForSettledScene(page)
  expect((await sceneBufferState(page)).error).toBe(0)
  await page.setViewportSize({ width: 1200, height: 900 })
  await focusReferenceEffects(page)
  await waitForSettledScene(page)
  await expectEffects()
})

test('warns when a Display-P3 document cannot be presented in wide gamut', async ({ page }) => {
  await page.goto('/demo?no-chrome&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  // This project renders through SwiftShader or WebKit, so wide gamut is unavailable and
  // the canvas falls back to an sRGB buffer for the Display-P3 document.
  expect(await sceneBufferState(page)).toMatchObject({
    colorSpace: 'srgb',
    documentColorSpace: 'display-p3'
  })

  const banner = page.getByTestId('wide-gamut-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Display-P3')

  await page.evaluate(() => window.openPencil?.getStore?.()?.setDocumentColorSpace('srgb'))
  await expect(banner).toBeHidden()
})

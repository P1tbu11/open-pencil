import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
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

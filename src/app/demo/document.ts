import { computeAllLayouts } from '@open-pencil/core/layout'

import { yieldToUI } from '@/app/document/io/browser'
import type { EditorStore } from '@/app/editor/session'

import { createAnnouncementSection } from './announcement/section'
import { loadDemoFonts } from './fonts'
import { createPaintSection } from './paint/section'
import { createComponentsSection } from './sections/components'
import { createDemoVariables } from './sections/variables'
import { createTypographySection } from './typography/section'
import { fitDemoPagesOnFirstVisit } from './viewport'

const PAGE_ORIGIN = 60
const PAGE_GAP = 64

export async function createDemoShapes(store: EditorStore) {
  const { graph } = store
  const initialPageId = store.state.currentPageId
  // Report the same preparation phases as a document open so the canvas overlay
  // and tab indicator cover demo generation instead of an empty canvas.
  const load = store.preparationController.begin({ kind: 'demo-load', phase: 'materializing' })
  const abandoned = () => store.graph !== graph || load.signal.aborted
  let succeeded = false
  try {
    await store.canvasReady
    // A file opened while the canvas was loading must not receive demo content.
    if (
      abandoned() ||
      store.state.currentPageId !== initialPageId ||
      graph.getPages().length !== 1 ||
      graph.getChildren(initialPageId).length > 0
    )
      return

    const buildStep = (completed: number) =>
      load.update({ phase: 'materializing', completed, total: 4, unit: 'pages' })

    buildStep(0)
    await yieldToUI()
    await loadDemoFonts()

    graph.updateNode(initialPageId, { name: '01 · Components & variables' })
    const typography = graph.addPage('02 · Typography')
    const paint = graph.addPage('03 · Paint & effects')

    // Build page 01 while it is still the current page, so shape creation inside
    // the section helpers lands here rather than on a leftover empty page.
    const announcement = await createAnnouncementSection(graph, initialPageId)
    graph.updateNode(announcement.rootId, { x: PAGE_ORIGIN, y: PAGE_ORIGIN })
    buildStep(1)
    if (abandoned()) return

    computeAllLayouts(graph, initialPageId)
    await createComponentsSection(graph, initialPageId, {
      x: PAGE_ORIGIN,
      y: PAGE_ORIGIN + (graph.getNode(announcement.rootId)?.height ?? 0) + PAGE_GAP
    })
    createDemoVariables(store)
    buildStep(2)
    if (abandoned()) return

    await createTypographySection(graph, typography.id)
    buildStep(3)
    if (abandoned()) return

    await createPaintSection(graph, paint.id)
    buildStep(4)
    if (abandoned()) return

    const pages = graph.getPages()
    load.update({ phase: 'resolving-fonts', completed: 0, total: pages.length, unit: 'pages' })
    for (const [index, page] of pages.entries()) {
      await store.loadFontsForNodes(page.childIds)
      if (abandoned()) return
      load.update({
        phase: 'resolving-fonts',
        completed: index + 1,
        total: pages.length,
        unit: 'pages'
      })
    }

    load.update({ phase: 'layout' })
    await yieldToUI()
    for (const page of pages) computeAllLayouts(graph, page.id)
    if (abandoned()) return

    store.undo.clear()
    fitDemoPagesOnFirstVisit(
      store,
      graph.getPages().map((page) => page.id)
    )
    await store.switchPage(initialPageId, { preparation: load })
    if (abandoned()) return

    store.clearSelection()
    store.zoomToFit()
    load.update({ phase: 'preparing-render' })
    store.requestRender()
    await store.preparationController.waitForPresentation(load.id, store.state.sceneVersion)
    succeeded = true
  } catch (error) {
    if (!load.signal.aborted) {
      load.fail({
        code: 'layout-failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      })
      console.warn('[Demo] Failed to prepare the demo document:', error)
    }
  } finally {
    // A failed or superseded handle has already cleared itself, so this is a no-op then.
    if (succeeded) load.complete()
    else load.cancel('superseded')
  }
}

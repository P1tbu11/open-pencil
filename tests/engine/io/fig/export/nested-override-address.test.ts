import { expect, test } from 'bun:test'

import { exportFigFile, FigmaAPI, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/fig'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import { expectDefined } from '#tests/helpers/assert'

// Captured from Figma's own clipboard encoding of the same edit: a text override inside a
// nested instance is addressed as [nested instance, the nested component's child], never as
// the enclosing component's copy of that child, which is not a record in the archive.
test('an override inside a nested instance addresses the definition child', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const api = new FigmaAPI(graph)
  const page = graph.getPages()[0]
  const badge = graph.createNode('COMPONENT', page.id, { name: 'Badge', width: 40, height: 20 })
  graph.createNode('TEXT', badge.id, { name: 'count', text: '1', width: 20, height: 16 })
  const card = graph.createNode('COMPONENT', page.id, { name: 'Card', width: 200, height: 80 })
  graph.createInstance(badge.id, card.id)
  const instance = graph.createInstance(card.id, page.id)
  const nestedBadge = expectDefined(graph.getChildren(instance.id)[0], 'nested badge')
  const count = expectDefined(graph.getChildren(nestedBadge.id)[0], 'nested count')
  api.wrapNode(count.id).characters = '42'

  const bytes = await exportFigFile(graph)
  const { nodeChanges } = parseFigBuffer(bytes.slice().buffer as ArrayBuffer)
  const ids = new Set(nodeChanges.flatMap((node) => (node.guid ? [guidToString(node.guid)] : [])))
  const exported = expectDefined(
    nodeChanges.find(
      (node) => node.type === 'INSTANCE' && node.symbolData?.symbolOverrides?.length
    ),
    'exported instance'
  )
  const claim = expectDefined(
    exported.symbolData?.symbolOverrides?.find((override) => override.textData),
    'text claim'
  )
  const path = (claim.guidPath?.guids ?? []).map(guidToString)
  expect(path).toHaveLength(2)
  for (const segment of path) expect(ids.has(segment)).toBe(true)
  const definitionCount = nodeChanges.find((node) => node.type === 'TEXT' && node.name === 'count')
  expect(path[1]).toBe(guidToString(expectDefined(definitionCount?.guid, 'count guid')))

  const reopened = await parseFigFile(bytes.slice().buffer as ArrayBuffer)
  const reopenedInstance = expectDefined(
    [...reopened.getAllNodes()].find(
      (node) => node.type === 'INSTANCE' && node.parentId === reopened.getPages()[0].id
    ),
    'reopened instance'
  )
  const reopenedCount = reopened.getChildren(reopened.getChildren(reopenedInstance.id)[0].id)[0]
  expect(reopenedCount?.text).toBe('42')
})

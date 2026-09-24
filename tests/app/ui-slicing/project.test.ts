import { expect, test } from 'bun:test'

import { packProject, unpackProject } from '@/app/ui-slicing/project'

test('portable project restores the source, annotations and extracted pixels', () => {
  const source = { name: '游戏', width: 10, height: 10, dataURL: 'data:image/png;base64,YWJj' }
  const region = {
    id: 'a',
    name: '图片',
    kind: 'image' as const,
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    z: 0
  }
  const result = {
    version: 1 as const,
    name: '游戏',
    width: 10,
    height: 10,
    layers: [{ ...region, bytes: new Uint8Array([1, 2, 3]) }]
  }
  const restored = unpackProject(packProject({ source, regions: [region], result }))
  expect(restored.source).toEqual(source)
  expect(restored.regions).toEqual([region])
  expect(restored.result).toEqual(result)
})

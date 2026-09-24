import { expect, test } from 'bun:test'

import { readPsd } from 'ag-psd'

import { encodePSD } from '@/app/ui-slicing/psd'

test('PSD retains top-to-bottom layer order, positions and editable text', () => {
  const pixels = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) }
  const file = encodePSD(
    {
      version: 1,
      name: 'test',
      width: 200,
      height: 100,
      layers: [
        {
          id: 'a',
          name: 'icon',
          kind: 'image',
          x: 10,
          y: 20,
          width: 2,
          height: 2,
          z: 0,
          bytes: new Uint8Array([1])
        },
        {
          id: 'b',
          name: 'amount',
          kind: 'text',
          x: 30,
          y: 20,
          width: 80,
          height: 25,
          z: 1,
          text: '3680',
          fontSize: 20,
          fontFamily: 'Arial',
          color: '#ffffff'
        }
      ]
    },
    new Map([
      ['a', pixels],
      ['b', pixels]
    ])
  )
  const restored = readPsd(file, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true
  })
  expect(restored.children?.map((layer) => layer.name)).toEqual(['amount', 'icon'])
  expect(restored.children?.[0]?.text?.text).toBe('3680')
  expect(restored.children?.[1]?.left).toBe(10)
  expect(restored.children?.[1]?.top).toBe(20)
})

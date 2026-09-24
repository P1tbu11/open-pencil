import { expect, test } from 'bun:test'

import { strFromU8, unzipSync } from 'fflate'

import { exportEngine } from '@/app/ui-slicing/engines'

test('Godot archive contains a runnable scene, independent texture and native label', () => {
  const result = {
    version: 1 as const,
    name: 'game',
    width: 800,
    height: 600,
    layers: [
      {
        id: 'a',
        name: '../coin',
        kind: 'image' as const,
        x: 20,
        y: 30,
        width: 40,
        height: 40,
        z: 0,
        bytes: new Uint8Array([1])
      },
      {
        id: 'b',
        name: 'count',
        kind: 'text' as const,
        x: 65,
        y: 30,
        width: 100,
        height: 40,
        z: 1,
        text: '3680',
        fontSize: 24,
        color: '#ffffff'
      }
    ]
  }
  const files = unzipSync(exportEngine(result, 'godot'))
  const scene = strFromU8(files['ui.tscn'])
  expect(scene).toContain('type="Label"')
  expect(scene).toContain('text = "3680"')
  expect(scene).toContain('offset_left = 65')
  expect(scene).toContain('type="TextureRect"')
  expect(files['assets/layer-0.png']).toEqual(new Uint8Array([1]))
  expect(Object.keys(files).some((path) => path.includes('..'))).toBe(false)
})

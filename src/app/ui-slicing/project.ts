import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import * as v from 'valibot'

import { parseRegions, parseResult, regionsSchema } from './schema'
import type { SliceRegion, SliceResult, SliceSource } from './types'

export interface SliceProject {
  source: SliceSource
  regions: SliceRegion[]
  result?: SliceResult
}

const projectSchema = v.object({
  format: v.literal('ui-slice-studio/1'),
  source: v.object({
    name: v.string(),
    width: v.number(),
    height: v.number(),
    dataURL: v.pipe(
      v.string(),
      v.maxLength(45_000_000),
      v.regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    )
  }),
  annotations: regionsSchema,
  result: v.optional(regionsSchema)
})

export function packProject(project: SliceProject): Uint8Array {
  const annotations = parseRegions({ version: 1, ...project.source, layers: project.regions })
  const result = project.result ? parseResult(project.result) : undefined
  if (
    result &&
    (result.width !== project.source.width || result.height !== project.source.height)
  ) {
    throw new Error('结果画板尺寸已改变，请用原生设计文件保存，或恢复原图尺寸后保存拆分工程')
  }
  const files: Zippable = {}
  result?.layers.forEach((layer, index) => {
    if (layer.bytes) files[`assets/${index}.png`] = layer.bytes
  })
  files['project.json'] = strToU8(
    JSON.stringify({
      format: 'ui-slice-studio/1',
      source: project.source,
      annotations,
      result: result && {
        ...result,
        layers: result.layers.map(({ bytes: _bytes, ...layer }) => layer)
      }
    })
  )
  return zipSync(files)
}

export function unpackProject(bytes: Uint8Array): SliceProject {
  if (bytes.length > 80_000_000) throw new Error('工程包超过 80 MB')
  let expanded = 0
  const files = unzipSync(bytes, {
    filter: (entry) => {
      expanded += entry.originalSize
      if (expanded > 160_000_000) throw new Error('工程包展开后过大')
      return entry.name === 'project.json' || /^assets\/\d+\.png$/.test(entry.name)
    }
  })
  if (!files['project.json']) throw new Error('缺少工程清单')
  const data = v.parse(projectSchema, JSON.parse(strFromU8(files['project.json'])))
  parseRegions({ version: 1, ...data.source, layers: data.annotations.layers })
  if (
    data.result &&
    (data.result.width !== data.source.width || data.result.height !== data.source.height)
  ) {
    throw new Error('工程源图与结果尺寸不一致')
  }
  return {
    source: data.source,
    regions: data.annotations.layers,
    result: data.result
      ? parseResult({
          ...data.result,
          layers: data.result.layers.map((layer, index) => ({
            ...layer,
            ...(layer.kind === 'image' ? { bytes: files[`assets/${index}.png`] } : {})
          }))
        })
      : undefined
  }
}

import * as v from 'valibot'

const finite = () => v.pipe(v.number(), v.finite())
const size = () => v.pipe(finite(), v.minValue(1), v.maxValue(8192))
const label = () => v.pipe(v.string(), v.minLength(1), v.maxLength(200))

export const regionSchema = v.object({
  id: label(),
  name: label(),
  kind: v.picklist(['image', 'text']),
  x: v.pipe(finite(), v.minValue(0)),
  y: v.pipe(finite(), v.minValue(0)),
  width: size(),
  height: size(),
  z: v.pipe(finite(), v.integer()),
  text: v.optional(v.pipe(v.string(), v.maxLength(10000))),
  fontSize: v.optional(v.pipe(finite(), v.minValue(1), v.maxValue(1000))),
  fontFamily: v.optional(label()),
  color: v.optional(v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/)))
})

const documentFields = {
  version: v.literal(1),
  name: label(),
  width: size(),
  height: size()
}

export const regionsSchema = v.pipe(
  v.object({ ...documentFields, layers: v.pipe(v.array(regionSchema), v.maxLength(500)) }),
  v.check((value) => validBounds(value), '区域越界、重复 ID 或图片尺寸过大')
)

export const resultSchema = v.pipe(
  v.object({
    ...documentFields,
    layers: v.pipe(
      v.array(
        v.pipe(
          v.object({ ...regionSchema.entries, bytes: v.optional(v.instance(Uint8Array)) }),
          v.check(
            (layer) =>
              layer.kind === 'text' ? Boolean(layer.text?.trim()) : Boolean(layer.bytes?.length),
            '图层缺少文字或图片素材'
          )
        )
      ),
      v.minLength(1),
      v.maxLength(500)
    )
  }),
  v.check((value) => validBounds(value), '区域越界、重复 ID 或图片尺寸过大')
)

function validBounds(value: {
  width: number
  height: number
  layers: { id: string; x: number; y: number; width: number; height: number }[]
}) {
  return (
    value.width * value.height <= 32_000_000 &&
    value.layers.reduce((area, layer) => area + layer.width * layer.height, 0) <= 64_000_000 &&
    new Set(value.layers.map((layer) => layer.id)).size === value.layers.length &&
    value.layers.every(
      (layer) =>
        layer.x + layer.width <= value.width + 0.01 && layer.y + layer.height <= value.height + 0.01
    )
  )
}

export function parseResult(value: unknown) {
  return v.parse(resultSchema, value)
}

export function parseRegions(value: unknown) {
  return v.parse(regionsSchema, value)
}

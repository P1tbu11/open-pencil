import * as v from 'valibot'

import { parseRegions, parseResult, regionSchema } from './schema'
import type { SliceRegion, SliceSource } from './types'

const wireLayer = v.object({
  ...regionSchema.entries,
  pngBase64: v.optional(v.pipe(v.string(), v.maxLength(45_000_000), v.regex(/^[A-Za-z0-9+/=]+$/)))
})
const responseSchema = v.object({ layers: v.pipe(v.array(wireLayer), v.maxLength(500)) })

export interface SliceProvider {
  url: string
  token: string
}

export async function requestSlices(
  provider: SliceProvider,
  action: 'detect' | 'split' | 'ocr',
  source: SliceSource,
  regions: SliceRegion[],
  signal: AbortSignal
) {
  if (!provider.url.trim()) throw new Error('请先填写拆分服务地址，或使用本地快速拆分')
  const url = new URL(provider.url)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('服务地址需使用 HTTPS，本机服务可使用 HTTP')
  }
  const response = await fetch(`${url.href.replace(/\/$/, '')}/${action}`, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
    headers: {
      'Content-Type': 'application/json',
      ...(provider.token ? { Authorization: `Bearer ${provider.token}` } : {})
    },
    body: JSON.stringify({ version: 1, source, regions }),
    credentials: 'omit',
    redirect: 'error'
  })
  if (!response.ok) {
    const failure = v.safeParse(
      v.object({ error: v.string() }),
      await response.json().catch(() => null)
    )
    throw new Error(
      failure.success ? failure.output.error : `拆分服务返回 ${response.status}，请检查配置后重试`
    )
  }
  const raw = await response.text()
  if (raw.length > 120_000_000) throw new Error('模型返回的结果过大')
  const data = v.parse(responseSchema, JSON.parse(raw))
  if (action !== 'split') return parseRegions({ version: 1, ...source, layers: data.layers }).layers
  return parseResult({
    version: 1,
    ...source,
    layers: data.layers.map(({ pngBase64, ...layer }) => ({
      ...layer,
      ...(pngBase64
        ? { bytes: Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0)) }
        : {})
    }))
  }).layers
}

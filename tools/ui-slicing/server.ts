import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import * as v from 'valibot'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts'

import { parseRegions } from '@/app/ui-slicing/schema'

const sourceSchema = v.object({
  name: v.pipe(v.string(), v.maxLength(200)),
  width: v.number(),
  height: v.number(),
  dataURL: v.pipe(
    v.string(),
    v.maxLength(45_000_000),
    v.regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  )
})
const bodySchema = v.object({ source: sourceSchema, regions: v.optional(v.array(v.unknown()), []) })
const origins = new Set(['http://127.0.0.1:1420', 'http://localhost:1420'])
const workspaceRoot = await resolveWorkspaceRoot(import.meta.dir)
const ocrBinary = join(workspaceRoot, 'scratch/ui-slice-ocr')
const qwenPython = join(workspaceRoot, 'scratch/.venv/bin/python')
const qwenScript = join(import.meta.dir, 'qwen-layered.py')
const qwenToken = join(homedir(), '.config/ui-slice-studio/modelscope-token.txt')
const prompt = await Bun.file(join(import.meta.dir, 'detection-prompt.md')).text()
async function recognizeText(source: v.InferOutput<typeof sourceSchema>) {
  if (process.platform !== 'darwin' || !(await Bun.file(ocrBinary).exists()))
    throw new Error('本机 OCR 未准备好，请运行 bun run slice:setup')
  const directory = await mkdtemp(join(tmpdir(), 'ui-slice-'))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const imagePath = join(directory, 'image')
    await Bun.write(imagePath, Buffer.from(source.dataURL.split(',')[1], 'base64'))
    const process = Bun.spawn([ocrBinary, imagePath], { stdout: 'pipe', stderr: 'pipe' })
    timeout = setTimeout(() => process.kill(), 60_000)
    const output = await new Response(process.stdout).text()
    if ((await process.exited) !== 0) throw new Error('本机文字识别失败，请换一张清晰图片重试')
    const data = JSON.parse(output)
    const validated = parseRegions({ version: 1, ...source, layers: data.layers })
    return { layers: validated.layers }
  } finally {
    if (timeout) clearTimeout(timeout)
    await rm(directory, { recursive: true, force: true })
  }
}

const qwenOutput = v.object({
  width: v.number(),
  height: v.number(),
  layers: v.array(v.object({ name: v.string(), path: v.string() }))
})

async function splitWithQwen(body: v.InferOutput<typeof bodySchema>, signal: AbortSignal) {
  if (!(await Bun.file(qwenPython).exists()))
    throw new Error('分层客户端未安装，请先准备 scratch/.venv 里的 gradio_client 和 pillow')
  const directory = await mkdtemp(join(tmpdir(), 'ui-slice-qwen-'))
  try {
    const imagePath = join(directory, 'source')
    await Bun.write(imagePath, Buffer.from(body.source.dataURL.split(',')[1] ?? '', 'base64'))
    const proc = Bun.spawn([qwenPython, qwenScript, imagePath, directory], {
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const stop = () => proc.kill()
    signal.addEventListener('abort', stop, { once: true })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])
    signal.removeEventListener('abort', stop)
    if (signal.aborted) throw new Error('已取消千问分层')
    if (code !== 0) {
      const detail = stderr.trim().split('\n').at(-1)
      throw new Error(detail || '千问分层失败，请稍后重试')
    }
    const parsed = v.parse(qwenOutput, JSON.parse(stdout))
    const layers = await Promise.all(
      parsed.layers.map(async (layer, index) => ({
        id: `qwen-${index + 1}`,
        name: layer.name,
        kind: 'image' as const,
        x: 0,
        y: 0,
        width: body.source.width,
        height: body.source.height,
        z: index,
        pngBase64: (await readFile(layer.path)).toString('base64')
      }))
    )
    return { layers }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function detectVision(body: v.InferOutput<typeof bodySchema>, signal: AbortSignal) {
  const url = process.env.VISION_API_URL
  if (!url) throw new Error('尚未配置 VISION_API_URL；可先用本机文字识别')
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VISION_API_KEY ?? ''}`
    },
    body: JSON.stringify({
      model: process.env.VISION_MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Original dimensions: ${body.source.width} x ${body.source.height} pixels.`
            },
            { type: 'image_url', image_url: { url: body.source.dataURL } }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    })
  })
  if (!response.ok) throw new Error(`视觉模型请求失败 (${response.status})`)
  const responseSchema = v.object({
    choices: v.array(v.object({ message: v.object({ content: v.string() }) }))
  })
  const data = v.parse(responseSchema, await response.json())
  const content = data.choices[0]?.message.content
  if (!content) throw new Error('模型返回空内容')
  const detected = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  return { layers: parseRegions({ version: 1, ...body.source, layers: detected.layers }).layers }
}

let busy = false
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 1421,
  maxRequestBodySize: 50_000_000,
  idleTimeout: 255,
  async fetch(request) {
    const origin = request.headers.get('origin')
    if (origin && !origins.has(origin)) return new Response('Forbidden origin', { status: 403 })
    const headers = {
      'Access-Control-Allow-Origin': origin ?? 'http://127.0.0.1:1420',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin'
    }
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const path = new URL(request.url).pathname
    if (path === '/health')
      return json({
        ocr: process.platform === 'darwin',
        detection: Boolean(process.env.VISION_API_URL),
        splitting: Boolean(process.env.SLICE_WORKER_URL) || (await Bun.file(qwenToken).exists())
      })
    if (request.method !== 'POST' || !['/ocr', '/detect', '/split'].includes(path))
      return json({ error: 'Not found' }, 404)
    if (busy) return json({ error: '另一个拆分任务正在处理，请稍后再试' }, 409)
    busy = true
    try {
      const body = v.parse(bodySchema, await request.json())
      parseRegions({ version: 1, ...body.source, layers: body.regions })
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(240_000)])
      if (path === '/ocr') return json(await recognizeText(body.source))
      if (path === '/detect') return json(await detectVision(body, signal))
      const worker = process.env.SLICE_WORKER_URL
      if (!worker) {
        if (!(await Bun.file(qwenToken).exists()))
          return json({ error: '尚未配置透明分层与背景补全服务；本地快速拆分可继续使用' }, 503)
        return json(await splitWithQwen(body, signal))
      }
      const response = await fetch(worker.replace(/\/$/, '') + '/split', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SLICE_WORKER_TOKEN
            ? { Authorization: `Bearer ${process.env.SLICE_WORKER_TOKEN}` }
            : {})
        },
        body: JSON.stringify({ version: 1, ...body })
      })
      if (!response.ok) throw new Error(`分层服务请求失败 (${response.status})`)
      return new Response(response.body, {
        headers: { ...headers, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '请求失败' }, 400)
    } finally {
      busy = false
    }
  }
})
console.log(`UI Slice local service: http://127.0.0.1:${server.port}`)

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { getActiveEditorStore } from '@/app/editor/active-store'
import { loadFont } from '@/app/editor/fonts'
import { canvasImageNode, sourceFromCanvasImage } from '@/app/ui-slicing/canvas-source'
import type { EngineTarget } from '@/app/ui-slicing/engines'
import { importSliceResult } from '@/app/ui-slicing/import'
import {
  canvasPNG,
  downloadFile,
  imageCanvas,
  loadImage,
  readSource,
  splitLocally
} from '@/app/ui-slicing/media'
import { packProject, unpackProject } from '@/app/ui-slicing/project'
import { requestSlices } from '@/app/ui-slicing/provider'
import { readFrame } from '@/app/ui-slicing/scene'
import { sliceSession } from '@/app/ui-slicing/session'
import type { SliceRegion, SliceResult } from '@/app/ui-slicing/types'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialog from '@/components/ui/dialog/AppDialog.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import RegionBoard from './RegionBoard.vue'

const editor = getActiveEditorStore()
const { project, state } = sliceSession(editor.graph)
const open = ref(false)
const busy = ref(false)
const error = ref('')
const status = ref('')
const settings = ref(false)
const preview = ref('')
const exportTarget = ref<EngineTarget | 'psd'>('psd')
const exportFrameId = computed(() => {
  if (state.frameId && editor.graph.getNode(state.frameId)) return state.frameId
  return (
    [...editor.state.selectedIds].find((id) => editor.graph.getNode(id)?.type === 'FRAME') ?? ''
  )
})
async function exportCurrent() {
  await run(async (signal) => {
    const { exportSlices } = await import('@/app/ui-slicing/export')
    const file = await exportSlices(editor, exportFrameId.value, exportTarget.value)
    signal.throwIfAborted()
    downloadFile(file.bytes, file.name)
    status.value = '导出文件已下载；引擎适配包内附有导入步骤'
  })
}
let controller: AbortController | undefined
const canvasImage = computed(() => canvasImageNode(editor.graph, editor.state.selectedIds))
const selected = computed(() =>
  project.value?.regions.find((region) => region.id === state.selectedId)
)
const ordered = computed(() => [...(project.value?.regions ?? [])].sort((a, b) => b.z - a.z))
const overlaps = computed(() => {
  const a = selected.value
  return a
    ? (project.value?.regions ?? []).filter(
        (b) =>
          a.id !== b.id &&
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
      ).length
    : 0
})
const numericFields = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: '宽' },
  { key: 'height', label: '高' },
  { key: 'z', label: '层级' }
] as const
function cancel() {
  if (!busy.value) return
  controller?.abort()
  status.value = '已取消，已完成的画布不受影响'
}
let splittingSelection = false
watch(open, (value) => {
  if (!value) {
    cancel()
    return
  }
  if (splittingSelection) return
  const node = canvasImage.value
  if (!node || (state.sourceNodeId === node.id && project.value)) return
  void useCanvasImage(node).catch((reason: unknown) => {
    status.value = ''
    error.value = reason instanceof Error ? reason.message : '无法读取画布图片'
  })
})
onBeforeUnmount(cancel)
async function run(action: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return
  controller = new AbortController()
  const signal = controller.signal
  busy.value = true
  error.value = ''
  try {
    await action(signal)
  } catch (reason) {
    if (!signal.aborted) error.value = reason instanceof Error ? reason.message : '操作失败，请重试'
  } finally {
    busy.value = false
  }
}
function update(region: SliceRegion) {
  if (!project.value || busy.value) return
  project.value = {
    ...project.value,
    result: undefined,
    regions: project.value.regions.map((r) => (r.id === region.id ? region : r))
  }
  preview.value = ''
  state.frameId = ''
}
function patchSelected(patch: Partial<SliceRegion>) {
  if (selected.value) update({ ...selected.value, ...patch })
}
function add(region: SliceRegion) {
  if (!project.value) return
  project.value = {
    ...project.value,
    result: undefined,
    regions: [...project.value.regions, region]
  }
  state.selectedId = region.id
  state.drawing = false
  state.frameId = ''
  preview.value = ''
}
function remove(id: string) {
  if (!project.value || busy.value) return
  project.value = {
    ...project.value,
    result: undefined,
    regions: project.value.regions.filter((r) => r.id !== id)
  }
  state.selectedId = ''
  state.frameId = ''
  preview.value = ''
}
function addCentered() {
  const source = project.value?.source
  if (!source) return
  add({
    id: crypto.randomUUID(),
    name: `图层 ${(project.value?.regions.length ?? 0) + 1}`,
    kind: 'image',
    x: Math.round(source.width / 4),
    y: Math.round(source.height / 4),
    width: Math.max(2, Math.round(source.width / 4)),
    height: Math.max(2, Math.round(source.height / 4)),
    z: project.value?.regions.length ?? 0,
    text: '',
    fontSize: 24,
    fontFamily: 'Inter',
    color: '#ffffff'
  })
}
async function useCanvasImage(node: NonNullable<typeof canvasImage.value>) {
  status.value = '正在读取画布上的图片…'
  const source = await sourceFromCanvasImage(editor.graph, node)
  project.value = { source, regions: [] }
  state.sourceNodeId = node.id
  state.selectedId = ''
  state.frameId = ''
  preview.value = ''
  status.value = `已使用画布上的「${source.name}」，可以直接拆分`
}
async function splitSelected() {
  const node = canvasImage.value
  if (!node || busy.value) return
  splittingSelection = true
  error.value = ''
  try {
    await run(async (signal) => {
      status.value = '正在读取画布上的图片…'
      const source = await sourceFromCanvasImage(editor.graph, node)
      project.value = { source, regions: [] }
      state.sourceNodeId = node.id
      state.selectedId = ''
      state.frameId = ''
      preview.value = ''
      status.value = '正在识别元素、抠图并补全背景…'
      const layers = await requestSlices(
        { url: state.serviceUrl, token: state.serviceToken },
        'split',
        source,
        [],
        signal
      )
      const result: SliceResult = {
        version: 1,
        name: source.name,
        width: source.width,
        height: source.height,
        layers
      }
      signal.throwIfAborted()
      if (getActiveEditorStore() !== editor || project.value?.source !== source)
        throw new Error('当前文档已切换，结果未写入画布，请重新开始')
      project.value = { source, regions: [], result }
      await placeResult(result, signal)
      status.value = `已生成 ${result.layers.length} 个图层，可直接在画布上编辑`
    })
  } finally {
    splittingSelection = false
  }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await run(async (signal) => {
    if (file.size > 80_000_000) throw new Error('请选择 80 MB 以内的工程文件')
    const next = file.name.endsWith('.uislice')
      ? unpackProject(new Uint8Array(await file.arrayBuffer()))
      : { source: await readSource(file), regions: [] }
    const image = await loadImage(next.source.dataURL)
    if (image.naturalWidth !== next.source.width || image.naturalHeight !== next.source.height)
      throw new Error('工程中记录的尺寸与源图不一致')
    signal.throwIfAborted()
    project.value = next
    state.sourceNodeId = ''
    state.selectedId = ''
    state.frameId = ''
    preview.value = ''
    status.value = '源图已就绪，可以开始框选区域'
  })
  input.value = ''
}
async function demo() {
  await run(async () => {
    const { canvas, context: c } = imageCanvas(960, 600)
    c.fillStyle = '#182237'
    c.fillRect(0, 0, 960, 600)
    c.fillStyle = '#eeb958'
    c.beginPath()
    c.arc(86, 70, 24, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#ffffff'
    c.font = 'bold 32px sans-serif'
    c.fillText('3680', 125, 81)
    c.fillStyle = '#889dbc'
    c.font = '20px sans-serif'
    c.fillText('UI SLICE / 示例大厅', 48, 160)
    c.fillStyle = '#385bd6'
    c.fillRect(280, 260, 400, 96)
    c.fillStyle = '#ffffff'
    c.font = '32px sans-serif'
    c.fillText('开始游戏', 410, 323)
    c.fillStyle = '#34c29c'
    c.fillRect(48, 470, 160, 64)
    c.fillStyle = '#182237'
    c.font = '24px sans-serif'
    c.fillText('背包', 104, 511)
    const make = (
      id: string,
      name: string,
      kind: 'image' | 'text',
      x: number,
      y: number,
      width: number,
      height: number,
      z: number,
      text = ''
    ): SliceRegion => ({
      id,
      name,
      kind,
      x,
      y,
      width,
      height,
      z,
      text,
      fontSize: 32,
      fontFamily: 'Inter',
      color: '#ffffff'
    })
    project.value = {
      source: {
        name: '示例游戏大厅',
        width: 960,
        height: 600,
        dataURL: canvas.toDataURL('image/png')
      },
      regions: [
        make('coin', '金币图标', 'image', 54, 38, 64, 64, 0),
        make('amount', '金币数量', 'text', 123, 48, 110, 44, 1, '3680'),
        make('button', '开始按钮', 'image', 275, 255, 410, 106, 2),
        make('bag', '背包按钮', 'image', 43, 465, 170, 74, 3)
      ]
    }
    state.sourceNodeId = ''
    state.selectedId = 'amount'
    state.frameId = ''
    preview.value = ''
    status.value = '示例附带 4 个预设区域，可直接修改或拆分'
  })
}
async function detect(localText = false) {
  const current = project.value
  if (!current) return
  await run(async (signal) => {
    status.value = localText ? '正在本机识别文字，图片不会发送到云端…' : '正在识别 UI 区域与文字…'
    const regions = await requestSlices(
      {
        url: localText ? 'http://127.0.0.1:1421' : state.serviceUrl,
        token: localText ? '' : state.serviceToken
      },
      localText ? 'ocr' : 'detect',
      current.source,
      [],
      signal
    )
    signal.throwIfAborted()
    const imageRegions = current.regions.filter((region) => region.kind !== 'text')
    const foregroundZ = Math.max(-1, ...imageRegions.map((region) => region.z)) + 1
    project.value = {
      source: current.source,
      regions: localText
        ? [
            ...imageRegions,
            ...regions.map((region, index) => ({ ...region, z: foregroundZ + index }))
          ]
        : regions
    }
    state.selectedId = regions[0]?.id ?? ''
    state.frameId = ''
    preview.value = ''
    status.value = localText
      ? `本机识别到 ${regions.length} 个文字区域；字体、字号与颜色请校正`
      : `识别到 ${regions.length} 个区域，请校正后拆分`
  })
}
async function generate(useAI: boolean) {
  const current = project.value
  if (!current) return
  await run(async (signal) => {
    status.value = useAI ? '正在识别元素、抠图并补全背景…' : '正在本地拆分…'
    const result: SliceResult = useAI
      ? {
          version: 1,
          name: current.source.name,
          width: current.source.width,
          height: current.source.height,
          layers: await requestSlices(
            { url: state.serviceUrl, token: state.serviceToken },
            'split',
            current.source,
            current.regions,
            signal
          )
        }
      : await splitLocally(current.source, current.regions, state, signal, (message) => {
          status.value = message
        })
    signal.throwIfAborted()
    if (getActiveEditorStore() !== editor || project.value !== current)
      throw new Error('当前文档已切换，结果未写入画布，请重新开始')
    project.value = { ...current, result }
    await placeResult(result, signal)
    status.value = `已生成 ${result.layers.length} 个可编辑图层，可关闭工作台继续编辑`
  })
}
async function placeResult(result: SliceResult, signal?: AbortSignal) {
  const pageId = editor.state.currentPageId
  for (const layer of result.layers)
    if (layer.bytes) {
      const url = URL.createObjectURL(new Blob([new Uint8Array(layer.bytes)]))
      try {
        await loadImage(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      signal?.throwIfAborted()
    }
  await Promise.all(
    result.layers
      .filter((layer) => layer.kind === 'text')
      .map((layer) => loadFont(layer.fontFamily ?? 'Inter', 'Regular', layer.text, signal))
  )
  signal?.throwIfAborted()
  if (getActiveEditorStore() !== editor || editor.state.currentPageId !== pageId)
    throw new Error('当前文档或页面已切换，请重新导入结果')
  const siblings = editor.graph.getChildren(editor.state.currentPageId)
  const x = siblings.length ? Math.max(...siblings.map((node) => node.x + node.width)) + 80 : 0
  state.frameId = importSliceResult(editor, result, { x, y: 0 }).frameId
  editor.zoomToSelection()
  const rendered = await editor.renderExportImage([state.frameId], 1, 'PNG')
  if (rendered) {
    const blob = new Blob([new Uint8Array(rendered)], { type: 'image/png' })
    if (preview.value) URL.revokeObjectURL(preview.value)
    preview.value = URL.createObjectURL(blob)
  }
}
async function saveProject() {
  const current = project.value
  if (!current) return
  await run(async (signal) => {
    const result =
      state.frameId && editor.graph.getNode(state.frameId)
        ? await readFrame(editor, state.frameId, editor.renderExportImage)
        : current.result
    signal.throwIfAborted()
    downloadFile(packProject({ ...current, result }), `${current.source.name}.uislice`)
    status.value = '工程包已下载，包含源图、区域及拆分结果'
  })
}
async function restoreResult() {
  await run(async (signal) => {
    if (project.value?.result) await placeResult(project.value.result, signal)
    status.value = '拆分工程已恢复到画布'
  })
}
async function saveSource() {
  if (!project.value) return
  const image = await loadImage(project.value.source.dataURL)
  const { canvas, context } = imageCanvas(image.naturalWidth, image.naturalHeight)
  context.drawImage(image, 0, 0)
  downloadFile(await canvasPNG(canvas), 'source.png', 'image/png')
}
</script>

<template>
  <div
    class="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1 rounded-xl border border-border bg-panel p-1 shadow-lg"
  >
    <div class="flex items-center gap-1">
      <AppButton
        color="primary"
        variant="solid"
        data-test-id="ui-slicing-open"
        @click="open = true"
      >
        <template #leading><icon-lucide-layers class="size-4" /></template>UI 拆分工作台
      </AppButton>
      <AppButton
        v-if="canvasImage && !busy"
        color="primary"
        variant="solid"
        data-test-id="ui-slicing-selection"
        @click="splitSelected"
      >
        <template #leading><icon-lucide-scissors class="size-4" /></template>拆分选中图片
      </AppButton>
      <AppButton v-if="busy && !open" @click="cancel">取消</AppButton>
    </div>
    <p
      v-if="!open && (error || status)"
      class="max-w-sm px-2 pb-0.5 text-center text-xs text-muted"
    >
      {{ error || status }}
    </p>
  </div>
  <AppDialog
    v-model:open="open"
    heading="UI 拆分工作台"
    description="从一张游戏界面，到可编辑的图片与文字图层"
    size="xl"
    height="full"
    :ui="{
      content: 'w-[min(1440px,96vw)] max-h-[94vh] h-[90vh]',
      body: 'p-0 flex flex-col overflow-hidden'
    }"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <label
        class="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs text-surface hover:bg-hover"
        :class="busy ? 'pointer-events-none opacity-50' : ''"
      >
        导入图片 / 工程<input
          data-test-id="ui-slicing-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp,.uislice"
          class="sr-only"
          :disabled="busy"
          @change="upload"
        />
      </label>
      <AppButton :disabled="busy" @click="demo">体验示例</AppButton>
      <span v-if="project" class="text-xs text-muted"
        >{{ project.source.name }} · {{ project.source.width }} × {{ project.source.height }}</span
      >
      <div class="flex-1" />
      <AppButton :disabled="busy" @click="settings = !settings">模型连接</AppButton>
      <AppButton :disabled="!project || busy" @click="saveProject">保存拆分工程</AppButton>
      <AppSelect
        v-model="exportTarget"
        label="导出格式"
        :options="[
          { value: 'psd', label: 'PSD 图层文件' },
          { value: 'assets', label: 'PNG 素材包' },
          { value: 'godot', label: 'Godot 4 场景' },
          { value: 'unity', label: 'Unity 导入包（待验收）' },
          { value: 'cocos3', label: 'Cocos 3.8 导入包（待验收）' },
          { value: 'cocos2', label: 'Cocos 2.4 导入包（待验收）' }
        ]"
        :disabled="busy"
      />
      <AppButton :disabled="!exportFrameId || busy" variant="outline" @click="exportCurrent"
        >导出结果</AppButton
      >
    </div>
    <div
      v-if="settings"
      class="flex flex-wrap items-center gap-3 border-b border-border bg-hover p-3"
    >
      <AppInput
        v-model="state.serviceUrl"
        aria-label="拆分服务地址"
        placeholder="https://your-service.example/api/ui-slicing"
        class="min-w-72 flex-1"
        :disabled="busy"
      />
      <AppInput
        v-model="state.serviceToken"
        type="password"
        aria-label="服务令牌"
        placeholder="服务令牌（仅本次会话）"
        :disabled="busy"
      />
      <p class="w-full text-xs text-muted">
        自动识别和 AI
        拆分会把源图发送到上方服务。令牌不写入工程或浏览器存储；服务需支持本项目的拆分接口。
      </p>
    </div>
    <div v-if="error" class="px-4 pt-3">
      <AppAlert tone="error" heading="操作未完成" :description="error" />
    </div>
    <div
      v-if="!project"
      class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <icon-lucide-scan class="size-12 text-accent" />
      <h2 class="text-xl font-semibold text-surface">把界面拆开，继续创作</h2>
      <p class="max-w-md text-sm leading-6 text-muted">
        先在画布上选中一张图片，再拆分。也可以导入 PNG、JPG、WebP。
      </p>
      <AppButton color="primary" variant="solid" :disabled="busy" @click="demo"
        >用示例走一遍</AppButton
      >
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside
        class="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3 lg:w-52"
      >
        <AppSelect
          v-model="state.mode"
          label="拆分模式"
          :options="[
            { value: 'controlled', label: '可控拆分' },
            { value: 'auto', label: '自动识别后拆分' }
          ]"
          :disabled="busy"
        />
        <AppButton
          v-if="state.mode === 'auto'"
          variant="solid"
          color="primary"
          :disabled="busy"
          @click="detect(false)"
          >识别全部区域</AppButton
        >
        <AppButton :disabled="busy" title="识别并替换文字区域，保留图片区域" @click="detect(true)"
          >本机文字识别</AppButton
        >
        <div class="flex gap-1">
          <AppButton
            :variant="state.drawing ? 'solid' : 'outline'"
            :disabled="busy"
            @click="state.drawing = !state.drawing"
            >绘制区域</AppButton
          >
          <AppButton :disabled="busy" @click="addCentered">添加</AppButton>
        </div>
        <p class="text-[11px] leading-5 text-muted">
          {{
            state.drawing ? '在图片上拖出一个框' : '拖动区域移动，右下角缩放。也可用方向键微调。'
          }}
        </p>
        <div class="flex items-center justify-between text-xs text-muted">
          <span>区域 {{ project.regions.length }}</span
          ><span>上方为前景</span>
        </div>
        <div class="flex flex-col gap-1">
          <AppButton
            v-for="region in ordered"
            :key="region.id"
            class="justify-start truncate"
            :variant="state.selectedId === region.id ? 'solid' : 'ghost'"
            :aria-pressed="state.selectedId === region.id"
            @click="state.selectedId = region.id"
          >
            <span class="mr-1 text-muted">{{ region.kind === 'text' ? 'T' : '▧' }}</span
            >{{ region.name }}
          </AppButton>
        </div>
      </aside>
      <main class="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        <div class="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
          <span>原图与识别框</span
          ><AppButton :disabled="busy" @click="saveSource">导出原图</AppButton>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-5">
          <RegionBoard
            :source="project.source"
            :regions="project.regions"
            :selected-id="state.selectedId"
            :drawing="state.drawing"
            :disabled="busy"
            @select="state.selectedId = $event"
            @add="add"
            @change="update"
            @remove="remove"
          />
          <div v-if="preview" class="mt-6">
            <p class="mb-2 text-xs text-muted">拆分后的合成预览 · 结果已放入画布</p>
            <img
              :src="preview"
              alt="拆分结果合成预览"
              class="mx-auto w-full max-w-5xl rounded border border-border"
            />
          </div>
        </div>
      </main>
      <aside class="w-full shrink-0 space-y-4 overflow-y-auto border-l border-border p-4 lg:w-64">
        <template v-if="selected">
          <h3 class="text-xs font-semibold text-surface">区域属性</h3>
          <label class="block space-y-1 text-xs text-muted"
            >图层名称<AppInput
              :model-value="selected.name"
              :disabled="busy"
              aria-label="图层名称"
              @update:model-value="patchSelected({ name: String($event) })"
          /></label>
          <AppSelect
            :model-value="selected.kind"
            label="区域类型"
            :options="[
              { value: 'image', label: 'UI 图片元素' },
              { value: 'text', label: '可编辑文字' }
            ]"
            :disabled="busy"
            @update:model-value="patchSelected({ kind: $event as 'image' | 'text' })"
          />
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="field in numericFields"
              :key="field.key"
              class="space-y-1 text-xs text-muted"
              >{{ field.label
              }}<AppInput
                type="number"
                :aria-label="field.label"
                :model-value="selected[field.key]"
                :disabled="busy"
                @update:model-value="patchSelected({ [field.key]: Number($event) })"
            /></label>
          </div>
          <p v-if="overlaps" class="text-xs text-amber-500">
            与 {{ overlaps }} 个区域重叠，层级数值越大越靠前。
          </p>
          <template v-if="selected.kind === 'text'">
            <label class="block space-y-1 text-xs text-muted"
              >文字内容<AppInput
                :model-value="selected.text ?? ''"
                aria-label="文字内容"
                :disabled="busy"
                @update:model-value="patchSelected({ text: String($event) })"
            /></label>
            <label class="block space-y-1 text-xs text-muted"
              >字体<AppInput
                :model-value="selected.fontFamily ?? 'Inter'"
                aria-label="字体"
                :disabled="busy"
                @update:model-value="patchSelected({ fontFamily: String($event) })"
            /></label>
            <label class="block space-y-1 text-xs text-muted"
              >字号<AppInput
                type="number"
                :min="1"
                :model-value="selected.fontSize ?? 24"
                aria-label="字号"
                :disabled="busy"
                @update:model-value="patchSelected({ fontSize: Number($event) })"
            /></label>
            <label class="block space-y-1 text-xs text-muted"
              >颜色<AppInput
                :model-value="selected.color ?? '#ffffff'"
                aria-label="文字颜色"
                :disabled="busy"
                @update:model-value="patchSelected({ color: String($event) })"
            /></label>
          </template>
          <AppButton :disabled="busy" @click="remove(selected.id)">删除区域</AppButton>
        </template>
        <p v-else class="text-xs leading-5 text-muted">
          选择一个区域，修改类型、名称、位置和层级。
        </p>
        <div class="space-y-3 border-t border-border pt-4">
          <h3 class="text-xs font-semibold text-surface">本地处理选项</h3>
          <label class="flex gap-2 text-xs text-muted"
            ><input
              v-model="state.removeBackground"
              type="checkbox"
              :disabled="busy"
            />去除边缘相连的纯色底</label
          >
          <label class="flex gap-2 text-xs text-muted"
            ><input
              v-model="state.repairBackground"
              type="checkbox"
              :disabled="busy"
            />填补原图区域（简单底色）</label
          >
          <label class="block space-y-1 text-xs text-muted"
            >去底容差<AppInput
              v-model="state.tolerance"
              type="number"
              :min="0"
              :max="255"
              aria-label="去底容差"
              :disabled="busy"
          /></label>
          <p class="text-[11px] leading-5 text-muted">
            本地处理适合纯色界面。复杂纹理、半透明发光和遮挡补全需要 AI 服务，结果请与原图对照。
          </p>
        </div>
      </aside>
    </div>
    <template #footer>
      <p role="status" aria-live="polite" class="mr-auto max-w-xl text-xs text-muted">
        {{ status || '选中画布上的图片，或导入文件' }}
      </p>
      <AppButton v-if="busy" @click="cancel">取消任务</AppButton>
      <template v-else>
        <AppButton v-if="project?.result && !state.frameId" @click="restoreResult"
          >恢复到画布</AppButton
        >
        <AppButton :disabled="!project?.regions.length" variant="outline" @click="generate(false)"
          >本地快速拆分</AppButton
        >
        <AppButton :disabled="!project" color="primary" variant="solid" @click="generate(true)"
          >AI 原位拆分</AppButton
        >
      </template>
    </template>
  </AppDialog>
</template>

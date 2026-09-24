<script setup lang="ts">
import { ref } from 'vue'

import type { SliceRegion, SliceSource } from '@/app/ui-slicing/types'

const { source, regions, selectedId, drawing, disabled } = defineProps<{
  source: SliceSource
  regions: SliceRegion[]
  selectedId: string
  drawing: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  change: [region: SliceRegion]
  add: [region: SliceRegion]
  remove: [id: string]
}>()
const board = ref<HTMLDivElement>()
const draft = ref<SliceRegion>()
let gesture:
  | { x: number; y: number; mode: 'draw' | 'move' | 'resize'; region: SliceRegion }
  | undefined
const style = (region: SliceRegion) => ({
  left: `${(region.x / source.width) * 100}%`,
  top: `${(region.y / source.height) * 100}%`,
  width: `${(region.width / source.width) * 100}%`,
  height: `${(region.height / source.height) * 100}%`
})
function point(event: PointerEvent) {
  const rect = board.value?.getBoundingClientRect()
  return rect
    ? {
        x: Math.max(
          0,
          Math.min(
            source.width - 1,
            Math.round(((event.clientX - rect.left) / rect.width) * source.width)
          )
        ),
        y: Math.max(
          0,
          Math.min(
            source.height - 1,
            Math.round(((event.clientY - rect.top) / rect.height) * source.height)
          )
        )
      }
    : { x: 0, y: 0 }
}
function start(event: PointerEvent, region?: SliceRegion, resize = false) {
  if (disabled || event.button !== 0 || (!region && !drawing)) return
  event.preventDefault()
  const p = point(event)
  if (region) emit('select', region.id)
  gesture = {
    ...p,
    mode: region ? (resize ? 'resize' : 'move') : 'draw',
    region: region
      ? { ...region }
      : {
          id: crypto.randomUUID(),
          name: `图层 ${regions.length + 1}`,
          kind: 'image',
          ...p,
          width: 1,
          height: 1,
          z: regions.length,
          text: '',
          fontSize: 24,
          fontFamily: 'Inter',
          color: '#ffffff'
        }
  }
  draft.value = { ...gesture.region }
  board.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!gesture) return
  const p = point(event)
  const r = gesture.region
  const dx = p.x - gesture.x
  const dy = p.y - gesture.y
  if (gesture.mode === 'draw')
    draft.value = {
      ...r,
      x: Math.min(p.x, gesture.x),
      y: Math.min(p.y, gesture.y),
      width: Math.max(1, Math.abs(dx)),
      height: Math.max(1, Math.abs(dy))
    }
  if (gesture.mode === 'move')
    draft.value = {
      ...r,
      x: Math.max(0, Math.min(source.width - r.width, r.x + dx)),
      y: Math.max(0, Math.min(source.height - r.height, r.y + dy))
    }
  if (gesture.mode === 'resize')
    draft.value = {
      ...r,
      width: Math.max(1, Math.min(source.width - r.x, r.width + dx)),
      height: Math.max(1, Math.min(source.height - r.y, r.height + dy))
    }
}
function end() {
  if (gesture && draft.value && draft.value.width >= 2 && draft.value.height >= 2) {
    if (gesture.mode === 'draw') emit('add', draft.value)
    else emit('change', draft.value)
  }
  gesture = undefined
  draft.value = undefined
}
function key(event: KeyboardEvent, region: SliceRegion) {
  if (disabled) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    emit('remove', region.id)
  }
  const step = event.shiftKey ? 10 : 1
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  }
  if (!delta[event.key]) return
  event.preventDefault()
  const [dx, dy] = delta[event.key]
  emit('change', {
    ...region,
    x: Math.max(0, Math.min(source.width - region.width, region.x + dx)),
    y: Math.max(0, Math.min(source.height - region.height, region.y + dy))
  })
}
function cancelGesture() {
  gesture = undefined
  draft.value = undefined
}
</script>

<template>
  <div
    ref="board"
    class="relative mx-auto w-full max-w-5xl touch-none select-none overflow-hidden rounded border border-border bg-canvas"
    :class="drawing ? 'cursor-crosshair' : ''"
    :style="{ aspectRatio: `${source.width}/${source.height}` }"
    @pointerdown="start($event)"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="cancelGesture"
  >
    <img
      :src="source.dataURL"
      alt="待拆分的原始图片"
      class="pointer-events-none absolute inset-0 size-full"
      draggable="false"
    />
    <button
      v-for="region in regions"
      :key="region.id"
      type="button"
      :aria-label="`区域 ${region.name}`"
      :aria-pressed="region.id === selectedId"
      class="absolute border-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white"
      :class="[
        region.id === selectedId
          ? 'z-10 border-accent bg-accent/15'
          : 'border-amber-400/80 hover:bg-amber-400/10',
        drawing ? 'pointer-events-none' : 'cursor-move'
      ]"
      :style="style(draft?.id === region.id ? draft : region)"
      @click="emit('select', region.id)"
      @pointerdown.stop="start($event, region)"
      @keydown="key($event, region)"
    >
      <span
        class="pointer-events-none absolute top-0 left-0 max-w-full truncate rounded-br bg-black/75 px-1 text-[10px] leading-4 text-white"
        >{{ region.name }}</span
      >
      <span
        v-if="region.id === selectedId && !disabled"
        class="absolute -right-1 -bottom-1 size-3 cursor-nwse-resize border border-white bg-accent"
        @pointerdown.stop="start($event, region, true)"
      />
    </button>
    <div
      v-if="draft && gesture?.mode === 'draw'"
      class="pointer-events-none absolute border-2 border-accent bg-accent/15"
      :style="style(draft)"
    />
  </div>
</template>

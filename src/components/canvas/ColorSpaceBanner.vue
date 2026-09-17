<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n, useEditorEvent, supportsWideGamutPresentation } from '@open-pencil/vue'

import { activeTab } from '@/app/tabs'
import AppBanner from '@/components/ui/feedback/AppBanner.vue'

const { rendering, common } = useI18n()

// Display-P3 documents present wide gamut only where the browser and display support it.
const show = ref(false)

function refresh() {
  const store = activeTab.value?.store
  show.value =
    !!store && store.graph.documentColorSpace === 'display-p3' && !supportsWideGamutPresentation()
}

watch(activeTab, refresh, { immediate: true })
useEditorEvent('document:color-space-changed', refresh)
useEditorEvent('graph:replaced', refresh)

const message = computed(() => rendering.value.wideGamutUnavailable)
</script>

<template>
  <AppBanner v-if="show" test-id="wide-gamut-banner" storage-key="wide-gamut-banner-dismissed">
    {{ message }}
    <template #dismiss>{{ common.dismiss }}</template>
  </AppBanner>
</template>

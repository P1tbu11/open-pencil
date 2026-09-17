<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'

import AppBanner from '@/components/ui/feedback/AppBanner.vue'
import { IS_BROWSER, IS_TAURI } from '@/constants'

const { files, common } = useI18n()
const show = !IS_TAURI && IS_BROWSER && !window.showSaveFilePicker
</script>

<template>
  <AppBanner v-if="show" test-id="safari-banner" storage-key="safari-banner-dismissed">
    {{ files.browserFileAPINotSupported }}
    <a href="https://www.google.com/chrome/" target="_blank" class="font-medium underline">
      {{ files.useChrome }}
    </a>
    {{ files.orEdgeForFullSupport }}
    <template #dismiss>{{ common.dismiss }}</template>
  </AppBanner>
</template>

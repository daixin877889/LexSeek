<template>
  <div class="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
    <div :id="domIds.elementId"></div>
    <button :id="domIds.buttonId" type="button" tabindex="-1"></button>
  </div>
</template>

<script setup lang="ts">
import type { AliyunCaptchaSceneKey } from '#shared/types/captcha'
import { getAliyunCaptchaDomIds } from '~/utils/aliyunCaptcha'

const props = defineProps<{
  scene: AliyunCaptchaSceneKey
}>()

const domIds = computed(() => getAliyunCaptchaDomIds(props.scene))
</script>

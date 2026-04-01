<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    :width="size"
    :height="size"
    :class="$attrs.class"
  >
    <!-- 头部轮廓 -->
    <rect x="4" y="4" width="16" height="14" rx="4" stroke="currentColor" stroke-width="1.5" />

    <!-- 天线 -->
    <line x1="12" y1="4" x2="12" y2="1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    <circle cx="12" cy="1" r="1" fill="currentColor" />

    <!-- 左眼 -->
    <circle cx="9" cy="10" r="1.5" fill="currentColor" />
    <circle cx="9.5" cy="9.5" r="0.5" fill="currentColor" opacity="0" />

    <!-- 右眼 -->
    <circle cx="15" cy="10" r="1.5" fill="currentColor" />
    <circle cx="15.5" cy="9.5" r="0.5" fill="currentColor" opacity="0" />

    <!-- 微笑 -->
    <path d="M9.5 13.5C10 14.5 11 15 12 15C13 15 14 14.5 14.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />

    <!-- 左耳 -->
    <rect x="1.5" y="8" width="2.5" height="5" rx="1.25" stroke="currentColor" stroke-width="1.2" />

    <!-- 右耳 -->
    <rect x="20" y="8" width="2.5" height="5" rx="1.25" stroke="currentColor" stroke-width="1.2" />

    <!-- 身体（小领结/连接处） -->
    <path d="M9 18L10.5 20.5H13.5L15 18" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />

    <!-- 腮红 -->
    <circle cx="7" cy="13" r="1" fill="currentColor" opacity="0.15" />
    <circle cx="17" cy="13" r="1" fill="currentColor" opacity="0.15" />
  </svg>
</template>

<script lang="ts" setup>
withDefaults(defineProps<{
  size?: number | string
}>(), {
  size: 24,
})
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    :width="size"
    :height="size"
    :class="$attrs.class"
  >
    <defs>
      <!-- 头部主渐变：紫蓝 -->
      <linearGradient id="xiaosuo-head" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#8B5CF6" />
        <stop offset="50%" stop-color="#6366F1" />
        <stop offset="100%" stop-color="#3B82F6" />
      </linearGradient>
      <!-- 面罩渐变：深色 -->
      <linearGradient id="xiaosuo-face" x1="0.5" y1="0" x2="0.5" y2="1">
        <stop offset="0%" stop-color="#312E81" />
        <stop offset="100%" stop-color="#1E1B4B" />
      </linearGradient>
      <!-- 高光 -->
      <radialGradient id="xiaosuo-glow" cx="0.4" cy="0.3" r="0.6">
        <stop offset="0%" stop-color="white" stop-opacity="0.35" />
        <stop offset="100%" stop-color="white" stop-opacity="0" />
      </radialGradient>
      <!-- 眼睛发光 -->
      <radialGradient id="xiaosuo-eye-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stop-color="#67E8F9" />
        <stop offset="100%" stop-color="#22D3EE" />
      </radialGradient>
    </defs>

    <!-- 头部椭圆体 -->
    <ellipse cx="50" cy="48" rx="38" ry="40" fill="url(#xiaosuo-head)" />

    <!-- 面罩（深色椭圆） -->
    <ellipse cx="50" cy="50" rx="30" ry="28" fill="url(#xiaosuo-face)" />

    <!-- 面罩光泽 -->
    <ellipse cx="50" cy="50" rx="30" ry="28" fill="url(#xiaosuo-glow)" />

    <!-- 面罩边缘高光弧 -->
    <path
      d="M24 38 Q50 22 76 38"
      fill="none"
      stroke="white"
      stroke-opacity="0.25"
      stroke-width="1.5"
    />

    <!-- 左眼 -->
    <ellipse cx="38" cy="50" rx="5" ry="5.5" fill="url(#xiaosuo-eye-glow)" />
    <ellipse cx="36.5" cy="48.5" rx="2" ry="2" fill="white" fill-opacity="0.7" />

    <!-- 右眼 -->
    <ellipse cx="62" cy="50" rx="5" ry="5.5" fill="url(#xiaosuo-eye-glow)" />
    <ellipse cx="60.5" cy="48.5" rx="2" ry="2" fill="white" fill-opacity="0.7" />

    <!-- 小嘴（微笑弧线） -->
    <path
      d="M44 62 Q50 67 56 62"
      fill="none"
      stroke="#67E8F9"
      stroke-width="2"
      stroke-linecap="round"
    />

    <!-- 左耳 -->
    <rect x="8" y="40" width="8" height="16" rx="4" fill="url(#xiaosuo-head)" />
    <rect x="9.5" y="43" width="5" height="10" rx="2.5" fill="url(#xiaosuo-face)" />

    <!-- 右耳 -->
    <rect x="84" y="40" width="8" height="16" rx="4" fill="url(#xiaosuo-head)" />
    <rect x="85.5" y="43" width="5" height="10" rx="2.5" fill="url(#xiaosuo-face)" />

    <!-- 头顶天线 -->
    <line x1="50" y1="10" x2="50" y2="2" stroke="url(#xiaosuo-head)" stroke-width="3" stroke-linecap="round" />
    <circle cx="50" cy="2" r="4" fill="#8B5CF6" />
    <circle cx="50" cy="2" r="4" fill="url(#xiaosuo-glow)" />

    <!-- 整体高光覆盖 -->
    <ellipse cx="42" cy="30" rx="20" ry="12" fill="white" fill-opacity="0.1" />
  </svg>
</template>

<script lang="ts" setup>
withDefaults(defineProps<{
  size?: number | string
}>(), {
  size: 24,
})
</script>

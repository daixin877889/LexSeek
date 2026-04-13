<script lang="ts" setup>
/**
 * 小索图标组件
 *
 * 将原始 xiaosuo.svg 内联为 Vue 组件，保持原始配色。
 * 使用 useId() 生成唯一 ID 避免多实例 SVG gradient 冲突。
 */
const gradientId = useId()
</script>

<template>
  <svg class="xiaosuo-icon" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient :id="gradientId" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#b8daff" />
        <stop offset="100%" stop-color="#4d9efb" />
      </linearGradient>
    </defs>
    <g transform="translate(0, -5)">
      <ellipse cx="80" cy="135" rx="40" ry="5" fill="#d0dbe9" />
      <rect x="8" y="65" width="18" height="42" rx="9" fill="#c3dcf5" />
      <rect x="134" y="65" width="18" height="42" rx="9" fill="#c3dcf5" />
      <rect x="20" y="35" width="120" height="90" rx="45" fill="#ffffff" stroke="#e1e8f0" stroke-width="1" />
      <rect x="32" y="47" width="96" height="66" rx="33" :fill="`url(#${gradientId})`" />
      <rect x="48" y="55" width="64" height="6" rx="3" fill="#ffffff" opacity="0.5" />
      <circle cx="50" cy="92" r="7" fill="#ffb3c6" opacity="0.9" />
      <circle cx="110" cy="92" r="7" fill="#ffb3c6" opacity="0.9" />
      <ellipse cx="62" cy="80" rx="8" ry="11" fill="#082b5e" />
      <circle cx="64" cy="76" r="3.5" fill="#ffffff" />
      <ellipse cx="98" cy="80" rx="8" ry="11" fill="#082b5e" />
      <circle cx="100" cy="76" r="3.5" fill="#ffffff" />
      <path d="M 72 91 Q 80 100 88 91" fill="none" stroke="#082b5e" stroke-width="5" stroke-linecap="round" />
    </g>
  </svg>
</template>

<style scoped>
.xiaosuo-icon {
  transition: scale 0.3s ease;
}

.xiaosuo-icon:hover {
  scale: 1.1;
  animation: xiaosuo-wiggle 0.8s ease-in-out;
}

@keyframes xiaosuo-wiggle {

  0%,
  100% {
    rotate: 0deg;
  }

  20% {
    rotate: -6deg;
  }

  40% {
    rotate: 6deg;
  }

  60% {
    rotate: -4deg;
  }

  80% {
    rotate: 2deg;
  }
}
</style>

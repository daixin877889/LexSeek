<!-- 营销内页头部的品牌装饰光晕（两团模糊球），需放在 relative overflow-hidden 的容器内 -->
<template>
  <div
    aria-hidden="true"
    class="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full"
    style="background: radial-gradient(circle, #1EEDC4 0%, transparent 70%); opacity: 0.18; filter: blur(60px);"
  />
  <div
    aria-hidden="true"
    class="pointer-events-none absolute -right-40 -top-[120px] h-[520px] w-[520px] rounded-full"
    style="background: radial-gradient(circle, #1E9EED 0%, transparent 70%); opacity: 0.22; filter: blur(80px);"
  />
</template>

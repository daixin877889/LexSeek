<template>
  <section :id="id" class="scroll-mt-24">
    <h2 class="mb-4 flex items-baseline gap-2.5 border-b border-border pb-2.5 text-[22px] font-bold leading-[1.3] tracking-[-0.01em]">
      <span class="shrink-0 rounded-md bg-primary/10 px-2 py-1 font-mono text-[12px] font-semibold text-primary">
        {{ String(n).padStart(2, "0") }}
      </span>
      {{ title }}
    </h2>
    <div class="text-[14.5px] leading-[1.85] text-foreground">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ n: number; id: string; title: string }>()
</script>

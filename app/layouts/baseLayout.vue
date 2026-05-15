<template>
  <div class="theme-brand min-h-screen bg-background text-foreground flex flex-col">
    <MarketingHeader />
    <main class="flex-1">
      <slot />
    </main>
    <MarketingFooter />
  </div>
</template>

<script setup lang="ts">
import MarketingHeader from '~/components/general/MarketingHeader.vue'
import MarketingFooter from '~/components/general/MarketingFooter.vue'
</script>

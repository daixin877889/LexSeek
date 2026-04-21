<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="right" class="w-full sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>审计记录详情</SheetTitle>
      </SheetHeader>
      <div v-if="recordId" class="mt-4 text-sm text-muted-foreground">
        recordId: {{ recordId }}
      </div>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; recordId: string }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()
</script>

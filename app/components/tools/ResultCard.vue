<template>
  <Card class="shadow-none border">
    <CardHeader>
      <div class="flex justify-between items-center">
        <CardTitle>{{ title }}</CardTitle>
        <Button v-if="showExport" variant="outline" size="sm" @click="emit('export')">
          <Download class="h-4 w-4 mr-1" />
          导出 Excel
        </Button>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- 主要指标区 -->
      <slot name="summary" />

      <!-- 明细折叠区（可选） -->
      <Accordion v-if="$slots.details" type="single" collapsible class="w-full">
        <AccordionItem value="details">
          <AccordionTrigger>
            <span class="text-base font-semibold">{{ detailsTitle }}</span>
          </AccordionTrigger>
          <AccordionContent>
            <slot name="details" />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <!-- 额外折叠区（可选，支持多块） -->
      <slot name="extra-accordion" />

      <!-- 底部汇总（可选） -->
      <slot name="footer" />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Download } from 'lucide-vue-next'
import { formatRMB } from '#shared/utils/tools/utils/calculator'

const props = withDefaults(defineProps<{
  /** 卡片标题 */
  title?: string
  /** 是否显示导出按钮 */
  showExport?: boolean
  /** 明细折叠区标题 */
  detailsTitle?: string
}>(), {
  title: '计算结果',
  showExport: true,
  detailsTitle: '计算明细',
})

const emit = defineEmits<{
  /** 点击导出按钮 */
  export: []
}>()

/** 暴露 formatRMB 供父组件模板中通过组件 ref 调用（更推荐直接在父组件 import） */
defineExpose({ formatRMB })
</script>

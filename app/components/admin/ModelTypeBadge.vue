<template>
    <!--
      模型类型 Badge：4 类（chat/embedding/asr/rerank）4 色，亮暗双模式都保证可读对比度。
      class 必须写成 vue 字面量，让 Tailwind v4 扫到——如果写到 .ts/.js 里部分 class（尤其带 important 后缀 `!`）会被静态扫描漏掉，导致 CSS 不生成。
    -->
    <Badge v-if="type === 'chat'" variant="outline"
        class="text-xs font-normal bg-sky-100 text-sky-800! border-sky-300 dark:bg-sky-500/20 dark:text-sky-200! dark:border-sky-500/40">
        对话
    </Badge>
    <Badge v-else-if="type === 'embedding'" variant="outline"
        class="text-xs font-normal bg-violet-100 text-violet-800! border-violet-300 dark:bg-violet-500/20 dark:text-violet-200! dark:border-violet-500/40">
        嵌入
    </Badge>
    <Badge v-else-if="type === 'asr'" variant="outline"
        class="text-xs font-normal bg-emerald-100 text-emerald-800! border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200! dark:border-emerald-500/40">
        语音
    </Badge>
    <Badge v-else-if="type === 'rerank'" variant="outline"
        class="text-xs font-normal bg-amber-100 text-amber-800! border-amber-300 dark:bg-amber-500/20 dark:text-amber-200! dark:border-amber-500/40">
        排序
    </Badge>
    <Badge v-else variant="outline" class="text-xs font-normal">{{ type }}</Badge>
</template>

<script setup lang="ts">
defineProps<{
    /** 模型类型（chat / embedding / asr / rerank，未知值兜底显示原值） */
    type: string
}>()
</script>

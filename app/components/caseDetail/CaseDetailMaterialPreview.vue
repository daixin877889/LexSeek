<script lang="ts" setup>
import type { MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType, CaseMaterialTypeText } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  InboxIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  material: MaterialItem | null
}>()

const materialTypeText = computed(() => {
  if (!props.material) return ''
  return CaseMaterialTypeText[props.material.type as CaseMaterialType] ?? '未知'
})

const fileSizeText = computed(() => {
  if (!props.material?.fileSize) return null
  return formatByteSize(props.material.fileSize, 1)
})
</script>

<template>
  <div v-if="!material" class="flex flex-col items-center justify-center h-full text-muted-foreground">
    <InboxIcon class="size-12 mb-3 opacity-40" />
    <p class="text-sm">点击材料查看详情</p>
  </div>

  <div v-else class="flex flex-col h-full overflow-hidden">
    <div class="shrink-0 p-4 border-b space-y-1">
      <h3 class="text-sm font-medium truncate">{{ material.name }}</h3>
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" class="px-1.5 py-0 h-4 text-[10px]">
          {{ materialTypeText }}
        </Badge>
        <span v-if="fileSizeText">{{ fileSizeText }}</span>
        <span v-if="material.fileName" class="truncate">{{ material.fileName }}</span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <template v-if="material.type === CaseMaterialType.CASE_CONTENT">
        <div v-if="material.summary" class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          {{ material.summary }}
        </div>
        <div v-else class="text-sm text-muted-foreground text-center py-8">暂无文本内容</div>
      </template>

      <template v-else-if="material.type === CaseMaterialType.DOCUMENT">
        <div v-if="material.summary" class="prose prose-sm dark:prose-invert max-w-none">
          <AiElementsMessageResponse :content="material.summary" />
        </div>
        <div v-else class="text-center py-8">
          <FileTextIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">文档内容预览功能即将上线</p>
        </div>
      </template>

      <template v-else-if="material.type === CaseMaterialType.IMAGE">
        <div class="text-center py-8">
          <ImageIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">图片预览功能即将上线</p>
        </div>
      </template>

      <template v-else-if="material.type === CaseMaterialType.AUDIO">
        <div class="text-center py-8">
          <FileAudioIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">音频播放功能即将上线</p>
          <div v-if="material.fileName" class="text-xs text-muted-foreground mt-2">
            {{ material.fileName }}
            <span v-if="fileSizeText">({{ fileSizeText }})</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="text-center py-8">
          <FileIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">暂不支持预览此类型文件</p>
        </div>
      </template>
    </div>
  </div>
</template>

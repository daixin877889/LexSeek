<template>
  <div class="flex flex-col" style="height: calc(100vh - 48px)">
    <!-- 返回按钮 + 模式切换 -->
    <div v-if="mode !== 'select'" class="shrink-0 h-12 border-b bg-background/80 backdrop-blur flex items-center justify-between px-4">
      <Button variant="ghost" size="sm" @click="mode = 'select'">
        <ArrowLeftIcon class="size-4 mr-1" />
        返回
      </Button>

      <div class="flex items-center bg-muted/50 rounded-lg p-1 border">
        <Button
          variant="ghost" size="sm"
          :class="['h-8 px-3 rounded-md transition-all', mode === 'manual' ? 'bg-background shadow-sm' : 'text-muted-foreground']"
          @click="mode = 'manual'"
        >
          <PenLineIcon class="size-3.5 mr-1.5" />
          手动创建
        </Button>
        <Button
          variant="ghost" size="sm"
          :class="['h-8 px-3 rounded-md transition-all', mode === 'ai' ? 'bg-background shadow-sm' : 'text-muted-foreground']"
          @click="mode = 'ai'"
        >
          <SparklesIcon class="size-3.5 mr-1.5" />
          AI 创建
        </Button>
      </div>

      <div class="w-16" />
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 min-h-0">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
        mode="out-in"
      >
        <!-- 模式选择 -->
        <CaseCreationModeSelector
          v-if="mode === 'select'"
          @select="mode = $event"
        />

        <!-- 手动创建 -->
        <CaseCreationManualForm
          v-else-if="mode === 'manual'"
          :case-types="caseTypes"
          :is-submitting="isSubmitting"
          @submit="handleCreate"
        />

        <!-- AI 创建 -->
        <CaseCreationAiChat
          v-else
          :case-types="caseTypes"
          :is-submitting="isSubmitting"
          class="h-full"
          @confirm="handleCreate"
        />
      </Transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { PenLineIcon, SparklesIcon, ArrowLeftIcon } from 'lucide-vue-next'

definePageMeta({
  title: '创建案件',
  layout: 'dashboard-layout',
})

const { mode, isSubmitting, caseTypes, loadCaseTypes, createCase } = useCaseCreation()

onMounted(() => {
  loadCaseTypes()
})

async function handleCreate(params: {
  caseTypeId: number
  title?: string
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  content?: string
  materials?: Array<{ type: number; name?: string; ossFileId?: number }>
}) {
  await createCase(params)
}
</script>

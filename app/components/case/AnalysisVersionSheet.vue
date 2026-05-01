<script lang="ts" setup>
import { CheckCircleIcon, Loader2Icon, HistoryIcon, ArrowLeftIcon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { VisuallyHidden } from 'reka-ui'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'

const props = defineProps<{
  caseId: number
  analysisType: string
  moduleTitle: string
  /** 版本列表（由父组件传入） */
  versions?: Array<{
    id: number
    version: number
    isActive: boolean
    analysisResult: string | null
    createdAt: string
  }>
  /** 是否正在加载版本 */
  loading?: boolean
}>()

const open = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  activated: []
}>()

const isMobile = useMediaQuery('(max-width: 767px)')
const selectedVersion = ref<{
  id: number
  version: number
  isActive: boolean
  analysisResult: string | null
  createdAt: string
} | null>(null)
const activating = ref(false)
// 移动端：是否展示预览（列表 → 预览切换）
const mobileShowPreview = ref(false)

// props.versions 变化时更新选中状态
watch(() => props.versions, (newVersions) => {
  if (newVersions && newVersions.length > 0) {
    selectedVersion.value = newVersions.find(v => v.isActive) ?? newVersions[0] ?? null
  }
  else {
    selectedVersion.value = null
  }
}, { immediate: true })

// 关闭时重置状态
watch(open, (val) => {
  if (!val) {
    selectedVersion.value = null
    mobileShowPreview.value = false
  }
})

async function activateVersion(versionId: number) {
  activating.value = true
  try {
    await useApiFetch(`/api/v1/cases/analysis/versions/activate/${versionId}`, {
      method: 'POST',
    })
    emit('activated')
  } finally {
    activating.value = false
  }
}

function selectVersion(version: { id: number; version: number; isActive: boolean; analysisResult: string | null; createdAt: string }) {
  selectedVersion.value = version
  if (isMobile.value) {
    mobileShowPreview.value = true
  }
}

function mobileBack() {
  mobileShowPreview.value = false
}

const { formatDate: formatDateUtil } = useFormatters()

function formatDate(dateStr: string): string {
  return formatDateUtil(dateStr, 'MM/DD HH:mm')
}
</script>

<template>
  <Sheet v-model:open="open">
    <!-- 移动端全屏，PC 端 90vw -->
    <SheetContent
      :side="isMobile ? 'bottom' : 'right'"
      :class="[
        'p-0 flex flex-col gap-0',
        isMobile ? 'h-[100vh]' : 'sm:!max-w-[90vw] !w-[90vw]',
      ]"
    >
      <VisuallyHidden>
        <SheetDescription>查看和切换分析模块的历史版本</SheetDescription>
      </VisuallyHidden>
      <SheetHeader class="shrink-0 px-4 pt-4 pb-3 border-b">
        <SheetTitle class="flex items-center gap-2 text-sm">
          <HistoryIcon class="size-4" />
          {{ moduleTitle }} · 历史版本
        </SheetTitle>
      </SheetHeader>

      <!-- 加载中 -->
      <div v-if="props.loading" class="flex-1 flex items-center justify-center">
        <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="!props.versions?.length" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        暂无历史版本
      </div>

      <!-- 移动端：列表 / 预览 切换 -->
      <template v-else-if="isMobile">
        <!-- 预览视图 -->
        <template v-if="mobileShowPreview && selectedVersion">
          <div class="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/20">
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" class="h-7 gap-1 -ml-2" @click="mobileBack">
                <ArrowLeftIcon class="size-3.5" />
                返回
              </Button>
              <span class="text-xs font-medium">第 {{ selectedVersion.version }} 版</span>
            </div>
            <div class="flex items-center gap-2">
              <Badge v-if="selectedVersion.isActive" variant="outline" class="text-green-600 border-green-300 text-[10px] h-5">
                当前版本
              </Badge>
              <Button
                v-if="!selectedVersion.isActive"
                size="sm"
                class="h-7 text-xs"
                :disabled="activating"
                @click="activateVersion(selectedVersion.id)"
              >
                <Loader2Icon v-if="activating" class="size-3 animate-spin mr-1" />
                设为当前版本
              </Button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-4">
            <MessageResponse
              v-if="selectedVersion.analysisResult"
              :content="selectedVersion.analysisResult"
              mode="static"
              class="prose prose-sm dark:prose-invert max-w-none"
            />
          </div>
        </template>

        <!-- 列表视图 -->
        <div v-else class="flex-1 overflow-y-auto">
          <button
            v-for="v in props.versions"
            :key="v.id"
            class="w-full text-left px-4 py-3 border-b text-sm transition-colors hover:bg-muted/50"
            @click="selectVersion(v)"
          >
            <div class="flex items-center gap-1.5">
              <CheckCircleIcon v-if="v.isActive" class="size-3.5 text-green-500 shrink-0" />
              <span class="font-medium">第 {{ v.version }} 版</span>
              <Badge v-if="v.isActive" variant="outline" class="text-green-600 border-green-300 text-[10px] h-4 ml-1">
                当前
              </Badge>
            </div>
            <div class="text-[11px] text-muted-foreground mt-0.5" :class="v.isActive ? 'ml-5' : ''">
              {{ formatDate(v.createdAt) }}
            </div>
          </button>
        </div>
      </template>

      <!-- PC 端：左右分栏 -->
      <div v-else class="flex-1 flex min-h-0">
        <!-- 左：版本列表 -->
        <div class="w-56 shrink-0 border-r overflow-y-auto">
          <button
            v-for="v in props.versions"
            :key="v.id"
            class="w-full text-left px-3 py-2.5 border-b text-sm transition-colors hover:bg-muted/50"
            :class="selectedVersion?.id === v.id ? 'bg-muted' : ''"
            @click="selectVersion(v)"
          >
            <div class="flex items-center gap-1.5">
              <CheckCircleIcon v-if="v.isActive" class="size-3.5 text-green-500 shrink-0" />
              <span class="font-medium">第 {{ v.version }} 版</span>
            </div>
            <div class="text-[11px] text-muted-foreground mt-0.5" :class="v.isActive ? 'ml-5' : ''">
              {{ formatDate(v.createdAt) }}
            </div>
          </button>
        </div>

        <!-- 右：预览 -->
        <div class="flex-1 flex flex-col min-w-0">
          <template v-if="selectedVersion">
            <!-- 预览头部 -->
            <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div class="flex items-center gap-2 text-sm">
                <span class="font-medium">第 {{ selectedVersion.version }} 版</span>
                <Badge v-if="selectedVersion.isActive" variant="outline" class="text-green-600 border-green-300 text-[10px] h-5">
                  当前版本
                </Badge>
              </div>
              <Button
                v-if="!selectedVersion.isActive"
                size="sm"
                class="h-7 text-xs"
                :disabled="activating"
                @click="activateVersion(selectedVersion.id)"
              >
                <Loader2Icon v-if="activating" class="size-3 animate-spin mr-1" />
                设为当前版本
              </Button>
            </div>

            <!-- 预览内容 -->
            <div class="flex-1 overflow-y-auto p-4">
              <MessageResponse
                v-if="selectedVersion.analysisResult"
                :content="selectedVersion.analysisResult"
                class="prose prose-sm dark:prose-invert max-w-none"
              />
              <div v-else class="text-sm text-muted-foreground text-center py-8">
                暂无内容
              </div>
            </div>
          </template>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>

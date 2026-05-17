<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { getModuleIcon as resolveModuleIcon } from '~/utils/moduleIcons'
import { VueDraggable } from 'vue-draggable-plus'
import { VisuallyHidden } from 'reka-ui'
import {
  GripVerticalIcon,
  FileTextIcon,
  Loader2Icon,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useMarkdownDocxExport } from '~/composables/useMarkdownDocxExport'

const props = defineProps<{
  title: string
  results: AnalysisResult[]
}>()

const emit = defineEmits<{
  exportComplete: []
}>()

const open = defineModel<boolean>('open', { default: false })

interface ExportItem {
  moduleName: string
  moduleTitle: string
  content: string
  selected: boolean
}

const exportItems = ref<ExportItem[]>([])
const selectMode = ref(false)
const exporting = ref(false)

const { exportMarkdownToDocx } = useMarkdownDocxExport()

const selectedCount = computed(() => exportItems.value.filter(i => i.selected).length)

// 模块名 → 图标：以 INIT_ANALYSIS_MODULES 为单一权威源，避免本组件与其它入口的图标映射漂移
function getModuleIcon(moduleName: string) {
  const def = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
  return def ? resolveModuleIcon(def.icon) : FileTextIcon
}

// 弹窗打开时初始化
watch(open, (val) => {
  if (val) {
    exportItems.value = props.results.map(r => ({
      moduleName: r.moduleName,
      moduleTitle: r.moduleTitle,
      content: r.content,
      selected: true,
    }))
    selectMode.value = false
  }
})

function toggleSelectMode(checked?: boolean | 'indeterminate') {
  const newVal = typeof checked === 'boolean' ? checked : !selectMode.value
  if (!newVal && selectMode.value) {
    // 退出选择模式：如果没有选中的，全部选中
    if (!exportItems.value.some(i => i.selected)) {
      exportItems.value = exportItems.value.map(i => ({ ...i, selected: true }))
    }
  }
  selectMode.value = newVal
}

function toggleItem(moduleName: string) {
  exportItems.value = exportItems.value.map(i =>
    i.moduleName === moduleName ? { ...i, selected: !i.selected } : i
  )
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, ' ').slice(0, 100)
}

async function executeExport() {
  const selected = exportItems.value.filter(i => i.selected)
  if (selected.length === 0) return

  exporting.value = true
  try {
    let md = `# ${props.title}\n\n`
    for (const item of selected) {
      md += item.content + '\n\n'
    }

    const filename = sanitizeFilename(`【LexSeek 分析】${props.title || '案件报告'}.docx`)
    await exportMarkdownToDocx(md, filename)

    open.value = false
    emit('exportComplete')
  }
  catch (error) {
    console.error('导出文档失败:', error)
    toast.error('导出文档失败，请稍后重试')
  }
  finally {
    exporting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[700px] max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>导出案件文档</DialogTitle>
        <VisuallyHidden>
          <DialogDescription>选择并排序要导出的分析模块</DialogDescription>
        </VisuallyHidden>
      </DialogHeader>

      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- 模块选择控制 -->
        <div v-if="exportItems.length > 0" class="flex items-center justify-between py-2 border-b mb-2">
          <div class="flex items-center gap-2">
            <Checkbox :model-value="selectMode" @update:model-value="toggleSelectMode" />
            <label class="text-sm font-medium cursor-pointer" @click="toggleSelectMode()">
              选择导出模块
            </label>
          </div>
          <span class="text-xs text-muted-foreground">
            已选择 {{ selectedCount }} / {{ exportItems.length }} 个模块
          </span>
        </div>

        <!-- 空状态 -->
        <div v-if="exportItems.length === 0" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          暂无可导出的分析结果
        </div>

        <!-- 可拖拽模块列表 -->
        <div v-else class="flex-1 overflow-y-auto space-y-2">
          <VueDraggable
            v-model="exportItems"
            :animation="200"
            handle=".drag-handle"
            ghost-class="opacity-50"
          >
            <div
              v-for="item in exportItems"
              :key="item.moduleName"
              v-show="selectMode || item.selected"
              class="flex items-center p-3 border rounded-lg bg-card"
              :class="{ 'opacity-40': selectMode && !item.selected }"
            >
              <!-- 选择模式 Checkbox -->
              <Checkbox
                v-if="selectMode"
                :model-value="item.selected"
                class="mr-3 shrink-0"
                @update:model-value="toggleItem(item.moduleName)"
              />

              <!-- 拖拽手柄 -->
              <div class="drag-handle cursor-grab active:cursor-grabbing mr-3 shrink-0 text-muted-foreground">
                <GripVerticalIcon class="size-4" />
              </div>

              <!-- 模块图标 -->
              <div class="size-8 rounded-lg bg-primary/10 flex items-center justify-center mr-3 shrink-0">
                <component :is="getModuleIcon(item.moduleName)" class="size-4 text-primary" />
              </div>

              <!-- 模块标题 -->
              <span class="text-sm font-medium flex-1 truncate">{{ item.moduleTitle }}</span>
            </div>
          </VueDraggable>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="selectedCount === 0 || exporting" @click="executeExport">
          <Loader2Icon v-if="exporting" class="size-4 animate-spin mr-1" />
          确认导出{{ selectedCount > 0 ? `（${selectedCount}个模块）` : '' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

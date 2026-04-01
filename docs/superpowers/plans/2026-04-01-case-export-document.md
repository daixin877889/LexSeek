# 案件分析结果导出文档 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在案件详情页实现分析结果导出为 .docx 文件，支持模块选择和拖拽排序，PC/移动端双端兼容。

**Architecture:** 纯前端方案。新建 CaseExportDialog 弹窗组件，使用 vue-draggable-plus 实现拖拽排序，markdown-docx 将 Markdown 转 .docx，file-saver 触发下载。在 [id].vue header 添加导出按钮。

**Tech Stack:** Vue 3, TypeScript, vue-draggable-plus, markdown-docx, html-docx-js-typescript, file-saver, shadcn-vue

**Spec:** `docs/superpowers/specs/2026-04-01-case-export-document-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `package.json` | 修改 | 安装 markdown-docx、html-docx-js-typescript |
| `app/components/caseDetail/CaseExportDialog.vue` | 新建 | 导出弹窗：模块选择 + 拖拽排序 + 生成下载 |
| `app/pages/dashboard/cases/[id].vue` | 修改 | 添加导出按钮和弹窗集成 |

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 markdown-docx 和 html-docx-js-typescript**

```bash
bun add markdown-docx html-docx-js-typescript
```

- [ ] **Step 2: 验证安装**

```bash
cat node_modules/markdown-docx/package.json | grep version
cat node_modules/html-docx-js-typescript/package.json | grep version
```

- [ ] **Step 3: 提交**

```bash
git add package.json bun.lock
git commit -m "chore: 安装文档导出依赖 markdown-docx 和 html-docx-js-typescript"
```

---

## Task 2: 创建 CaseExportDialog 组件

**Files:**
- Create: `app/components/caseDetail/CaseExportDialog.vue`
- Reference: `app/components/legal/ArticleSortTree.vue`（vue-draggable-plus 用法）
- Reference: 旧项目 `lexseek_web/src/components/cases/ExportDocumentDialog/ExportDocumentDialog.vue`（导出逻辑）

- [ ] **Step 1: 创建组件**

```vue
<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import { VueDraggable } from 'vue-draggable-plus'
import { VisuallyHidden } from 'reka-ui'
import {
  GripVerticalIcon,
  FileTextIcon,
  CalendarIcon,
  ScaleIcon,
  TrendingUpIcon,
  TagIcon,
  ShieldIcon,
  ClipboardListIcon,
  Loader2Icon,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

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

const selectedCount = computed(() => exportItems.value.filter(i => i.selected).length)

// 模块图标映射
const iconMap: Record<string, any> = {
  summary: FileTextIcon,
  chronicle: CalendarIcon,
  claim: ScaleIcon,
  trend: TrendingUpIcon,
  cause: TagIcon,
  defense: ShieldIcon,
  evidence: ClipboardListIcon,
}

function getModuleIcon(name: string) {
  return iconMap[name] || FileTextIcon
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

function toggleSelectMode(checked?: boolean) {
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

    // 主方案：markdown-docx
    try {
      const { default: markdownDocx, Packer } = await import('markdown-docx')
      const doc = await markdownDocx(md, { ignoreHtml: true })
      const blob = await Packer.toBlob(doc)
      const { saveAs } = await import('file-saver')
      saveAs(blob, filename)
    }
    catch {
      // 备用方案：marked + html-docx-js-typescript
      const { marked } = await import('marked')
      const html = await marked(md)
      const { asBlob } = await import('html-docx-js-typescript')
      const blob = await asBlob(html)
      const { saveAs } = await import('file-saver')
      saveAs(blob as Blob, filename)
    }

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
```

- [ ] **Step 2: 提交**

```bash
git add app/components/caseDetail/CaseExportDialog.vue
git commit -m "feat(cases): 新增案件分析结果导出弹窗组件"
```

---

## Task 3: 页面集成

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: 添加导出按钮和弹窗**

1. 添加 import：
```typescript
import { DownloadIcon } from 'lucide-vue-next'
```
（注意：DownloadIcon 加到已有的 lucide-vue-next import 中）

2. 添加状态：
```typescript
const showExportDialog = ref(false)
```

3. 在 header 中，小索按钮前添加导出按钮（约第 92 行前）：
```html
<Button
  variant="ghost" size="icon"
  class="size-8 shrink-0"
  title="导出文档"
  :disabled="!analysisResults || analysisResults.length === 0"
  @click="showExportDialog = true"
>
  <DownloadIcon class="size-4" />
</Button>
```

4. 在模板末尾（关闭 `</div>` 前或预览弹窗后）添加：
```html
<CaseDetailCaseExportDialog
  v-model:open="showExportDialog"
  :title="pageTitle"
  :results="analysisResults ?? []"
/>
```

- [ ] **Step 2: 验证功能**

在开发服务器中：
1. 打开一个有分析结果的案件详情页
2. 确认 header 右侧出现导出按钮
3. 点击按钮，弹出导出弹窗
4. 测试模块选择和拖拽排序
5. 点击确认导出，验证 .docx 文件下载

- [ ] **Step 3: 提交**

```bash
git add "app/pages/dashboard/cases/[id].vue"
git commit -m "feat(cases): 案件详情页集成导出文档功能"
```

# 合同审查列表页重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 ui_kits 设计稿重做合同审查列表页 `/dashboard/contract`：新建审查由弹窗改为页面内常驻卡片、审查历史由表格改为卡片列表、状态筛选改为分段控件。

**Architecture:** 抽出共享组件 `ContractCreateReviewForm.vue` 承载新建审查的全部逻辑；列表页内嵌渲染它，合同详情页的 `NewReviewDialog.vue` 重构为「弹窗外壳引用该表单」。新增 `ContractReviewCard.vue` 单条记录卡片。后端零改动。

**Tech Stack:** Nuxt 4 + Vue 3 `<script setup>` + Tailwind v4 + shadcn-vue；测试 Vitest + @vue/test-utils。

参考设计文档：`docs/superpowers/specs/2026-05-16-contract-review-page-redesign-design.md`

---

## 文件结构

| 文件 | 职责 | 变更 |
|---|---|---|
| `app/components/assistant/contract/ContractReviewCard.vue` | 单条审查记录卡片：图标 + 合同名 + 状态徽章 + 风险条数 + 时间 + 删除 | 新建 |
| `app/components/assistant/contract/ContractCreateReviewForm.vue` | 共享新建审查表单：选择文件 / 文件库 / 粘贴文本 / 提交 | 新建 |
| `app/components/assistant/contract/NewReviewDialog.vue` | 重构为 Dialog 外壳引用上面的表单 | 重构 |
| `app/pages/dashboard/contract/index.vue` | 页面编排：页头 + 内嵌新建卡片 + 筛选条 + 卡片列表 + 分页 | 重写 template + 精简 script |
| `tests/app/components/assistant/contract/ContractReviewCard.test.ts` | `ContractReviewCard` 单测 | 新建 |
| `tests/app/components/assistant/contract/ContractCreateReviewForm.test.ts` | `ContractCreateReviewForm` 粘贴逻辑单测 | 新建 |

设计约定：
- 颜色一律用项目主题令牌（`bg-card` `text-muted-foreground` 等）与设计套件令牌（`--tint-navy-bg` 等，已在 `tailwind.css`），不硬编码、不新增 token。
- 品牌 CTA 按钮用 `bg-gradient-brand-button`。
- 图标一律 `lucide-vue-next`，禁用 emoji。

---

### Task 1: ContractReviewCard 单条审查记录卡片

**Files:**
- Create: `app/components/assistant/contract/ContractReviewCard.vue`
- Test: `tests/app/components/assistant/contract/ContractReviewCard.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/app/components/assistant/contract/ContractReviewCard.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ContractReviewCard from '~/components/assistant/contract/ContractReviewCard.vue'
import type { ReviewListItem } from '#shared/types/contract'

/**
 * ContractReviewCard 单元测试
 *
 * 组件职责：
 * - 渲染合同名（缺失时显示「未命名合同」）、状态徽章、合同类型
 * - 渲染高/中风险条数；totalRiskCount=0 时显示「暂无风险」
 * - caseId 存在时显示「归属案件 #X」
 * - 点击删除按钮 emit delete(review)
 */

const NuxtLinkStub = defineComponent({
    name: 'NuxtLink',
    props: { to: { type: String, default: '' } },
    setup(props, { slots, attrs }) {
        return () => h('a', { href: props.to, ...attrs }, slots.default?.())
    },
})

function makeReview(over: Partial<ReviewListItem> = {}): ReviewListItem {
    return {
        id: 1, sessionId: 's1', caseId: null, contractType: '股权转让协议',
        partyA: null, partyB: null, stance: null, status: 'completed',
        summary: null, originalFileName: '股权转让协议.docx', hasUnsavedDocxChanges: false,
        highRiskCount: 0, mediumRiskCount: 0, totalRiskCount: 0,
        createdAt: new Date('2026-05-10T08:00:00Z'), updatedAt: new Date('2026-05-10T08:00:00Z'),
        ...over,
    }
}

function mountCard(review: ReviewListItem) {
    return mount(ContractReviewCard, {
        props: { review },
        global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
}

describe('ContractReviewCard', () => {
    it('渲染合同名与状态标签', () => {
        const w = mountCard(makeReview())
        expect(w.text()).toContain('股权转让协议.docx')
        expect(w.text()).toContain('已完成')
    })

    it('originalFileName 为空时显示「未命名合同」', () => {
        const w = mountCard(makeReview({ originalFileName: null }))
        expect(w.text()).toContain('未命名合同')
    })

    it('有高/中风险时分别渲染条数', () => {
        const w = mountCard(makeReview({ highRiskCount: 3, mediumRiskCount: 2, totalRiskCount: 5 }))
        expect(w.text()).toContain('3 高')
        expect(w.text()).toContain('2 中')
    })

    it('无风险时显示「暂无风险」', () => {
        const w = mountCard(makeReview({ totalRiskCount: 0 }))
        expect(w.text()).toContain('暂无风险')
    })

    it('有 caseId 时显示归属案件', () => {
        const w = mountCard(makeReview({ caseId: 42 }))
        expect(w.text()).toContain('归属案件 #42')
    })

    it('点击删除按钮 emit delete 并携带 review', async () => {
        const w = mountCard(makeReview())
        await w.find('button[aria-label="删除审查"]').trigger('click')
        const emitted = w.emitted('delete')
        expect(emitted).toBeTruthy()
        expect((emitted![0][0] as ReviewListItem).id).toBe(1)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/app/components/assistant/contract/ContractReviewCard.test.ts`
Expected: FAIL —— 找不到模块 `ContractReviewCard.vue`。

- [ ] **Step 3: 实现组件**

创建 `app/components/assistant/contract/ContractReviewCard.vue`：

```vue
<script setup lang="ts">
/**
 * 合同审查 · 单条审查记录卡片
 *
 * 整卡可点击跳转审查详情；右侧删除按钮 emit delete(review)。
 */
import { computed } from 'vue'
import { FileText, Trash2Icon } from 'lucide-vue-next'
import type { ReviewListItem } from '#shared/types/contract'
import { REVIEW_STATUS_LABEL } from '#shared/types/contract'

const props = defineProps<{ review: ReviewListItem }>()
const emit = defineEmits<{ delete: [review: ReviewListItem] }>()

// 状态徽章配色（与列表页历史实现保持一致）
const STATUS_CLASS: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    reviewing: 'bg-primary/15 text-primary dark:bg-primary/20',
    awaiting_stance: 'bg-primary/15 text-primary dark:bg-primary/20',
    rebuilding: 'bg-primary/15 text-primary dark:bg-primary/20',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
}

const statusLabel = computed(
    () => (REVIEW_STATUS_LABEL as Record<string, string>)[props.review.status] ?? props.review.status,
)
const statusClass = computed(
    () => STATUS_CLASS[props.review.status] ?? 'bg-muted text-muted-foreground',
)

function formatDate(value: string | Date): string {
    const d = typeof value === 'string' ? new Date(value) : value
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()
    if (isToday) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (isYesterday) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
</script>

<template>
    <NuxtLink :to="`/dashboard/contract/${review.id}`"
        class="group flex items-center gap-3.5 rounded-xl border bg-card p-3.5 transition-all hover:border-primary/50 hover:shadow-md md:p-4">
        <!-- 文件图标 -->
        <div class="flex size-11 shrink-0 items-center justify-center rounded-[11px] [background-image:var(--tint-navy-bg)] text-[var(--tint-navy-fg)]">
            <FileText class="size-5" />
        </div>

        <!-- 主体 -->
        <div class="min-w-0 flex-1 space-y-1">
            <div class="flex items-center gap-2.5">
                <span class="truncate text-sm font-semibold transition-colors group-hover:text-primary"
                    :title="review.originalFileName ?? ''">
                    {{ review.originalFileName ?? '未命名合同' }}
                </span>
                <span :class="['inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium', statusClass]">
                    {{ statusLabel }}
                </span>
            </div>
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                <span>{{ review.contractType ?? '未识别类型' }}</span>
                <span aria-hidden="true">·</span>
                <span v-if="review.totalRiskCount > 0" class="inline-flex items-center gap-1.5">
                    <span v-if="review.highRiskCount > 0" class="font-semibold text-rose-500">
                        {{ review.highRiskCount }} 高
                    </span>
                    <span v-if="review.mediumRiskCount > 0" class="font-medium text-amber-500">
                        {{ review.mediumRiskCount }} 中
                    </span>
                </span>
                <span v-else>暂无风险</span>
                <span aria-hidden="true">·</span>
                <span>{{ formatDate(review.createdAt) }}</span>
                <template v-if="review.caseId">
                    <span aria-hidden="true">·</span>
                    <span>归属案件 #{{ review.caseId }}</span>
                </template>
            </div>
        </div>

        <!-- 删除：桌面 hover 显现 / 移动端常显 -->
        <button type="button"
            class="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive md:opacity-0 md:group-hover:opacity-100"
            aria-label="删除审查"
            @click.stop.prevent="emit('delete', review)">
            <Trash2Icon class="size-4" />
        </button>
    </NuxtLink>
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/app/components/assistant/contract/ContractReviewCard.test.ts`
Expected: PASS —— 6 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add app/components/assistant/contract/ContractReviewCard.vue tests/app/components/assistant/contract/ContractReviewCard.test.ts
git commit -m "feat(contract): 新增审查记录卡片组件 ContractReviewCard"
```

---

### Task 2: ContractCreateReviewForm 共享新建审查表单

**Files:**
- Create: `app/components/assistant/contract/ContractCreateReviewForm.vue`
- Test: `tests/app/components/assistant/contract/ContractCreateReviewForm.test.ts`

逻辑大部分移植自现有 `NewReviewDialog.vue`（上传链路、文件库选择、提交接口）；新增「拖拽区只管本机上传 + 文件库独立按钮」的拆分。单测聚焦粘贴文本分支（不依赖 OSS）。

- [ ] **Step 1: 写失败测试**

创建 `tests/app/components/assistant/contract/ContractCreateReviewForm.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, provide, nextTick } from 'vue'

/**
 * ContractCreateReviewForm 单元测试（聚焦粘贴文本分支）
 *
 * 组件职责（本测试覆盖部分）：
 * - 粘贴文本 Tab：字数计数实时更新
 * - 空文本 / 超 50000 字时「开始审查」按钮禁用
 * - 合法粘贴 → 点击「开始审查」→ 调 createReview 接口 → emit created(reviewId)
 *
 * 上传 / 文件库分支依赖 OSS，由 E2E 覆盖。
 */

const useApiFetchMock = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({ useApiFetch: (...args: unknown[]) => useApiFetchMock(...args) }))
vi.mock('~/composables/useBatchUpload', () => ({ useBatchUpload: () => ({ uploadToOSS: vi.fn() }) }))
vi.mock('~/store/file', () => ({ useFileStore: () => ({ getBatchPresignedUrls: vi.fn() }) }))
vi.mock('vue-sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

// 动态 import：确保 vi.mock 在组件加载前生效
const { default: ContractCreateReviewForm } = await import('~/components/assistant/contract/ContractCreateReviewForm.vue')

function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': name }, slots.default?.())
        },
    })
}

// Tabs 系列 stub：trigger 点击切换 modelValue，content 按当前值显隐
const TabsStub = defineComponent({
    name: 'Tabs',
    props: { modelValue: { type: String, default: '' } },
    emits: ['update:modelValue'],
    setup(props, { slots, emit }) {
        provide('tabsCtx', {
            current: () => props.modelValue,
            select: (v: string) => emit('update:modelValue', v),
        })
        return () => h('div', slots.default?.())
    },
})
const TabsTriggerStub = defineComponent({
    name: 'TabsTrigger',
    props: { value: { type: String, default: '' } },
    setup(props, { slots }) {
        const ctx = inject<{ select: (v: string) => void }>('tabsCtx')
        return () => h('button', {
            'data-tab-trigger': props.value,
            onClick: () => ctx?.select(props.value),
        }, slots.default?.())
    },
})
const TabsContentStub = defineComponent({
    name: 'TabsContent',
    props: { value: { type: String, default: '' } },
    setup(props, { slots }) {
        const ctx = inject<{ current: () => string }>('tabsCtx')
        return () => (ctx?.current() === props.value ? h('div', slots.default?.()) : null)
    },
})
const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean, variant: String, size: String },
    setup(props, { slots, attrs }) {
        return () => h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})
const TextareaStub = defineComponent({
    name: 'Textarea',
    props: { modelValue: { type: String, default: '' }, rows: Number, disabled: Boolean },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () => h('textarea', {
            value: props.modelValue,
            'data-stub': 'Textarea',
            onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
        })
    },
})

const stubs = {
    Tabs: TabsStub,
    TabsList: passthrough('TabsList'),
    TabsTrigger: TabsTriggerStub,
    TabsContent: TabsContentStub,
    Button: ButtonStub,
    Textarea: TextareaStub,
    Input: passthrough('Input'),
    CaseAnalysisMaterialSelector: passthrough('CaseAnalysisMaterialSelector'),
}

function mountForm(props: { caseId?: number | null } = {}) {
    return mount(ContractCreateReviewForm, { props, global: { stubs } })
}

function findButton(w: ReturnType<typeof mountForm>, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))!
}

async function switchToPaste(w: ReturnType<typeof mountForm>) {
    await w.find('button[data-tab-trigger="paste"]').trigger('click')
    await nextTick()
}

describe('ContractCreateReviewForm', () => {
    beforeEach(() => {
        useApiFetchMock.mockReset()
    })

    it('粘贴文本 Tab：字数计数随输入更新', async () => {
        const w = mountForm()
        await switchToPaste(w)
        expect(w.text()).toContain('0 / 50,000')
        await w.find('textarea').setValue('合同正文示例')
        await nextTick()
        expect(w.text()).toContain('6 / 50,000')
    })

    it('粘贴文本为空时「开始审查」按钮禁用', async () => {
        const w = mountForm()
        await switchToPaste(w)
        expect((findButton(w, '开始审查').element as HTMLButtonElement).disabled).toBe(true)
    })

    it('粘贴文本超 50000 字时「开始审查」按钮禁用', async () => {
        const w = mountForm()
        await switchToPaste(w)
        await w.find('textarea').setValue('字'.repeat(50001))
        await nextTick()
        expect((findButton(w, '开始审查').element as HTMLButtonElement).disabled).toBe(true)
    })

    it('合法粘贴 → 点击开始审查 → 调接口并 emit created', async () => {
        useApiFetchMock.mockResolvedValue({ reviewId: 99, sessionId: 'sess-99' })
        const w = mountForm()
        await switchToPaste(w)
        await w.find('textarea').setValue('一份正常长度的合同文本')
        await nextTick()
        await findButton(w, '开始审查').trigger('click')
        await nextTick()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews',
            expect.objectContaining({ method: 'POST', body: { sourceType: 'paste', text: '一份正常长度的合同文本' } }),
        )
        const emitted = w.emitted('created')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toBe(99)
    })

    it('caseId 存在时提交 body 带上 caseId', async () => {
        useApiFetchMock.mockResolvedValue({ reviewId: 7, sessionId: 's7' })
        const w = mountForm({ caseId: 123 })
        await switchToPaste(w)
        await w.find('textarea').setValue('归属某案件的合同')
        await nextTick()
        await findButton(w, '开始审查').trigger('click')
        await nextTick()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews',
            expect.objectContaining({ body: { sourceType: 'paste', text: '归属某案件的合同', caseId: 123 } }),
        )
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/app/components/assistant/contract/ContractCreateReviewForm.test.ts`
Expected: FAIL —— 找不到模块 `ContractCreateReviewForm.vue`。

- [ ] **Step 3: 实现组件**

创建 `app/components/assistant/contract/ContractCreateReviewForm.vue`：

```vue
<script setup lang="ts">
/**
 * 合同审查 · 新建审查表单（共享组件）
 *
 * 同时用于：
 *  - 列表页 /dashboard/contract 顶部内嵌的新建卡片
 *  - 合同详情页 NewReviewDialog 弹窗内
 *
 * 三种来源：本机上传 .docx（拖拽 / 点击）、文件库选择、粘贴文本。
 * 成功后 emit('created', reviewId)，由调用方决定后续（跳详情 / 关弹窗）。
 */
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import {
    Loader2Icon, FileTextIcon, UploadIcon, XIcon, FolderIcon, ClipboardIcon, SparklesIcon,
} from 'lucide-vue-next'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'
import type { OssFileItem } from '~/store/file'
import { DOCX_MIME } from '#shared/utils/mime'
import { FileSource } from '#shared/types/file'
import { useBatchUpload } from '~/composables/useBatchUpload'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFileStore } from '~/store/file'

const props = withDefaults(defineProps<{ caseId?: number | null }>(), { caseId: null })
const emit = defineEmits<{ created: [reviewId: number] }>()

const CONTRACT_MAX_MB = 20
const PASTE_MAX = 50000

const activeTab = ref<'upload' | 'paste'>('upload')

// ── 选择文件状态 ──
interface PickedFile { id: number; fileName: string; fileSize: number; origin: 'local' | 'library' }
const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<PickedFile | null>(null)
const uploadError = ref('')
const submitting = ref(false)

// 拖拽 / 本机上传
const isDragging = ref(false)
const localUploading = ref(false)
const localUploadProgress = ref(0)
const fileStore = useFileStore()
const { uploadToOSS } = useBatchUpload()

// ── 粘贴文本状态 ──
const pasteText = ref('')
const pasteSubmitting = ref(false)
const canSubmitPaste = computed(
    () => pasteText.value.trim().length > 0 && pasteText.value.length <= PASTE_MAX,
)

function formatSize(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function reset() {
    selectedFile.value = null
    uploadError.value = ''
    localUploadProgress.value = 0
}

// ── 本机上传 ──
function triggerFilePicker() {
    if (localUploading.value) return
    fileInputRef.value?.click()
}

function onFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement
    acceptLocal(input.files?.[0])
    input.value = ''
}

function handleDrop(e: DragEvent) {
    isDragging.value = false
    if (localUploading.value) return
    acceptLocal(e.dataTransfer?.files?.[0])
}

function acceptLocal(file: File | undefined | null) {
    uploadError.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
        uploadError.value = '仅支持 .docx 文件，请重新选择'
        return
    }
    if (file.size > CONTRACT_MAX_MB * 1024 * 1024) {
        uploadError.value = `文件不得超过 ${CONTRACT_MAX_MB} MB`
        return
    }
    void uploadLocalFile(file)
}

async function uploadLocalFile(file: File) {
    localUploading.value = true
    localUploadProgress.value = 0
    try {
        const signatures = await fileStore.getBatchPresignedUrls({
            source: FileSource.CASE_ANALYSIS,
            files: [{ originalFileName: file.name, fileSize: file.size, mimeType: DOCX_MIME }],
            encrypted: false,
        })
        const sig = signatures?.[0]
        if (!sig) {
            uploadError.value = '获取上传签名失败，请稍后重试'
            return
        }
        const ossResult = await uploadToOSS(file, sig, (p: number) => { localUploadProgress.value = p })
        const ossFileId = (ossResult?.fileId ?? ossResult?.id) as number | undefined
        if (!ossFileId) {
            uploadError.value = '上传成功但缺少文件标识'
            return
        }
        selectedFile.value = { id: ossFileId, fileName: file.name, fileSize: file.size, origin: 'local' }
    } catch (err) {
        uploadError.value = err instanceof Error ? err.message : '上传失败'
    } finally {
        localUploading.value = false
    }
}

// ── 文件库 ──
function openLibrary() {
    if (localUploading.value) return
    materialSelectorRef.value?.openDialog()
}

function handleFilesSelected(files: OssFileItem[]) {
    if (files.length === 0) return
    const file = files[0]!
    if (file.fileType !== DOCX_MIME && !file.fileName.toLowerCase().endsWith('.docx')) {
        toast.warning('仅支持 .docx 文件，请重新选择')
        return
    }
    uploadError.value = ''
    selectedFile.value = { id: file.id, fileName: file.fileName, fileSize: file.fileSize, origin: 'library' }
}

// ── 提交 ──
async function createReview(payload: CreateReviewRequest): Promise<number | null> {
    const body: CreateReviewRequest = props.caseId ? { ...payload, caseId: props.caseId } : payload
    const resp = await useApiFetch<CreateReviewResponse>(
        '/api/v1/assistant/contract/reviews',
        { method: 'POST', body },
    )
    return resp?.reviewId ?? null
}

async function submitUpload() {
    const file = selectedFile.value
    if (!file || submitting.value || localUploading.value) return
    submitting.value = true
    try {
        const reviewId = await createReview({ sourceType: 'upload', ossFileId: file.id })
        if (reviewId) {
            emit('created', reviewId)
            reset()
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建审查失败')
    } finally {
        submitting.value = false
    }
}

async function submitPaste() {
    const text = pasteText.value.trim()
    if (!text) {
        toast.warning('请粘贴合同全文')
        return
    }
    if (text.length > PASTE_MAX) {
        toast.warning('合同内容不得超过 5 万字，请拆分或改用上传 .docx')
        return
    }
    if (pasteSubmitting.value) return
    pasteSubmitting.value = true
    try {
        const reviewId = await createReview({ sourceType: 'paste', text })
        if (reviewId) {
            emit('created', reviewId)
            pasteText.value = ''
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建审查失败')
    } finally {
        pasteSubmitting.value = false
    }
}
</script>

<template>
    <div>
        <Tabs v-model="activeTab" class="w-full gap-0">
            <!-- 头部：标题 + 分段 Tab -->
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 class="text-base font-semibold">发起新的合同审查</h2>
                    <p class="mt-1 text-xs text-muted-foreground">
                        上传 .docx、从文件库选择，或直接粘贴合同全文 —— AI 逐条扫描风险条款
                    </p>
                </div>
                <TabsList class="shrink-0">
                    <TabsTrigger value="upload">
                        <UploadIcon class="size-3.5" />选择文件
                    </TabsTrigger>
                    <TabsTrigger value="paste">
                        <ClipboardIcon class="size-3.5" />粘贴文本
                    </TabsTrigger>
                </TabsList>
            </div>

            <!-- 选择文件 -->
            <TabsContent value="upload" class="mt-4 space-y-3">
                <!-- 已选文件 -->
                <div v-if="selectedFile"
                    class="flex items-center gap-3.5 rounded-xl border bg-background p-4">
                    <div class="flex size-11 shrink-0 items-center justify-center rounded-[11px] [background-image:var(--tint-navy-bg)] text-[var(--tint-navy-fg)]">
                        <FileTextIcon class="size-5" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium">{{ selectedFile.fileName }}</span>
                            <span class="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                                已就绪
                            </span>
                        </div>
                        <div class="mt-1 text-xs text-muted-foreground">
                            {{ formatSize(selectedFile.fileSize) }} ·
                            {{ selectedFile.origin === 'library' ? '来自文件库' : '本机上传' }}
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label="移除文件" @click="reset">
                        <XIcon class="size-4" />
                    </Button>
                </div>

                <!-- 未选文件 -->
                <template v-else>
                    <div class="rounded-xl border-2 border-dashed p-7 text-center transition-colors"
                        :class="[
                            isDragging ? 'border-primary bg-primary/5' : 'border-primary/25 hover:border-primary/45',
                            localUploading ? 'cursor-default' : 'cursor-pointer',
                        ]"
                        @click="triggerFilePicker"
                        @dragover.prevent="!localUploading && (isDragging = true)"
                        @dragleave="isDragging = false"
                        @drop.prevent="handleDrop">
                        <div class="mx-auto flex size-12 items-center justify-center rounded-xl [background-image:var(--tint-sky-bg)] text-[var(--tint-sky-fg)]">
                            <UploadIcon class="size-6" />
                        </div>
                        <template v-if="localUploading">
                            <p class="mt-3 text-sm font-semibold">正在上传…</p>
                            <div class="mx-auto mt-3 h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-muted">
                                <div class="h-full rounded-full bg-gradient-brand-button transition-all"
                                    :style="{ width: `${localUploadProgress}%` }" />
                            </div>
                            <p class="mt-1.5 font-mono text-xs text-muted-foreground">{{ localUploadProgress }}%</p>
                        </template>
                        <template v-else>
                            <h3 class="mt-3 text-sm font-semibold">
                                {{ isDragging ? '释放以上传文件' : '把合同 .docx 拖到这里' }}
                            </h3>
                            <p class="mt-1 text-xs text-muted-foreground">
                                或<span class="font-semibold text-primary"> 点击选择本地文件</span>
                            </p>
                        </template>
                    </div>

                    <div class="flex items-center gap-3 text-muted-foreground">
                        <span class="h-px flex-1 bg-border" />
                        <span class="text-[11px]">或</span>
                        <span class="h-px flex-1 bg-border" />
                    </div>

                    <Button variant="outline" class="w-full" :disabled="localUploading" @click="openLibrary">
                        <FolderIcon class="size-4" />从文件库选择已上传的合同
                    </Button>
                </template>

                <p v-if="uploadError" class="text-xs text-destructive">{{ uploadError }}</p>

                <div class="flex flex-wrap items-center justify-between gap-3">
                    <span class="text-[11px] text-muted-foreground">
                        支持 .docx · 单文件 ≤ {{ CONTRACT_MAX_MB }} MB · 每份消耗 30 积分
                    </span>
                    <Button class="bg-gradient-brand-button text-white"
                        :disabled="!selectedFile || submitting || localUploading" @click="submitUpload">
                        <Loader2Icon v-if="submitting" class="size-4 animate-spin" />
                        <SparklesIcon v-else class="size-4" />
                        {{ submitting ? '创建中...' : '开始审查' }}
                    </Button>
                </div>
            </TabsContent>

            <!-- 粘贴文本 -->
            <TabsContent value="paste" class="mt-4 space-y-3">
                <Textarea v-model="pasteText" :rows="9" :disabled="pasteSubmitting"
                    placeholder="将合同全文粘贴到这里，AI 会自动识别合同类型与风险条款…"
                    class="resize-y font-mono text-sm" />
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <span :class="['text-[11px]', pasteText.length > PASTE_MAX ? 'text-destructive' : 'text-muted-foreground']">
                        {{ pasteText.length.toLocaleString() }} / {{ PASTE_MAX.toLocaleString() }} 字 · 每份消耗 30 积分
                    </span>
                    <Button class="bg-gradient-brand-button text-white"
                        :disabled="pasteSubmitting || !canSubmitPaste" @click="submitPaste">
                        <Loader2Icon v-if="pasteSubmitting" class="size-4 animate-spin" />
                        <SparklesIcon v-else class="size-4" />
                        开始审查
                    </Button>
                </div>
            </TabsContent>
        </Tabs>

        <!-- 文件库弹窗：复用案件分析的素材选择器 -->
        <CaseAnalysisMaterialSelector ref="materialSelectorRef" @files-selected="handleFilesSelected" />
        <!-- 隐藏的原生文件选择器：拖拽区点击时触发 -->
        <input ref="fileInputRef" type="file" accept=".docx" class="hidden" @change="onFileInputChange" />
    </div>
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/app/components/assistant/contract/ContractCreateReviewForm.test.ts`
Expected: PASS —— 5 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add app/components/assistant/contract/ContractCreateReviewForm.vue tests/app/components/assistant/contract/ContractCreateReviewForm.test.ts
git commit -m "feat(contract): 新增共享新建审查表单组件 ContractCreateReviewForm"
```

---

### Task 3: 重构 NewReviewDialog 为弹窗外壳

**Files:**
- Modify: `app/components/assistant/contract/NewReviewDialog.vue`（整文件替换）

`NewReviewDialog` 仍被合同详情页 `RiskListPanel.vue` 使用，保留其对外接口（`open` / `caseId` props，`update:open` / `created` emits）不变，内部改为引用 `ContractCreateReviewForm`。

- [ ] **Step 1: 替换组件实现**

把 `app/components/assistant/contract/NewReviewDialog.vue` 整个文件替换为：

```vue
<script setup lang="ts">
/**
 * 合同审查新建对话框（弹窗外壳）
 *
 * 内容委托给共享组件 ContractCreateReviewForm。
 * 仅供合同详情页 RiskListPanel 的「新建审查」入口使用；
 * 列表页 /dashboard/contract 已改为内嵌渲染该表单，不再用本弹窗。
 *
 * 对外接口（保持不变）：
 *  - props: open / caseId
 *  - emits: update:open / created
 */
import ContractCreateReviewForm from '~/components/assistant/contract/ContractCreateReviewForm.vue'

defineProps<{
    open: boolean
    /** 可选：归属案件；案件详情入口会带入 */
    caseId?: number | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    'created': [reviewId: number]
}>()

function handleCreated(reviewId: number) {
    emit('created', reviewId)
    emit('update:open', false)
}
</script>

<template>
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[600px]">
            <!-- 表单自带可见标题；此处仅为 Radix 无障碍要求兜底 -->
            <DialogHeader class="sr-only">
                <DialogTitle>新建合同审查</DialogTitle>
                <DialogDescription>
                    上传 .docx、从文件库选择，或粘贴合同全文，AI 自动识别风险条款并生成审查报告。
                </DialogDescription>
            </DialogHeader>
            <ContractCreateReviewForm :case-id="caseId" @created="handleCreated" />
        </DialogContent>
    </Dialog>
</template>
```

> 说明：`DialogContent` 关闭时会卸载，重新打开时 `ContractCreateReviewForm` 重新挂载，表单状态自动重置，无需 `watch(open)` 手动清理。

- [ ] **Step 2: 跑合同详情页相关测试确认无回归**

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.test.ts`
Expected: PASS —— `RiskListPanel` 测试不受影响（其对 `NewReviewDialog` 仅做 stub 或不渲染弹窗内部）。
若该测试因新增子组件解析失败，在其 `global.stubs` 中补 `NewReviewDialog: true` 或 `ContractCreateReviewForm: true`。

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 与 `NewReviewDialog` / `ContractCreateReviewForm` 相关无报错。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/NewReviewDialog.vue
git commit -m "refactor(contract): NewReviewDialog 重构为弹窗外壳引用共享表单"
```

---

### Task 4: 重写合同审查列表页

**Files:**
- Modify: `app/pages/dashboard/contract/index.vue`（整文件替换）

- [ ] **Step 1: 替换页面实现**

把 `app/pages/dashboard/contract/index.vue` 整个文件替换为：

```vue
<script setup lang="ts">
/**
 * 合同审查列表页（/dashboard/contract）
 *
 * 结构：页头 → 内嵌新建审查卡片 → 审查历史（状态分段筛选 + 搜索 + 卡片列表 + 分页）。
 *
 * 交互：
 * - 新建审查：页面顶部常驻卡片（ContractCreateReviewForm），成功后跳详情。
 * - 筛选：状态分段控件即时生效；搜索框 refDebounced 300ms 防抖。
 * - 列表：卡片列表（桌面 / 移动统一），整卡跳详情，删除走全局确认弹窗。
 * - query ?new=1&caseId=X：案件详情页入口跳入；挂载后滚动到新建卡片并短暂高亮，
 *   caseId 传入表单，新建审查归属该案件。
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { FileText, Loader2, Search } from 'lucide-vue-next'
import type { ReviewListItem } from '#shared/types/contract'
import ContractCreateReviewForm from '~/components/assistant/contract/ContractCreateReviewForm.vue'
import ContractReviewCard from '~/components/assistant/contract/ContractReviewCard.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApi } from '~/composables/useApi'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'

definePageMeta({
    layout: 'dashboard-layout',
    title: '合同审查',
    icon: 'FileSearch',
})

const route = useRoute()
const router = useRouter()

// 从 query 读取归属案件
const initCaseId = computed(() => {
    const n = Number(route.query.caseId)
    return Number.isInteger(n) && n > 0 ? n : null
})

// ===== 筛选状态 =====
const formQ = ref('')
const debouncedQ = refDebounced(formQ, 300)
const formStatus = ref('all')

const STATUS_TABS = [
    { value: 'all', label: '全部' },
    { value: 'reviewing', label: '审查中' },
    { value: 'awaiting_stance', label: '等待立场' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
]

// 分页
const PAGE_SIZE = 20
const page = ref(1)

// 筛选变化回到首页
watch([debouncedQ, formStatus], () => { page.value = 1 })

const listQuery = computed(() => {
    const q: Record<string, string | number> = {
        skip: (page.value - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
    }
    const qText = debouncedQ.value.trim()
    if (qText) q.q = qText
    if (formStatus.value !== 'all') q.status = formStatus.value
    return q
})

interface ListResponse {
    items: ReviewListItem[]
    total: number
    skip: number
    take: number
}

const { data, status: listStatus, refresh } = await useApi<ListResponse>(
    '/api/v1/assistant/contract/reviews',
    { query: listQuery },
)
const items = computed<ReviewListItem[]>(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const loading = computed(() => listStatus.value === 'pending')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

// ===== 新建成功 → 跳详情 =====
function handleCreated(reviewId: number) {
    toast.success('已发起合同审查')
    router.push(`/dashboard/contract/${reviewId}`)
}

// ===== 删除 =====
function confirmDelete(item: ReviewListItem) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确定删除「${item.originalFileName ?? '未命名合同'}」？删除后无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/contract/reviews/${item.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                await refresh()
            }
        },
    })
}

// ===== ?new=1 → 滚动并高亮新建卡片 =====
const createCardRef = ref<HTMLElement | null>(null)
const highlightCreate = ref(false)

onMounted(async () => {
    if (route.query.new === '1') {
        await nextTick()
        createCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        highlightCreate.value = true
        setTimeout(() => { highlightCreate.value = false }, 2000)
    }
})
</script>

<template>
    <div class="space-y-7 p-4 md:p-6">
        <!-- 页头 -->
        <header>
            <p class="text-xs font-medium uppercase tracking-[0.08em] text-primary">
                CONTRACT REVIEW · 合同审查
            </p>
            <h1 class="mt-2.5 text-2xl font-bold tracking-tight md:text-[28px]">合同审查</h1>
            <p class="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                一键扫描合同条款风险、缺失项与改进建议
            </p>
        </header>

        <!-- 新建审查卡片 -->
        <div ref="createCardRef"
            class="rounded-xl border bg-card p-5 transition-shadow duration-300"
            :class="highlightCreate ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''">
            <ContractCreateReviewForm :case-id="initCaseId" @created="handleCreated" />
        </div>

        <!-- 审查历史 -->
        <section class="space-y-4">
            <div class="flex items-baseline gap-2.5">
                <h2 class="text-lg font-semibold">审查历史</h2>
                <span class="text-sm text-muted-foreground">共 {{ total }} 份</span>
            </div>

            <!-- 筛选条 -->
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Tabs v-model="formStatus">
                    <TabsList class="w-full justify-start overflow-x-auto sm:w-auto">
                        <TabsTrigger v-for="t in STATUS_TABS" :key="t.value" :value="t.value">
                            {{ t.label }}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                <div class="relative sm:w-60">
                    <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input v-model="formQ" placeholder="搜索合同名称…" class="pl-8" />
                </div>
            </div>

            <!-- 加载中 -->
            <div v-if="loading" class="py-16 text-center text-muted-foreground">
                <Loader2 class="mx-auto mb-2 size-6 animate-spin" />
                加载中...
            </div>

            <!-- 空态 -->
            <div v-else-if="items.length === 0"
                class="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
                <FileText class="mx-auto mb-3 size-8 opacity-50" />
                <p class="text-sm">暂无合同审查记录</p>
                <p class="mt-1 text-xs">在上方卡片上传或粘贴合同，开始第一次扫描</p>
            </div>

            <!-- 列表 -->
            <template v-else>
                <div class="space-y-2.5">
                    <ContractReviewCard v-for="row in items" :key="row.id" :review="row" @delete="confirmDelete" />
                </div>
                <GeneralPagination v-if="pageCount > 1"
                    :current-page="page"
                    :page-size="PAGE_SIZE"
                    :total="total"
                    @change="(p: number) => (page = p)" />
            </template>
        </section>
    </div>
</template>
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: `app/pages/dashboard/contract/index.vue` 无类型报错。

- [ ] **Step 3: 提交**

```bash
git add app/pages/dashboard/contract/index.vue
git commit -m "feat(contract): 合同审查列表页按设计稿重做为卡片式布局"
```

---

### Task 5: 精简、类型检查、全量测试与 E2E 验证

**Files:** 无新增；对 Task 1–4 产物做收尾。

- [ ] **Step 1: 运行 simplify 技能**

对本次改动的 4 个文件（`ContractReviewCard.vue` / `ContractCreateReviewForm.vue` / `NewReviewDialog.vue` / `index.vue`）运行 `simplify` 技能，按其建议修复复用 / 质量 / 效率问题。改动后重跑 Task 1、Task 2 的单测确认仍通过。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 全项目无新增类型错误。

- [ ] **Step 3: 跑合同相关单测**

Run: `npx vitest run tests/app/components/assistant/contract/`
Expected: 全部 PASS（含新增 2 个测试文件与既有合同组件测试）。

- [ ] **Step 4: E2E 验证（chrome-devtools）**

启动 `bun dev`，登录后用 chrome-devtools 验证 `/dashboard/contract`：
1. 页头 eyebrow + 标题 + 副标题正常渲染。
2. 新建卡片：切换「选择文件 / 粘贴文本」Tab；粘贴文本 → 字数计数 → 「开始审查」→ 跳转详情页。
3. 上传 .docx：拖拽区点击选本地 .docx → 进度条 → 已就绪卡片 → 开始审查。
4. 「从文件库选择」按钮 → 弹出素材选择器 → 选 .docx → 已就绪卡片。
5. 审查历史：状态分段切换、搜索框输入（300ms 防抖）即时筛选；分页正常。
6. 卡片：整卡点击跳详情；hover 显阴影；删除按钮 → 确认弹窗 → 删除后列表刷新。
7. 访问 `/dashboard/contract?new=1&caseId=1`：页面滚动到新建卡片并短暂高亮描边。
8. 暗色模式切换无糊；在 360 / 768 / 1024 / 1440 视口下无横向溢出。

记录无法在浏览器复现的项并说明。

- [ ] **Step 5: 全量测试**

Run: `bun run test`
Expected: 全量测试通过（已知失败项见 `tests/KNOWN_FAILS.md`，不计入）。

- [ ] **Step 6: 最终提交（若 simplify 有改动）**

```bash
git add -A
git commit -m "refactor(contract): simplify 优化合同审查列表页改造产物"
```

---

## 自检记录

- **Spec 覆盖：** 页头①→Task4；新建卡片②→Task2+Task4；筛选条③→Task4；审查历史卡片④→Task1+Task4；空态/加载⑤→Task4；`?new=1` 行为⑥→Task4；方案 A 组件拆分→Task1/2/3；后端零改动→无任务（符合预期）。
- **占位符扫描：** 无 TBD / TODO；每个改动步骤含完整代码。
- **类型一致性：** `ContractCreateReviewForm` props `caseId` / emit `created`、`ContractReviewCard` props `review` / emit `delete`、`NewReviewDialog` props `open`+`caseId` / emits `update:open`+`created` —— 在 Task 2/1/3 定义，与 Task 3/4 的引用处一致；`ReviewListItem` 字段名与 `#shared/types/contract` 一致。

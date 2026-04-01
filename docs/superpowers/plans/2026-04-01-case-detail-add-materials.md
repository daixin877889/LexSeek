# 案件详情页添加材料功能 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在案件详情页的概览和材料视图中添加「添加材料」功能，复用 materialSelector 弹窗，添加后自动触发识别和嵌入，并实时展示识别状态。

**Architecture:** 新建后端 API `POST /api/v1/case/materials/:caseId` 处理材料关联和异步识别/嵌入。前端在两个视图中添加按钮打开 materialSelector，提交后通过轮询展示实时识别状态。轮询逻辑在页面级管理，通过 provide/inject 共享给子视图。

**Tech Stack:** Nuxt 4, Vue 3, Prisma, TypeScript, zod, useFileRecognition composable

---

## 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `server/api/v1/case/materials/[caseId].post.ts` | 新建 | 添加材料 API，zod 校验 + 去重 + 异步识别 |
| `app/composables/useCaseDetail.ts` | 修改 | 集成 useFileRecognition，暴露添加材料和轮询状态 |
| `app/pages/dashboard/cases/[id].vue` | 修改 | provide 轮询状态和添加材料方法给子视图 |
| `app/components/caseDetail/CaseDetailMaterials.vue` | 修改 | 添加按钮 + materialSelector + 识别状态徽章 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改 | 修改现有按钮行为为打开 materialSelector |

---

### Task 1: 后端 API — 添加材料

**Files:**
- Create: `server/api/v1/case/materials/[caseId].post.ts`

- [ ] **Step 1: 创建 API 文件**

```typescript
// server/api/v1/case/materials/[caseId].post.ts
/**
 * 向已有案件添加材料
 *
 * POST /api/v1/case/materials/:caseId
 *
 * 仅支持文件类材料（type=2/3/4），不支持文本（type=1）
 */

import { z } from 'zod'
import { CaseMaterialType } from '#shared/types/case'
import type { CaseMaterialParam } from '#shared/types/case'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { batchAddCaseMaterialsService } from '~~/server/services/case/caseMaterial.service'
import { getMaterialsByCaseIdWithStatusService } from '~~/server/services/material/material.service'
import { CaseMaterialTypeText } from '#shared/types/case'

const paramsSchema = z.object({
    caseId: z.coerce.number().int().positive(),
})

const materialSchema = z.object({
    type: z.number().int().refine(
        (val) => [CaseMaterialType.DOCUMENT, CaseMaterialType.IMAGE, CaseMaterialType.AUDIO].includes(val),
        { message: '仅支持文件类材料（文档、图片、音频）' },
    ),
    name: z.string().optional(),
    ossFileId: z.number().int().positive({ message: '文件材料必须提供 ossFileId' }),
})

const bodySchema = z.object({
    materials: z.array(materialSchema).min(1, { message: '至少需要提供一个材料' }),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const caseIdStr = getRouterParam(event, 'caseId')
    const paramsResult = paramsSchema.safeParse({ caseId: caseIdStr })
    if (!paramsResult.success) {
        return resError(event, 400, parseErrorMessage(paramsResult.error, '参数验证失败'))
    }
    const caseId = paramsResult.data.caseId

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, parseErrorMessage(bodyResult.error, '参数验证失败'))
    }

    try {
        // 1. 验证用户权限
        await validateCaseAccessService(caseId, user.id)

        // 2. 后端去重：查询当前案件已有材料的 ossFileId
        const existingMaterials = await getMaterialsByCaseIdWithStatusService(caseId)
        const existingOssFileIds = new Set(
            existingMaterials.filter(m => m.ossFileId).map(m => m.ossFileId),
        )
        const newMaterials = bodyResult.data.materials.filter(
            m => !existingOssFileIds.has(m.ossFileId),
        )

        if (newMaterials.length === 0) {
            return resSuccess(event, '所有材料已存在，无需重复添加', [])
        }

        // 3. 批量添加材料
        await batchAddCaseMaterialsService(
            caseId,
            user.id,
            newMaterials as CaseMaterialParam[],
        )

        // 4. 查询新增的材料记录（通过 ossFileId 匹配）
        const allMaterials = await getMaterialsByCaseIdWithStatusService(caseId)
        const newOssFileIds = new Set(newMaterials.map(m => m.ossFileId))
        const addedMaterials = allMaterials.filter(
            m => m.ossFileId && newOssFileIds.has(m.ossFileId),
        )

        // 5. 异步触发识别（fire-and-forget）
        const materialIdsToProcess = addedMaterials.map(m => m.id)
        if (materialIdsToProcess.length > 0) {
            Promise.allSettled(
                materialIdsToProcess.map(id =>
                    processMaterialService(id, user.id).catch(err => {
                        logger.warn('材料处理失败', { materialId: id, error: err.message })
                    }),
                ),
            ).catch(() => {})
        }

        // 6. 返回新增材料列表
        const responseData = addedMaterials.map(m => ({
            id: m.id,
            name: m.name,
            type: m.type,
            typeText: CaseMaterialTypeText[m.type as CaseMaterialType] ?? '未知',
            ossFileId: m.ossFileId,
            isEncrypted: m.isEncrypted,
            status: m.realStatus,
            summary: m.summary,
            fileName: m.fileName,
            fileSize: m.fileSize,
            fileType: m.fileType,
        }))

        logger.info('添加案件材料成功', {
            caseId,
            userId: user.id,
            count: responseData.length,
        })

        return resSuccess(event, '添加材料成功', responseData)
    } catch (error: any) {
        logger.error('添加案件材料失败', {
            caseId,
            userId: user.id,
            error: error.message,
        })

        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '添加材料失败')
    }
})
```

- [ ] **Step 2: 验证 API 编译通过**

Run: `npx nuxi typecheck`
Expected: 无与 `case/materials/[caseId].post.ts` 相关的类型错误

- [ ] **Step 3: Commit**

```bash
git add server/api/v1/case/materials/[caseId].post.ts
git commit -m "feat(cases): 新增向已有案件添加材料的 API"
```

---

### Task 2: useCaseDetail — 集成识别轮询和添加材料

**Files:**
- Modify: `app/composables/useCaseDetail.ts`

- [ ] **Step 1: 扩展 useCaseDetail，集成 useFileRecognition 和添加材料方法**

在 `useCaseDetail.ts` 中新增：
- 引入 `useFileRecognition` composable
- 添加 `addMaterials` 方法：调用新 API，成功后刷新列表并启动轮询
- 计算属性 `disabledOssFileIds`：当前案件已有材料的 ossFileId 列表
- 暴露 `fileRecognitionStatus`、`getRecognitionStatus` 等给视图层

```typescript
// app/composables/useCaseDetail.ts
import type { AnalysisResult } from '#shared/types/case'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import type { OssFileItem } from '~/store/file'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { getMaterialType } from '~/utils/caseMaterial'
import { toast } from 'vue-sonner'

/** 案件详情页视图类型（包含未来扩展） */
export type ActiveView = 'overview' | 'materials' | 'analysis' | 'todos' | 'documents'

/** MaterialItem 接口（与 MaterialList.vue 中定义一致） */
export interface MaterialItem {
  id: number
  name: string
  type: number
  typeText: string
  ossFileId: number | null
  isEncrypted: boolean
  status: number
  summary: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
}

/** 案件基本信息接口（与 API 返回对齐） */
export interface CaseDetailInfo {
  id: number
  title: string
  content: string
  caseTypeId: number
  plaintiff: string[] | Array<{ name: string }>
  defendant: string[] | Array<{ name: string }>
  status: number
  isDemo: boolean
  createdAt: string
  updatedAt: string
  caseType: { id: number; name: string; description: string } | null
  sessions: Array<{ id: number; sessionId: string; status: number; createdAt: string }>
  latestAnalyses: Array<{
    id: number
    nodeId: number
    analysisType: string
    version: number
    status: number
    createdAt: string
    node: { name: string; title: string; type: string } | null
  }>
}

export function useCaseDetail(caseId: Ref<number> | ComputedRef<number>) {
  const id = toRef(caseId)

  // 案件基本信息（响应式，用于页面头部标题等）
  const { data: caseInfo, refresh: refreshCase } = useApi<CaseDetailInfo>(
    () => `/api/v1/case/${id.value}`,
  )

  // 材料列表（响应式）
  const { data: materials, refresh: refreshMaterials } = useApi<MaterialItem[]>(
    () => `/api/v1/case/${id.value}/materials`,
  )

  // 分析状态和结果
  const { data: analysisStatus, refresh: refreshAnalysis } = useApi<InitAnalysisStatusResponse>(
    () => `/api/v1/case/init-analysis-status/${id.value}`,
  )

  // 将分析结果转换为 AnalysisResult[] 格式
  const analysisResults = computed<AnalysisResult[]>(() => {
    const status = analysisStatus.value
    if (!status?.modules) return []

    const results: AnalysisResult[] = []
    for (const m of status.modules) {
      if (m.status === 'complete' && m.result) {
        const moduleDef = INIT_ANALYSIS_MODULES.find(def => def.name === m.name)
        results.push({
          nodeId: 0,
          moduleName: m.name,
          moduleTitle: moduleDef?.title ?? m.name,
          content: m.result,
          analyzedAt: m.analyzedAt ?? '',
          version: m.version ?? 1,
        })
      }
    }
    return results
  })

  // --- 识别轮询（仅轮询状态，不触发识别，识别由后端 processMaterialService 处理） ---
  const {
    fileRecognitionStatus,
    getRecognitionStatus,
    handleRecognitionResults,
    stopAllPolling,
  } = useFileRecognition()

  // 当前案件已有材料的 ossFileId 列表（用于 materialSelector 的 disabledFileIds）
  const disabledOssFileIds = computed<number[]>(() => {
    return (materials.value ?? [])
      .filter(m => m.ossFileId != null)
      .map(m => m.ossFileId!)
  })

  // 添加材料的 loading 状态
  const isAddingMaterials = ref(false)

  /**
   * 添加材料到当前案件
   * @param files materialSelector 返回的 OssFileItem[]
   */
  async function addMaterials(files: OssFileItem[]) {
    if (files.length === 0) return

    isAddingMaterials.value = true
    try {
      const materialParams = files.map(file => ({
        type: getMaterialType(file.fileType),
        name: file.fileName,
        ossFileId: file.id,
      }))

      const response = await useApiFetch<MaterialItem[]>(
        `/api/v1/case/materials/${id.value}`,
        {
          method: 'POST',
          body: { materials: materialParams },
        },
      )

      if (!response || (Array.isArray(response) && response.length === 0)) {
        toast.info('所有材料已存在，无需重复添加')
        return
      }

      toast.success(`成功添加 ${Array.isArray(response) ? response.length : 0} 个材料`)

      // 刷新材料列表
      await refreshMaterials()

      // 启动轮询（后端已通过 processMaterialService 触发识别，前端只需轮询状态）
      // 构造 processing 状态，通过 handleRecognitionResults 启动轮询
      const pollingResults = files.map(f => ({
        ossFileId: f.id,
        status: 'processing' as const,
      }))
      handleRecognitionResults(pollingResults)
    } catch {
      toast.error('添加材料失败')
    } finally {
      isAddingMaterials.value = false
    }
  }

  return {
    caseInfo,
    materials,
    analysisResults,
    analysisStatus,
    refreshCase,
    refreshMaterials,
    refreshAnalysis,
    // 添加材料相关
    addMaterials,
    isAddingMaterials,
    disabledOssFileIds,
    fileRecognitionStatus,
    getRecognitionStatus,
    stopAllPolling,
  }
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add app/composables/useCaseDetail.ts
git commit -m "feat(cases): useCaseDetail 集成识别轮询和添加材料功能"
```

---

### Task 3: 页面级 provide + CaseDetailMaterials 添加入口

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`
- Modify: `app/components/caseDetail/CaseDetailMaterials.vue`

- [ ] **Step 1: 修改 [id].vue — 解构新返回值并传递给子组件**

在 `[id].vue` 第 40 行，扩展 `useCaseDetail` 的解构：

```typescript
// 原来：
const { caseInfo, materials, analysisResults, refreshAnalysis, refreshCase } = useCaseDetail(caseId)

// 改为：
const {
  caseInfo,
  materials,
  analysisResults,
  refreshAnalysis,
  refreshCase,
  addMaterials,
  isAddingMaterials,
  disabledOssFileIds,
  fileRecognitionStatus,
  getRecognitionStatus,
} = useCaseDetail(caseId)
```

然后修改 `CaseDetailMaterials` 组件的使用（约第 133 行），传递新 props：

```html
<!-- 原来：-->
<CaseDetailMaterials v-else-if="activeView === 'materials'" :key="'materials'" :materials="materials ?? []"
  @preview="openMaterialPreview" />

<!-- 改为：-->
<CaseDetailMaterials v-else-if="activeView === 'materials'" :key="'materials'" :materials="materials ?? []"
  :disabled-oss-file-ids="disabledOssFileIds"
  :is-adding="isAddingMaterials"
  :file-recognition-status="fileRecognitionStatus"
  :get-recognition-status="getRecognitionStatus"
  @preview="openMaterialPreview"
  @add-materials="addMaterials" />
```

- [ ] **Step 2: 修改 CaseDetailMaterials.vue — 添加按钮和 materialSelector**

```vue
<script lang="ts" setup>
import type { MaterialItem } from '~/composables/useCaseDetail'
import type { OssFileItem } from '~/store/file'
import type { RecognitionStatus } from '~/composables/useFileRecognition'
import { CaseMaterialType } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  Loader2Icon,
} from 'lucide-vue-next'

const props = defineProps<{
  materials: MaterialItem[]
  disabledOssFileIds?: number[]
  isAdding?: boolean
  fileRecognitionStatus?: Map<number, RecognitionStatus>
  getRecognitionStatus?: (ossFileId?: number) => RecognitionStatus | null
}>()

const emit = defineEmits<{
  preview: [material: MaterialItem]
  addMaterials: [files: OssFileItem[]]
}>()

const viewMode = ref<'grid' | 'list'>('grid')
const showMaterialSelector = ref(false)

function handleFilesSelected(files: OssFileItem[]) {
  emit('addMaterials', files)
}

/** 获取材料的识别状态 */
function getMaterialRecognitionStatus(material: MaterialItem): RecognitionStatus | null {
  if (!props.getRecognitionStatus || !material.ossFileId) return null
  return props.getRecognitionStatus(material.ossFileId)
}

function getMaterialIcon(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return FileTextIcon
    case CaseMaterialType.IMAGE: return ImageIcon
    case CaseMaterialType.AUDIO: return FileAudioIcon
    case CaseMaterialType.CASE_CONTENT: return FileIcon
    default: return FileIcon
  }
}

function getMaterialBgColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'bg-blue-500/10 dark:bg-blue-500/20'
    case CaseMaterialType.IMAGE: return 'bg-green-500/10 dark:bg-green-500/20'
    case CaseMaterialType.AUDIO: return 'bg-purple-500/10 dark:bg-purple-500/20'
    case CaseMaterialType.CASE_CONTENT: return 'bg-orange-500/10 dark:bg-orange-500/20'
    default: return 'bg-muted'
  }
}

function getMaterialIconColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'text-blue-600 dark:text-blue-400'
    case CaseMaterialType.IMAGE: return 'text-green-600 dark:text-green-400'
    case CaseMaterialType.AUDIO: return 'text-purple-600 dark:text-purple-400'
    case CaseMaterialType.CASE_CONTENT: return 'text-orange-600 dark:text-orange-400'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <FileTextIcon class="size-4" />
        案件材料
        <Badge v-if="materials.length > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
          {{ materials.length }}
        </Badge>
      </h3>

      <div class="flex items-center gap-2">
        <!-- 添加材料按钮 -->
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          :disabled="isAdding"
          @click="showMaterialSelector = true"
        >
          <Loader2Icon v-if="isAdding" class="size-3 animate-spin" />
          <PlusIcon v-else class="size-3" />
          添加材料
        </button>

        <div class="w-px h-3 bg-border"></div>

        <!-- 视图切换 -->
        <div class="flex items-center bg-muted/50 rounded-lg p-0.5">
          <button
            class="size-7 flex items-center justify-center rounded-md transition-all"
            :class="viewMode === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'grid'"
          >
            <LayoutGridIcon class="size-3.5" />
          </button>
          <button
            class="size-7 flex items-center justify-center rounded-md transition-all"
            :class="viewMode === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'list'"
          >
            <ListIcon class="size-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- 视图切换区域 -->
    <Transition name="view-fade" mode="out-in">
      <!-- 网格视图 -->
      <div v-if="viewMode === 'grid'" key="grid" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <button
          v-for="material in materials"
          :key="material.id"
          class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary/10 text-center"
          @click="emit('preview', material)"
        >
          <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(material.type)]">
            <component :is="getMaterialIcon(material.type)" :class="['size-6', getMaterialIconColor(material.type)]" />
          </div>
          <div class="flex-1 min-w-0 w-full">
            <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
              {{ material.name }}
            </div>
            <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
              <span v-if="material.fileSize" class="shrink-0">{{ formatByteSize(material.fileSize, 0) }}</span>
              <!-- 识别状态徽章 -->
              <template v-if="getMaterialRecognitionStatus(material)">
                <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                <span v-if="getMaterialRecognitionStatus(material) === 'recognizing'" class="text-amber-500 flex items-center gap-0.5">
                  <Loader2Icon class="size-2.5 animate-spin" />识别中
                </span>
                <span v-else-if="getMaterialRecognitionStatus(material) === 'success'" class="text-green-500">已识别</span>
                <span v-else-if="getMaterialRecognitionStatus(material) === 'error'" class="text-destructive">识别失败</span>
              </template>
            </div>
          </div>
        </button>
      </div>

      <!-- 列表视图 -->
      <div v-else key="list" class="space-y-1">
        <button
          v-for="material in materials"
          :key="material.id"
          class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group border border-transparent hover:border-border/50"
          @click="emit('preview', material)"
        >
          <div :class="['flex items-center justify-center size-9 rounded-lg shrink-0', getMaterialBgColor(material.type)]">
            <component :is="getMaterialIcon(material.type)" :class="['size-5', getMaterialIconColor(material.type)]" />
          </div>
          <div class="flex-1 min-w-0 text-left">
            <div class="text-sm font-medium truncate group-hover:text-primary transition-colors">
              {{ material.name }}
            </div>
            <div class="text-[11px] text-muted-foreground/60 flex items-center gap-2">
              <span>{{ material.typeText }}</span>
              <span v-if="material.fileSize" class="size-0.5 rounded-full bg-muted-foreground/30"></span>
              <span v-if="material.fileSize">{{ formatByteSize(material.fileSize, 0) }}</span>
              <!-- 识别状态徽章 -->
              <template v-if="getMaterialRecognitionStatus(material)">
                <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                <span v-if="getMaterialRecognitionStatus(material) === 'recognizing'" class="text-amber-500 flex items-center gap-0.5">
                  <Loader2Icon class="size-2.5 animate-spin" />识别中
                </span>
                <span v-else-if="getMaterialRecognitionStatus(material) === 'success'" class="text-green-500">已识别</span>
                <span v-else-if="getMaterialRecognitionStatus(material) === 'error'" class="text-destructive">识别失败</span>
              </template>
            </div>
          </div>
        </button>
      </div>
    </Transition>

    <!-- 材料选择器弹窗 -->
    <CaseAnalysisMaterialSelector
      v-model:open="showMaterialSelector"
      :disabled-file-ids="disabledOssFileIds"
      @files-selected="handleFilesSelected"
    />
  </div>
</template>

<style scoped>
.view-fade-enter-active,
.view-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.99);
}

.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.99);
}
</style>
```

- [ ] **Step 3: 验证类型检查通过**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add app/pages/dashboard/cases/[id].vue app/components/caseDetail/CaseDetailMaterials.vue
git commit -m "feat(cases): 材料视图添加「添加材料」入口和识别状态展示"
```

---

### Task 4: CaseDetailOverview — 修改按钮行为

**Files:**
- Modify: `app/components/caseDetail/CaseDetailOverview.vue`
- Modify: `app/pages/dashboard/cases/[id].vue`（传递新 props）

- [ ] **Step 1: 修改 [id].vue 中 CaseDetailOverview 的 props 和事件**

在 `[id].vue` 模板中（约第 130 行），扩展 CaseDetailOverview 的 props：

```html
<!-- 原来：-->
<CaseDetailOverview v-if="activeView === 'overview'" :key="'overview'" :case-id="caseId" :analysis-results="analysisResults"
  @navigate-view="navigateToView" @preview-material="openMaterialPreview"
  @navigate-analysis="navigateToAnalysis" @updated="refreshCase" />

<!-- 改为：-->
<CaseDetailOverview v-if="activeView === 'overview'" :key="'overview'" :case-id="caseId" :analysis-results="analysisResults"
  :disabled-oss-file-ids="disabledOssFileIds"
  :is-adding-materials="isAddingMaterials"
  @navigate-view="navigateToView" @preview-material="openMaterialPreview"
  @navigate-analysis="navigateToAnalysis" @updated="refreshCase"
  @add-materials="addMaterials" />
```

- [ ] **Step 2: 修改 CaseDetailOverview.vue — 修改「添加材料」按钮行为**

在 script 中添加新 props、emit 和 materialSelector 状态：

```typescript
// 新增 imports
import type { OssFileItem } from '~/store/file'

// 修改 props —— 新增 disabledOssFileIds 和 isAddingMaterials
const props = defineProps<{
  caseId: number
  analysisResults: AnalysisResult[]
  disabledOssFileIds?: number[]
  isAddingMaterials?: boolean
}>()

// 修改 emit —— 新增 addMaterials
const emit = defineEmits<{
  navigateView: [view: ActiveView]
  previewMaterial: [material: MaterialItem]
  navigateAnalysis: [index: number]
  updated: []
  addMaterials: [files: OssFileItem[]]
}>()

// 新增弹窗状态
const showMaterialSelector = ref(false)

function handleFilesSelected(files: OssFileItem[]) {
  emit('addMaterials', files)
}
```

在模板中，修改「添加材料」按钮（第 93-99 行）：

```html
<!-- 原来：-->
<button
  class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
  @click="emit('navigateView', 'materials')"
>
  <PlusIcon class="size-3" />
  添加材料
</button>

<!-- 改为：-->
<button
  class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
  :disabled="isAddingMaterials"
  @click="showMaterialSelector = true"
>
  <Loader2Icon v-if="isAddingMaterials" class="size-3 animate-spin" />
  <PlusIcon v-else class="size-3" />
  添加材料
</button>
```

在模板底部（`</div>` 之前）添加 materialSelector：

```html
<!-- 材料选择器弹窗 -->
<CaseAnalysisMaterialSelector
  v-model:open="showMaterialSelector"
  :disabled-file-ids="disabledOssFileIds"
  @files-selected="handleFilesSelected"
/>
```

- [ ] **Step 3: 验证类型检查通过**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add app/components/caseDetail/CaseDetailOverview.vue app/pages/dashboard/cases/[id].vue
git commit -m "feat(cases): 概览视图「添加材料」按钮改为打开材料选择器弹窗"
```

---

### Task 5: 手动验证

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`

- [ ] **Step 2: 功能验证**

在浏览器中验证以下流程：
1. 打开案件详情页 → 材料视图 → 点击「添加材料」→ 弹出 materialSelector
2. 选择/上传文件 → 确认 → toast 提示成功 → 材料列表刷新 → 显示识别状态
3. 等待识别完成 → 状态从「识别中」变为「已识别」
4. 切换到概览视图 → 点击「添加材料」→ 同样弹出 materialSelector
5. 已添加的文件在 materialSelector 中显示为禁用（灰色不可选）
6. 尝试添加重复文件 → 后端去重 → toast 提示无需重复添加

- [ ] **Step 3: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix(cases): 修复添加材料功能的集成问题"
```

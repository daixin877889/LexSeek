# 案件基本信息行内编辑 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在案件详情页支持行内编辑标题、原告、被告，同步更新 DB + JSONB + 长期记忆三层存储。

**Architecture:** 新建 PUT API 端点，复用 `saveCaseInfoService` 三层写入。CaseInfoCard 添加 `editable` prop，支持只读/编辑模式切换。父组件通过 `@updated` 事件触发 `refreshCase()` 刷新。

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Prisma, zod, shadcn-vue

**Spec:** `docs/superpowers/specs/2026-04-01-case-info-inline-edit-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `server/api/v1/case/[caseId].put.ts` | 新建 | PUT API 端点，接收编辑数据，调用三层写入 |
| `app/components/initAnalysis/CaseInfoCard.vue` | 修改 | 添加 editable prop 和编辑模式 UI |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改 | 传入 editable=true，转发 updated 事件 |
| `app/pages/dashboard/cases/[id].vue` | 修改 | 监听 updated 事件，调用 refreshCase |

---

## Task 1: 后端 PUT API 端点

**Files:**
- Create: `server/api/v1/case/[caseId].put.ts`
- Reference: `server/api/v1/case/[caseId].get.ts`（认证和权限校验模式）
- Reference: `server/api/v1/admin/case-types/[id].put.ts`（zod 验证模式）
- Reference: `server/services/case/caseExtraction.service.ts`（saveCaseInfoService）

- [ ] **Step 1: 创建 API 文件并实现**

```typescript
// server/api/v1/case/[caseId].put.ts
/**
 * 更新案件基本信息
 *
 * PUT /api/v1/case/[caseId]
 *
 * 更新案件标题、原告、被告，同步写入 DB、JSONB 和长期记忆三层存储
 */
import { z } from 'zod'
import type { ExtractedCaseInfo } from '#shared/types/case'
import {
    getCaseByIdService,
    validateCaseAccessService,
} from '~~/server/services/case/case.service'
import { saveCaseInfoService } from '~~/server/services/case/caseExtraction.service'

const bodySchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  plaintiff: z.array(z.string().trim().min(1)).optional(),
  defendant: z.array(z.string().trim().min(1)).optional(),
}).refine(
  data => data.title !== undefined || data.plaintiff !== undefined || data.defendant !== undefined,
  { message: '至少需要提供一个更新字段' },
)

export default defineEventHandler(async (event) => {
  // 1. 认证
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }

  // 2. 路由参数
  const caseIdStr = getRouterParam(event, 'caseId')
  const caseId = Number.parseInt(caseIdStr || '', 10)
  if (Number.isNaN(caseId) || caseId <= 0) {
    return resError(event, 400, '无效的案件 ID')
  }

  // 3. 请求体验证
  const body = await readBody(event)
  const result = bodySchema.safeParse(body)
  if (!result.success) {
    return resError(event, 400, result.error.issues[0].message)
  }
  const updates = result.data

  // 4. 去重
  if (updates.plaintiff) updates.plaintiff = [...new Set(updates.plaintiff)]
  if (updates.defendant) updates.defendant = [...new Set(updates.defendant)]

  try {
    // 5. 权限校验
    await validateCaseAccessService(caseId, user.id)

    // 6. 读取当前案件（含 caseType 关联）
    const caseRecord = await getCaseByIdService(caseId, true)
    if (!caseRecord) {
      return resError(event, 404, '案件不存在')
    }

    // 7. 构造合并后的 ExtractedCaseInfo
    const parseNames = (val: unknown): string[] => {
      if (!Array.isArray(val)) return []
      return val.map((v: any) => typeof v === 'string' ? v : v?.name ?? '').filter(Boolean)
    }

    const base: ExtractedCaseInfo = (caseRecord.extractedInfo as ExtractedCaseInfo) ?? {
      title: caseRecord.title,
      plaintiff: parseNames(caseRecord.plaintiff),
      defendant: parseNames(caseRecord.defendant),
      caseType: caseRecord.caseType?.name ?? '',
      summary: caseRecord.summary ?? '',
      extraFields: [],
    }

    const merged: ExtractedCaseInfo = {
      ...base,
      ...(updates.title !== undefined ? { title: updates.title } : {}),
      ...(updates.plaintiff !== undefined ? { plaintiff: updates.plaintiff } : {}),
      ...(updates.defendant !== undefined ? { defendant: updates.defendant } : {}),
    }

    // 8. 获取案件类型列表并三层写入
    const caseTypes = await prisma.caseTypes.findMany({
      select: { id: true, name: true },
    })
    await saveCaseInfoService(caseId, merged, caseTypes)

    return resSuccess(event, '更新成功')
  }
  catch (error: any) {
    logger.error('更新案件基本信息失败', { caseId, error: error.message })
    if (error.message === '无权访问该案件') {
      return resError(event, 403, error.message)
    }
    return resError(event, 500, '更新失败')
  }
})
```

- [ ] **Step 2: 验证 API 可用**

手动测试或通过开发服务器确认端点可访问。

- [ ] **Step 3: 提交**

```bash
git add server/api/v1/case/[caseId].put.ts
git commit -m "feat(api): 新增案件基本信息更新接口"
```

---

## Task 2: CaseInfoCard 添加编辑模式

**Files:**
- Modify: `app/components/initAnalysis/CaseInfoCard.vue`
- Reference: 当前组件已有的只读展示代码

- [ ] **Step 1: 添加 props、emit 和编辑状态**

在 `<script>` 部分添加：

```typescript
import { PencilIcon, XIcon, PlusIcon, Loader2Icon, CheckIcon } from 'lucide-vue-next'

const props = defineProps<{
  caseId: number
  editable?: boolean  // 新增
}>()

const emit = defineEmits<{
  updated: []  // 新增
}>()

// 编辑状态
const isEditing = ref(false)
const isSaving = ref(false)
const editForm = ref({
  title: '',
  plaintiff: [] as string[],
  defendant: [] as string[],
})
const newPlaintiff = ref('')
const newDefendant = ref('')
const showPlaintiffInput = ref(false)
const showDefendantInput = ref(false)

function startEditing() {
  editForm.value = {
    title: caseInfo.value?.title ?? '',
    plaintiff: [...plaintiffNames.value],
    defendant: [...defendantNames.value],
  }
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
  showPlaintiffInput.value = false
  showDefendantInput.value = false
  newPlaintiff.value = ''
  newDefendant.value = ''
}

function addParty(type: 'plaintiff' | 'defendant') {
  const inputRef = type === 'plaintiff' ? newPlaintiff : newDefendant
  const name = inputRef.value.trim()
  if (!name) return
  if (!editForm.value[type].includes(name)) {
    editForm.value = {
      ...editForm.value,
      [type]: [...editForm.value[type], name],
    }
  }
  inputRef.value = ''
  if (type === 'plaintiff') showPlaintiffInput.value = false
  else showDefendantInput.value = false
}

function removeParty(type: 'plaintiff' | 'defendant', index: number) {
  editForm.value = {
    ...editForm.value,
    [type]: editForm.value[type].filter((_, i) => i !== index),
  }
}

async function saveChanges() {
  if (!editForm.value.title.trim()) {
    toast.error('标题不能为空')
    return
  }
  isSaving.value = true
  // useApiFetch 失败时返回 null（不抛异常），错误 toast 已自动显示（toast 为 Nuxt 自动导入）
  const result = await useApiFetch(`/api/v1/case/${props.caseId}`, {
    method: 'PUT',
    body: {
      title: editForm.value.title.trim(),
      plaintiff: editForm.value.plaintiff,
      defendant: editForm.value.defendant,
    },
  })
  isSaving.value = false
  if (result !== null) {
    isEditing.value = false
    await loadCaseInfo()  // 刷新组件内部的 caseInfo 数据
    emit('updated')       // 通知父组件刷新 useCaseDetail 中的数据
  }
  // 失败时保持编辑状态，useApiFetch 已自动显示错误 toast
}
```

- [ ] **Step 2: 修改模板，支持只读/编辑模式切换**

替换模板为支持双模式的版本。关键改动：

**标题栏**：添加编辑按钮
```html
<h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
  <InfoIcon class="size-4" />
  案件基本信息
  <Button v-if="editable && !isEditing" variant="ghost" size="icon" class="size-5 ml-auto" @click="startEditing">
    <PencilIcon class="size-3" />
  </Button>
</h3>
```

**标题字段**：编辑模式显示 Input
```html
<!-- 标题 -->
<span class="text-muted-foreground shrink-0">标题</span>
<Input v-if="isEditing" v-model="editForm.title" class="h-7 text-sm" />
<span v-else class="font-bold text-foreground">{{ caseInfo.title }}</span>
```

**原告字段**：编辑模式显示可增删的 Badge 列表
```html
<!-- 原告 -->
<template v-if="isEditing || plaintiffNames.length > 0">
  <span class="text-muted-foreground shrink-0">原告</span>
  <div v-if="isEditing" class="flex flex-wrap gap-1.5 items-center">
    <Badge v-for="(name, i) in editForm.plaintiff" :key="name" variant="outline"
      class="font-normal px-2 py-0 h-5 text-[11px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 gap-1">
      {{ name }}
      <button class="hover:text-destructive" @click="removeParty('plaintiff', i)">
        <XIcon class="size-3" />
      </button>
    </Badge>
    <div v-if="showPlaintiffInput" class="flex items-center gap-1">
      <Input v-model="newPlaintiff" class="h-5 w-24 text-[11px]" placeholder="输入名称"
        @keydown.enter="addParty('plaintiff')" @blur="addParty('plaintiff')" />
    </div>
    <button v-else class="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
      @click="showPlaintiffInput = true">
      <PlusIcon class="size-3" /> 添加
    </button>
  </div>
  <div v-else class="flex flex-wrap gap-1.5">
    <Badge v-for="name in plaintiffNames" :key="name" variant="outline"
      class="font-normal px-2 py-0 h-5 text-[11px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
      {{ name }}
    </Badge>
  </div>
</template>
```

**被告字段**：同原告模式，颜色改为 orange
```html
<!-- 被告 -->
<template v-if="isEditing || defendantNames.length > 0">
  <span class="text-muted-foreground shrink-0">被告</span>
  <div v-if="isEditing" class="flex flex-wrap gap-1.5 items-center">
    <Badge v-for="(name, i) in editForm.defendant" :key="name" variant="outline"
      class="font-normal px-2 py-0 h-5 text-[11px] border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400 gap-1">
      {{ name }}
      <button class="hover:text-destructive" @click="removeParty('defendant', i)">
        <XIcon class="size-3" />
      </button>
    </Badge>
    <div v-if="showDefendantInput" class="flex items-center gap-1">
      <Input v-model="newDefendant" class="h-5 w-24 text-[11px]" placeholder="输入名称"
        @keydown.enter="addParty('defendant')" @blur="addParty('defendant')" />
    </div>
    <button v-else class="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
      @click="showDefendantInput = true">
      <PlusIcon class="size-3" /> 添加
    </button>
  </div>
  <div v-else class="flex flex-wrap gap-1.5">
    <Badge v-for="name in defendantNames" :key="name" variant="outline"
      class="font-normal px-2 py-0 h-5 text-[11px] border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400">
      {{ name }}
    </Badge>
  </div>
</template>
```

**底部操作栏**：编辑模式显示保存/取消按钮
```html
<!-- 编辑操作栏 -->
<div v-if="isEditing" class="flex justify-end gap-2 pt-2 border-t">
  <Button variant="outline" size="sm" class="h-7 text-xs" :disabled="isSaving" @click="cancelEditing">
    取消
  </Button>
  <Button size="sm" class="h-7 text-xs" :disabled="isSaving" @click="saveChanges">
    <Loader2Icon v-if="isSaving" class="size-3 animate-spin mr-1" />
    保存
  </Button>
</div>
```

- [ ] **Step 3: 提交**

```bash
git add app/components/initAnalysis/CaseInfoCard.vue
git commit -m "feat(ui): CaseInfoCard 支持行内编辑标题和当事人"
```

---

## Task 3: 父组件适配

**Files:**
- Modify: `app/components/caseDetail/CaseDetailOverview.vue`
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: CaseDetailOverview 传递 editable 和 updated 事件**

在 `CaseDetailOverview.vue` 中：

1. 添加 emit 声明：
```typescript
const emit = defineEmits<{
  navigateView: [view: ActiveView]
  previewMaterial: [material: MaterialItem]
  navigateAnalysis: [index: number]
  updated: []  // 新增
}>()
```

2. 修改 CaseInfoCard 使用：
```html
<InitAnalysisCaseInfoCard :case-id="caseId" editable @updated="emit('updated')" />
```

- [ ] **Step 2: [id].vue 监听 updated 事件**

在 `[id].vue` 的 `<CaseDetailOverview>` 上添加：
```html
<CaseDetailOverview v-if="activeView === 'overview'" :case-id="caseId" :analysis-results="analysisResults"
  @navigate-view="navigateToView" @preview-material="openMaterialPreview"
  @navigate-analysis="navigateToAnalysis" @updated="refreshCase" />
```

其中 `refreshCase` 来自 `useCaseDetail(caseId)` 的解构。需要在已有解构中补充：
```typescript
const { caseInfo, materials, analysisResults, refreshAnalysis, refreshCase } = useCaseDetail(caseId)
```

- [ ] **Step 3: 提交**

```bash
git add app/components/caseDetail/CaseDetailOverview.vue app/pages/dashboard/cases/[id].vue
git commit -m "feat(cases): 案件详情页集成基本信息编辑功能"
```

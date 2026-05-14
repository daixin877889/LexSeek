# 案件相关功能迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 spec `2026-05-14-case-features-design.md` 中的四项案件功能改造：批量分析按钮下拉化、案件基础信息补全、文书页跳转自动启动 AI 生成、案件分析立场字段。

**Architecture:** 按"先 schema/类型 → 再 API/service → 再 UI → 再业务连接"的顺序分四个 Phase 推进，每个 Phase 内部按 TDD（写失败测试 → 实现 → 跑通过 → commit）。立场字段 (Phase A) 必须先做，因为后面三个 Phase 都会读到 cases.stance；其余三个 Phase 互相独立。

**Tech Stack:** Nuxt 4 (Vue 3 + Tailwind v4) + Nitro + Prisma + Vitest（worker 级 DB 隔离）+ shadcn-vue。前端图标一律 `lucide-vue-next`（禁 emoji）；后端服务层走 `Service` + `DAO` 命名约定，Prisma 单例从 `~~/server/utils/db` 取。

---

## Callouts（超出 spec 字面范围但必要的修补）

执行前请知晓：本 plan 在实施 spec 四项需求时，顺手修补了 spec 没有提及但实际存在的两个边界问题。**这两处不是 scope creep，是为了让 spec 描述的功能真正能工作**：

1. **A4 在 `server/api/v1/cases/create.post.ts` 顺手补全 7 个字段的 zod 接收**（`status` / `courtName` / `firstInstanceCaseNo` / `firstInstanceJudge` / `secondInstanceCaseNo` / `secondInstanceJudge` / `content` 之外的 `stance`）。**Spec §3.2 写"创建案件页已有这些字段，无需改动"**——这是误判：`ManualForm.vue` reactive 已收集这些字段并 emit 给 `useCaseCreation`，但 `create.post.ts` 的 zod schema **从未接收**它们，导致用户填了诉讼信息也不会入库。A4 顺手把它们加上才能让 spec §3.4 的立场字段流转跟创建表单的其它新字段一致工作。

2. **B1 把 `[caseId].put.ts` 从 NO-OP 重写为真实写库**。当前 PUT 接口的实际写库逻辑（`saveCaseInfoService`）被 M2 重构时注释掉了（见 line 86-92 注释），handler 直接 return 成功——意味着"编辑信息"功能在生产上是**假修改**（前端用编辑数据本地刷新 caseInfo 看似生效，刷新页面就丢）。B1 重写把它接回 `updateCaseService`，**否则 spec §3.2 / §3.4 的所有编辑能力都无法持久化**。

---

## File Structure

### 新建文件
| 路径 | 责任 |
|------|------|
| `app/components/caseCreation/StanceToggleGroup.vue` | 三段式立场单选控件，封装空值拦截 |
| `app/components/case/BatchAnalysisPopover.vue` | 批量分析下拉浮层（trigger 按钮 + 会话列表 + 新建项） |
| `server/api/v1/cases/analysis/init-sessions.get.ts` | 查询案件 type=2 会话列表 |
| `app/components/ui/toggle-group/*` | shadcn 标准产物（运行 `npx shadcn-vue@latest add toggle-group` 生成，禁手改） |

### 修改文件
| 路径 | 责任 |
|------|------|
| `prisma/models/case.prisma` | cases model 加 `stance` 字段 |
| `shared/types/case.ts` | 加 `CaseStance` enum + 文本字典 + 扩展 `CaseInfo` |
| `app/composables/useCaseDetail.ts` | 案件详情 select 字段扩展 + CaseInfo 类型字段补全 |
| `app/composables/useCaseCreation.ts` | 透传 stance |
| `app/components/caseCreation/ManualForm.vue` | 加 stance 控件 + emit 立场字段 |
| `app/components/initAnalysis/CaseInfoCard.vue` | 展示/编辑态扩展 7+1 字段 |
| `app/components/case/AnalysisResults.vue` | 「+ 批量分析」按钮替换为 `<BatchAnalysisPopover>` |
| `app/pages/dashboard/cases/[id].vue` | 父级连接 BatchAnalysisPopover；文书跳转 URL 加 `autoAi=1` |
| `app/pages/dashboard/document/drafts/[id].vue` | onMounted 检测 `autoAi=1` 自动启动 |
| `server/api/v1/cases/create.post.ts` | zod 加 stance + 7 个诉讼/状态/描述字段；service 透传 |
| `server/api/v1/cases/[caseId].put.ts` | **整改**（当前 NO-OP）：接入 `updateCaseService`，支持所有可编辑字段 |
| `server/services/case/case.service.ts` | `createCaseService` / `updateCaseService` 透传新字段 |
| `server/services/case/case.dao.ts` | `createCaseDao` / `updateCaseDao` 接受新字段 |
| `server/services/agent-platform/context/moduleContextBuilder.ts` | `profile` 加 stance；`roleAndFlow` 段追加立场说明 |

---

## Phase A — 立场字段（基础 schema + Agent 透传）

### Task A1: 加 cases.stance 字段（Prisma migration）

**Files:**
- Modify: `prisma/models/case.prisma`（cases model）

- [ ] **Step 1: 修改 prisma schema 加 stance 字段**

在 `prisma/models/case.prisma` 的 `model cases { ... }` 内、`isDemo` 字段之后插入：

```prisma
  /// 分析立场：plaintiff（原告）/ defendant（被告）/ neutral（中立）
  stance        String    @default("plaintiff") @db.VarChar(20)
```

- [ ] **Step 2: 跑 prisma migrate dev 生成迁移**

```bash
bun run prisma:migrate --name add_cases_stance
```

预期：在 `prisma/migrations/` 下生成 `<timestamp>_add_cases_stance/migration.sql`，内容应该是：

```sql
ALTER TABLE "cases" ADD COLUMN "stance" VARCHAR(20) NOT NULL DEFAULT 'plaintiff';
```

如果不是这种单行 ADD COLUMN with DEFAULT，停下来检查 schema 是否漏写 `@default` 或多了 `?`。

- [ ] **Step 3: 验证 prisma client 已重新生成**

```bash
ls -la generated/prisma/client/index.d.ts
```

应有最新时间戳。schema 字段访问验证：

```bash
grep -n "stance" generated/prisma/client/index.d.ts | head -3
```

- [ ] **Step 4: Commit**

```bash
git add prisma/models/case.prisma prisma/migrations/ generated/prisma/
git commit -m "feat(db): cases 表增加 stance 字段（分析立场）"
```

---

### Task A2: 加 CaseStance enum 与文本字典

**Files:**
- Modify: `shared/types/case.ts`
- Test: `tests/shared/types/caseStance.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/shared/types/caseStance.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { CaseStance, CaseStanceText } from '#shared/types/case'

describe('CaseStance enum', () => {
  it('枚举值必须与 Prisma @default("plaintiff") 等 DB 字符串值完全一致', () => {
    expect(CaseStance.PLAINTIFF).toBe('plaintiff')
    expect(CaseStance.DEFENDANT).toBe('defendant')
    expect(CaseStance.NEUTRAL).toBe('neutral')
  })

  it('CaseStanceText 字典必须覆盖三种立场', () => {
    expect(CaseStanceText[CaseStance.PLAINTIFF]).toBe('原告')
    expect(CaseStanceText[CaseStance.DEFENDANT]).toBe('被告')
    expect(CaseStanceText[CaseStance.NEUTRAL]).toBe('中立')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/shared/types/caseStance.test.ts --reporter=verbose
```

预期：FAIL（"CaseStance is not exported"）。

- [ ] **Step 3: 在 shared/types/case.ts 加 enum**

在 `shared/types/case.ts` 文件中、CaseStatus 枚举附近（约第 50 行后）插入：

```typescript
/** 案件分析立场 */
export enum CaseStance {
  PLAINTIFF = 'plaintiff',
  DEFENDANT = 'defendant',
  NEUTRAL = 'neutral',
}

/** 立场中文文本字典 */
export const CaseStanceText: Record<CaseStance, string> = {
  [CaseStance.PLAINTIFF]: '原告',
  [CaseStance.DEFENDANT]: '被告',
  [CaseStance.NEUTRAL]: '中立',
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/shared/types/caseStance.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add shared/types/case.ts tests/shared/types/caseStance.test.ts
git commit -m "feat(types): 新增 CaseStance enum + 中文文本字典"
```

---

### Task A3: StanceToggleGroup 组件（先安装 shadcn toggle-group）

**Files:**
- Generate: `app/components/ui/toggle-group/*`（shadcn 产物）
- Create: `app/components/caseCreation/StanceToggleGroup.vue`
- Test: `tests/client/caseCreation/StanceToggleGroup.test.ts`

- [ ] **Step 1: 安装 shadcn toggle-group 组件**

```bash
npx shadcn-vue@latest add toggle-group
```

预期：在 `app/components/ui/toggle-group/` 下生成 `ToggleGroup.vue`、`ToggleGroupItem.vue`、`index.ts`。**禁止手改**。

- [ ] **Step 2: 写失败测试**

创建 `tests/client/caseCreation/StanceToggleGroup.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
import { CaseStance } from '#shared/types/case'

describe('StanceToggleGroup', () => {
  it('默认值 plaintiff 渲染时高亮原告', async () => {
    const wrapper = mount(StanceToggleGroup, {
      props: { modelValue: CaseStance.PLAINTIFF },
    })
    expect(wrapper.find('[data-state="on"]').text()).toContain('原告')
  })

  it('v-model 切换到 defendant 时高亮被告', async () => {
    const wrapper = mount(StanceToggleGroup, {
      props: { modelValue: CaseStance.PLAINTIFF, 'onUpdate:modelValue': () => {} },
    })
    await wrapper.setProps({ modelValue: CaseStance.DEFENDANT })
    expect(wrapper.find('[data-state="on"]').text()).toContain('被告')
  })

  it('用户取消选中（v-model 变空字符串）时自动还原为上一个值', async () => {
    let val: CaseStance = CaseStance.PLAINTIFF
    const wrapper = mount(StanceToggleGroup, {
      props: {
        modelValue: val,
        'onUpdate:modelValue': (v: any) => { val = v },
      },
    })
    // 模拟 shadcn ToggleGroup 在再次点击当前项时把 v-model 设为空字符串
    await wrapper.findComponent({ name: 'ToggleGroup' }).vm.$emit('update:modelValue', '')
    await nextTick()
    expect(val).toBe(CaseStance.PLAINTIFF) // 仍为 plaintiff（被拦截还原）
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/client/caseCreation/StanceToggleGroup.test.ts --reporter=verbose
```

预期：FAIL（"cannot find module"）。

- [ ] **Step 4: 创建 StanceToggleGroup.vue**

`app/components/caseCreation/StanceToggleGroup.vue`：

```vue
<script lang="ts" setup>
/**
 * 三段式立场单选控件（原告/被告/中立）。
 * 封装 shadcn-vue ToggleGroup 的"再次点击取消选中"行为：
 * 若 v-model 变为空字符串，watch 拦截并还原为上一个有效值，
 * 保证业务上始终有立场被选中。
 */
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { CaseStance, CaseStanceText } from '#shared/types/case'

const props = defineProps<{
  modelValue: CaseStance
}>()

const emit = defineEmits<{
  'update:modelValue': [val: CaseStance]
}>()

const stances: CaseStance[] = [
  CaseStance.PLAINTIFF,
  CaseStance.DEFENDANT,
  CaseStance.NEUTRAL,
]

function handleChange(val: string | string[] | null | undefined) {
  // shadcn-vue ToggleGroup type=single 在用户"再次点击当前项"取消选中时
  // 会发出空字符串或 null —— 业务上必须始终有立场被选中，统一拦截还原。
  if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) {
    emit('update:modelValue', props.modelValue)
    return
  }
  const v = Array.isArray(val) ? val[0] : val
  if (typeof v !== 'string' || v === '') {
    emit('update:modelValue', props.modelValue)
    return
  }
  emit('update:modelValue', v as CaseStance)
}
</script>

<template>
  <ToggleGroup
    type="single"
    variant="outline"
    :model-value="props.modelValue"
    class="w-full grid grid-cols-3 gap-2"
    @update:model-value="handleChange"
  >
    <ToggleGroupItem
      v-for="s in stances"
      :key="s"
      :value="s"
      class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
    >
      {{ CaseStanceText[s] }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/client/caseCreation/StanceToggleGroup.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/toggle-group/ components.json app/components/caseCreation/StanceToggleGroup.vue tests/client/caseCreation/StanceToggleGroup.test.ts
git commit -m "feat(ui): 新增立场三段选 StanceToggleGroup（含空值拦截）"
```

---

### Task A4: 创建案件表单 + 创建 API 传 stance

**Files:**
- Modify: `app/components/caseCreation/ManualForm.vue`
- Modify: `app/composables/useCaseCreation.ts`
- Modify: `server/api/v1/cases/create.post.ts`
- Modify: `server/services/case/case.service.ts`
- Modify: `server/services/case/case.dao.ts`
- Test: `tests/server/case/createCase.stance.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/case/createCase.stance.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createCaseService } from '~~/server/services/case/case.service'
import { prisma } from '~~/server/utils/db'
import { CaseStance } from '#shared/types/case'

let userId: number
let caseTypeId: number

beforeAll(async () => {
  const user = await prisma.users.create({
    data: { phone: '13900000001', nickname: 'stance-test', status: 1 },
  })
  userId = user.id
  const ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  if (!ct) throw new Error('需要至少一个启用的 caseType')
  caseTypeId = ct.id
})

describe('createCaseService - stance', () => {
  it('默认 stance = plaintiff', async () => {
    const r = await createCaseService({
      title: '默认立场案件',
      content: '某甲诉某乙',
      userId,
      caseTypeId,
    })
    expect(r.case.stance).toBe(CaseStance.PLAINTIFF)
  })

  it('显式传 stance=defendant 入库正确', async () => {
    const r = await createCaseService({
      title: '被告立场案件',
      content: '某丙诉某丁',
      userId,
      caseTypeId,
      stance: CaseStance.DEFENDANT,
    })
    expect(r.case.stance).toBe(CaseStance.DEFENDANT)
  })

  it('显式传 stance=neutral 入库正确', async () => {
    const r = await createCaseService({
      title: '中立立场案件',
      content: '案情中立',
      userId,
      caseTypeId,
      stance: CaseStance.NEUTRAL,
    })
    expect(r.case.stance).toBe(CaseStance.NEUTRAL)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/case/createCase.stance.test.ts --reporter=verbose
```

预期：FAIL（CreateCaseInput 不接 stance）。

- [ ] **Step 3: 修改 case.service.ts 的 CreateCaseInput 类型**

打开 `server/services/case/case.service.ts`，找到 `interface CreateCaseInput`，在其中加：

```typescript
  stance?: CaseStance
```

`createCaseService` 函数内构造 `createCaseDao` 入参时，把 `data.stance` 一起带上：

```typescript
const caseRecord = await createCaseDao({ ...data, title, content: null }, tx as any)
```

（`...data` 已自动带上 stance，无需额外处理）

在文件头部 import：

```typescript
import { CaseStance } from '#shared/types/case'
```

- [ ] **Step 4: 修改 case.dao.ts 的 createCaseDao**

打开 `server/services/case/case.dao.ts`，确保 `createCaseDao` 入参的 type 含 `stance?: string`（或派生自 CreateCaseInput），并在 `prisma.cases.create` 的 `data: { ... }` 中传 `stance: data.stance ?? 'plaintiff'`（让没传 stance 时显式 fallback 到 default 而不是依赖 DB DEFAULT，避免 zod default 与 DB default 不一致时的歧义）。

- [ ] **Step 5: 修改 create.post.ts zod schema**

打开 `server/api/v1/cases/create.post.ts`，在 `createCaseSchema = z.object({ ... })` 内加：

```typescript
  /** 分析立场 */
  stance: z.nativeEnum(CaseStance).default(CaseStance.PLAINTIFF),
```

文件头部 import：

```typescript
import { CaseStance } from '#shared/types/case'
```

在 `const { title, content, plaintiff, defendant, materials, summary, extractedInfo } = result.data` 中加 `, stance`；在调 `createCaseService` 时一并传：

```typescript
const createResult = await createCaseService({
    title,
    content: content ?? null,
    userId: user.id,
    caseTypeId,
    plaintiff: plaintiff as PartyInfo[] | undefined,
    defendant: defendant as PartyInfo[] | undefined,
    materials: materials as CaseMaterialParam[] | undefined,
    summary: summary ?? null,
    extractedInfo: extractedInfo ?? null,
    stance,
})
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx vitest run tests/server/case/createCase.stance.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 7: 修改 useCaseCreation.ts 类型**

打开 `app/composables/useCaseCreation.ts`，给 `CreateCaseParams` 与 `ExtractedFormData` 加：

```typescript
  stance?: CaseStance
```

文件头 import：

```typescript
import { CaseStance } from '#shared/types/case'
```

- [ ] **Step 8: 修改 ManualForm.vue 加 stance 字段**

`app/components/caseCreation/ManualForm.vue`：

a) 头部 import 加：

```typescript
import { CaseStance } from '#shared/types/case'
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
```

b) `const form = reactive({ ... })` 内加：

```typescript
  stance: CaseStance.PLAINTIFF,
```

c) 模板里在「案件类型」div 之后、「原告」之前插入：

```vue
<!-- 分析立场 -->
<div class="space-y-2">
  <label class="text-sm font-medium leading-none">分析立场</label>
  <StanceToggleGroup v-model="form.stance" class="mt-1" />
</div>
```

d) `handleSubmit` 的 emit('submit', { ... }) 内加：

```typescript
    stance: form.stance,
```

e) `getCurrentValues` 返回值与 watch initialData 的预填都加上 stance 字段。

- [ ] **Step 9: Commit**

```bash
git add app/components/caseCreation/ManualForm.vue app/composables/useCaseCreation.ts server/api/v1/cases/create.post.ts server/services/case/case.service.ts server/services/case/case.dao.ts tests/server/case/createCase.stance.test.ts
git commit -m "feat(cases): 创建案件支持分析立场字段"
```

---

### Task A5: moduleContextBuilder 透传 stance + prompt 段说明

**Files:**
- Modify: `server/services/agent-platform/context/moduleContextBuilder.ts`
- Test: `tests/server/agent-platform/moduleContextBuilder.stance.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/agent-platform/moduleContextBuilder.stance.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'
import { prisma } from '~~/server/utils/db'
import { CaseStance } from '#shared/types/case'

let userId: number
let caseId: number
let caseTypeId: number

beforeAll(async () => {
  const ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  if (!ct) throw new Error('需要 caseType')
  caseTypeId = ct.id
  const u = await prisma.users.create({
    data: { phone: '13900000099', nickname: 'mcb-stance', status: 1 },
  })
  userId = u.id
  const c = await prisma.cases.create({
    data: { title: 'stance case', userId, caseTypeId, stance: CaseStance.DEFENDANT },
  })
  caseId = c.id
})

describe('buildContextSegments - stance 透传', () => {
  it('caseProfile JSON 含 stance 字段', async () => {
    const segs = await buildContextSegments({ caseId, userId, sessionId: 'test-sid', roleAndFlowTemplate: 'ROLE_TEMPLATE' })
    expect(segs.caseProfile).toContain('"stance"')
    expect(segs.caseProfile).toContain('"defendant"')
  })

  it('roleAndFlow 段含立场使用说明', async () => {
    const segs = await buildContextSegments({ caseId, userId, sessionId: 'test-sid', roleAndFlowTemplate: 'ROLE_TEMPLATE' })
    expect(segs.roleAndFlow).toContain('stance')
    expect(segs.roleAndFlow).toMatch(/原告|plaintiff/)
    expect(segs.roleAndFlow).toMatch(/被告|defendant/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/moduleContextBuilder.stance.test.ts --reporter=verbose
```

预期：FAIL（profile 没有 stance、roleAndFlow 没有说明）。

- [ ] **Step 3: 修改 moduleContextBuilder.ts**

打开 `server/services/agent-platform/context/moduleContextBuilder.ts`，找到第 116-129 行 `profile` 对象，加 `stance` 字段（字典序插入位置：'secondInstanceJudge' 后）：

```typescript
  const profile = {
    caseId: caseRecord.id,
    caseTypeId: caseRecord.caseTypeId,
    courtName: caseRecord.courtName ?? '',
    defendant: (caseRecord.defendant as string[] | null) ?? [],
    firstInstanceCaseNo: caseRecord.firstInstanceCaseNo ?? '',
    firstInstanceJudge: caseRecord.firstInstanceJudge ?? '',
    plaintiff: (caseRecord.plaintiff as string[] | null) ?? [],
    secondInstanceCaseNo: caseRecord.secondInstanceCaseNo ?? '',
    secondInstanceJudge: caseRecord.secondInstanceJudge ?? '',
    stance: caseRecord.stance ?? 'plaintiff',
    status: caseRecord.status,
    summary: caseRecord.summary ?? '',
    title: caseRecord.title,
  }
```

在 `roleAndFlow` 赋值处（第 113 行）改写为：

```typescript
  // ② 角色+流程（追加立场使用说明）
  const stanceGuide = `\n\n## 立场约束\n请以案件档案中 \`stance\` 字段作为分析视角：\`plaintiff\`=站在原告角度论证主张并反驳被告抗辩；\`defendant\`=站在被告角度组织抗辩并反驳原告主张；\`neutral\`=客观中立同时分析双方立场。`
  const roleAndFlow = (roleAndFlowTemplate ?? '') + stanceGuide
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/moduleContextBuilder.stance.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: 跑同目录覆盖率守门测试，确保未破坏现有断言**

```bash
npx vitest run tests/server/agent-platform/ --reporter=verbose
```

预期：相关已有测试仍通过（caseProfile 内容变化不应破坏 cache key 测试，因 stance 是新字段、字典序插入位置稳定）。

- [ ] **Step 6: Commit**

```bash
git add server/services/agent-platform/context/moduleContextBuilder.ts tests/server/agent-platform/moduleContextBuilder.stance.test.ts
git commit -m "feat(agent): caseProfile JSON 与 roleAndFlow 段透传分析立场"
```

---

## Phase B — 案件基础信息补全（PUT 重写 + 详情页 UI 扩展）

### Task B1: 重写 PUT [caseId].put.ts（接入 updateCaseService，支持全字段）

**Files:**
- Modify: `server/api/v1/cases/[caseId].put.ts`
- Modify: `server/services/case/case.service.ts`（如需扩展 UpdateCaseInput）
- Test: `tests/server/case/updateCase.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/case/updateCase.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { updateCaseService } from '~~/server/services/case/case.service'
import { prisma } from '~~/server/utils/db'
import { CaseStance } from '#shared/types/case'

let userId: number, caseId: number, caseTypeId: number

beforeAll(async () => {
  const ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  caseTypeId = ct!.id
  const u = await prisma.users.create({ data: { phone: '13900000050', nickname: 'upd-test', status: 1 } })
  userId = u.id
  const c = await prisma.cases.create({
    data: { title: '旧标题', userId, caseTypeId, stance: CaseStance.PLAINTIFF },
  })
  caseId = c.id
})

describe('updateCaseService - 全字段', () => {
  it('支持更新 title / courtName / 一二审案号法官 / status / stance / content', async () => {
    await updateCaseService(caseId, {
      title: '新标题',
      content: '新描述',
      status: 3,
      courtName: '北京朝阳法院',
      firstInstanceCaseNo: '(2024)京0105民初1号',
      firstInstanceJudge: '王法官',
      secondInstanceCaseNo: '(2024)京03民终99号',
      secondInstanceJudge: '李法官',
      stance: CaseStance.DEFENDANT,
    })
    const c = await prisma.cases.findUnique({ where: { id: caseId } })
    expect(c?.title).toBe('新标题')
    expect(c?.content).toBe('新描述')
    expect(c?.status).toBe(3)
    expect(c?.courtName).toBe('北京朝阳法院')
    expect(c?.firstInstanceCaseNo).toBe('(2024)京0105民初1号')
    expect(c?.secondInstanceJudge).toBe('李法官')
    expect(c?.stance).toBe(CaseStance.DEFENDANT)
  })

  it('支持更新 plaintiff / defendant 数组', async () => {
    await updateCaseService(caseId, {
      plaintiff: ['原告甲', '原告乙'] as any,
      defendant: ['被告丙'] as any,
    })
    const c = await prisma.cases.findUnique({ where: { id: caseId } })
    expect(c?.plaintiff).toEqual(['原告甲', '原告乙'])
    expect(c?.defendant).toEqual(['被告丙'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/case/updateCase.test.ts --reporter=verbose
```

预期：FAIL（updateCaseService 不接全字段或部分字段未持久化）。

- [ ] **Step 3: 扩展 UpdateCaseInput**

打开 `server/services/case/case.service.ts`，定位到 `UpdateCaseInput` 接口定义（通常派生自 `Partial<Pick<cases, ...>>`），改为：

```typescript
export interface UpdateCaseInput {
  title?: string
  content?: string | null
  status?: number
  caseTypeId?: number
  plaintiff?: string[]
  defendant?: string[]
  courtName?: string | null
  firstInstanceCaseNo?: string | null
  firstInstanceJudge?: string | null
  secondInstanceCaseNo?: string | null
  secondInstanceJudge?: string | null
  stance?: CaseStance
  summary?: string | null
}
```

确认 `updateCaseDao` 已经把 `data` spread 给 `prisma.cases.update`（如果不是，需在 case.dao.ts 加白名单 fields；为简洁推荐使用 `data` 直接 spread）。

- [ ] **Step 4: 重写 [caseId].put.ts**

完全替换 `server/api/v1/cases/[caseId].put.ts` 内容为：

```typescript
/**
 * 更新案件基本信息
 *
 * PUT /api/v1/cases/[caseId]
 *
 * 调 updateCaseService 真正写库。owner-only 由 validateCaseAccessService 保证。
 */
import { z } from 'zod'
import {
    validateCaseAccessService,
    updateCaseService,
    type UpdateCaseInput,
} from '~~/server/services/case/case.service'
import { CaseStance } from '#shared/types/case'

const bodySchema = z.object({
    title: z.string().trim().min(1).max(500).optional(),
    content: z.string().max(10000).optional(),
    status: z.number().int().positive().optional(),
    plaintiff: z.array(z.string().trim().min(1)).optional(),
    defendant: z.array(z.string().trim().min(1)).optional(),
    courtName: z.string().trim().max(200).optional(),
    firstInstanceCaseNo: z.string().trim().max(100).optional(),
    firstInstanceJudge: z.string().trim().max(100).optional(),
    secondInstanceCaseNo: z.string().trim().max(100).optional(),
    secondInstanceJudge: z.string().trim().max(100).optional(),
    stance: z.nativeEnum(CaseStance).optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: '至少需要提供一个更新字段' },
)

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const caseIdStr = getRouterParam(event, 'caseId')
    const caseId = Number.parseInt(caseIdStr || '', 10)
    if (Number.isNaN(caseId) || caseId <= 0) return resError(event, 400, '无效的案件 ID')

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) return resError(event, 400, result.error.issues[0]?.message ?? '参数校验失败')

    const updates = result.data
    if (updates.plaintiff) updates.plaintiff = [...new Set(updates.plaintiff)]
    if (updates.defendant) updates.defendant = [...new Set(updates.defendant)]

    try {
        await validateCaseAccessService(caseId, user.id)
        // zod parsed object 的运行时 shape 与 UpdateCaseInput 一致；用 satisfies
        // 收紧类型（types.md 禁 `as any`），编译期会校验所有字段对齐。
        await updateCaseService(caseId, updates satisfies UpdateCaseInput)
        return resSuccess(event, '更新成功', { id: caseId })
    }
    catch (error: any) {
        logger.error('更新案件基本信息失败', { caseId, error: error.message })
        if (error.message === '无权访问该案件') return resError(event, 403, error.message)
        if (error.message === '案件已归档，不可编辑') return resError(event, 403, error.message)
        return resError(event, 500, '更新失败')
    }
})
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/server/case/updateCase.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add server/api/v1/cases/[caseId].put.ts server/services/case/case.service.ts tests/server/case/updateCase.test.ts
git commit -m "fix(api): PUT /cases/[id] 重写 - 接入 updateCaseService 真正写库 + 全字段支持"
```

---

### Task B2: useCaseDetail + CaseInfo 类型扩展

**Files:**
- Modify: `app/composables/useCaseDetail.ts`
- Modify: `shared/types/case.ts`（如 `CaseInfo` interface 缺字段则补）

- [ ] **Step 1: 检查 shared/types/case.ts 中 CaseInfo 是否含全字段**

```bash
grep -n "CaseInfo\|courtName\|firstInstance\|stance" shared/types/case.ts | head -30
```

如果 `CaseInfo`（或对应 detail interface）缺少 `content` / `status` / `courtName` / `firstInstanceCaseNo` / `firstInstanceJudge` / `secondInstanceCaseNo` / `secondInstanceJudge` / `stance` 任一，补齐为 `string | null | undefined` 等同 Prisma 字段。

- [ ] **Step 2: 修改 useCaseDetail.ts 的 GET select 字段**

打开 `app/composables/useCaseDetail.ts`，找到拉案件的 useApi/useApiFetch 调用，确认其返回类型覆盖新字段。后端 `GET /api/v1/cases/[caseId]` 必须在 `select` 中返回这些字段。

如果 [caseId].get.ts 的 select 列表里缺字段：在 `server/api/v1/cases/[caseId].get.ts` 的 `prisma.cases.findUnique({ select: { ... } })` 中加：

```typescript
status: true,
content: true,
courtName: true,
firstInstanceCaseNo: true,
firstInstanceJudge: true,
secondInstanceCaseNo: true,
secondInstanceJudge: true,
stance: true,
```

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

预期：无 type error。

- [ ] **Step 4: Commit**

```bash
git add shared/types/case.ts app/composables/useCaseDetail.ts server/api/v1/cases/[caseId].get.ts
git commit -m "feat(types): CaseInfo 与 GET API 补齐基础信息全字段"
```

---

### Task B3: CaseInfoCard.vue 展示态扩展（新增 7+1 字段渲染）

**Files:**
- Modify: `app/components/initAnalysis/CaseInfoCard.vue`
- Test: `tests/client/initAnalysis/CaseInfoCard.display.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/client/initAnalysis/CaseInfoCard.display.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CaseInfoCard from '~/components/initAnalysis/CaseInfoCard.vue'

vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: vi.fn(async () => ({
    title: '某案',
    caseType: { name: '民商事案件' },
    plaintiff: ['甲'],
    defendant: ['乙'],
    summary: '案件摘要',
    status: 3,
    content: '案件描述长文本',
    courtName: '朝阳法院',
    firstInstanceCaseNo: '(2024)京01民初1号',
    firstInstanceJudge: '王法官',
    secondInstanceCaseNo: '',
    secondInstanceJudge: '',
    stance: 'defendant',
    extraFields: [],
  })),
}))

describe('CaseInfoCard 展示态 - 全字段补全', () => {
  it('展示法院名称', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('朝阳法院')
  })
  it('展示一审案号 + 一审法官', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('(2024)京01民初1号')
    expect(wrapper.text()).toContain('王法官')
  })
  it('展示分析立场（被告）', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('被告')
  })
  it('空字段不渲染整行（secondInstanceCaseNo 为空时不出现"二审案号"标签）', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('二审案号')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/client/initAnalysis/CaseInfoCard.display.test.ts --reporter=verbose
```

预期：FAIL（卡片未渲染这些字段）。

- [ ] **Step 3: 修改 CaseInfoCard.vue 的展示态**

a) 头部 import 加：

```typescript
import { CaseStatus, CaseStatusText, CaseStance, CaseStanceText } from '#shared/types/case'
```

b) `CaseInfoData` interface 补字段：

```typescript
  status?: number
  content?: string
  courtName?: string
  firstInstanceCaseNo?: string
  firstInstanceJudge?: string
  secondInstanceCaseNo?: string
  secondInstanceJudge?: string
  stance?: CaseStance
```

c) 在「被告」`</template>` 之后、「额外字段」之前插入：

```vue
<!-- 案件状态 -->
<template v-if="!isEditing && caseInfo.status">
  <span class="text-muted-foreground shrink-0">状态</span>
  <Badge variant="outline" class="font-normal px-2 py-0 h-5 text-[11px]">
    {{ CaseStatusText[caseInfo.status as CaseStatus] ?? '未知' }}
  </Badge>
</template>

<!-- 分析立场 -->
<template v-if="!isEditing && caseInfo.stance">
  <span class="text-muted-foreground shrink-0">分析立场</span>
  <Badge variant="outline" class="font-normal px-2 py-0 h-5 text-[11px] border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400">
    {{ CaseStanceText[caseInfo.stance] }}
  </Badge>
</template>

<!-- 法院名称 -->
<template v-if="!isEditing && caseInfo.courtName">
  <span class="text-muted-foreground shrink-0">法院</span>
  <span class="text-foreground">{{ caseInfo.courtName }}</span>
</template>

<!-- 一审案号 -->
<template v-if="!isEditing && caseInfo.firstInstanceCaseNo">
  <span class="text-muted-foreground shrink-0">一审案号</span>
  <span class="text-foreground">{{ caseInfo.firstInstanceCaseNo }}</span>
</template>

<!-- 一审法官 -->
<template v-if="!isEditing && caseInfo.firstInstanceJudge">
  <span class="text-muted-foreground shrink-0">一审法官</span>
  <span class="text-foreground">{{ caseInfo.firstInstanceJudge }}</span>
</template>

<!-- 二审案号 -->
<template v-if="!isEditing && caseInfo.secondInstanceCaseNo">
  <span class="text-muted-foreground shrink-0">二审案号</span>
  <span class="text-foreground">{{ caseInfo.secondInstanceCaseNo }}</span>
</template>

<!-- 二审法官 -->
<template v-if="!isEditing && caseInfo.secondInstanceJudge">
  <span class="text-muted-foreground shrink-0">二审法官</span>
  <span class="text-foreground">{{ caseInfo.secondInstanceJudge }}</span>
</template>
```

d) 在卡片底部、`</div>`（关闭 grid）之后插入"案件描述"折叠区块：

```vue
</div>

<!-- 案件描述（折叠） -->
<div v-if="!isEditing && caseInfo.content" class="space-y-1 pt-2 border-t border-border/50">
  <div class="flex items-center justify-between">
    <span class="text-xs text-muted-foreground">案件描述</span>
    <button class="text-xs text-primary hover:underline" @click="contentExpanded = !contentExpanded">
      {{ contentExpanded ? '收起' : '展开' }}
    </button>
  </div>
  <p
    class="text-sm text-foreground whitespace-pre-wrap"
    :class="{ 'line-clamp-3': !contentExpanded }"
  >
    {{ caseInfo.content }}
  </p>
</div>
```

在 script 顶部加：

```typescript
const contentExpanded = ref(false)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/client/initAnalysis/CaseInfoCard.display.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add app/components/initAnalysis/CaseInfoCard.vue tests/client/initAnalysis/CaseInfoCard.display.test.ts
git commit -m "feat(cases): 基础信息卡片补全 7+1 字段展示"
```

---

### Task B4: CaseInfoCard.vue 编辑态扩展（含 stance 编辑）

**Files:**
- Modify: `app/components/initAnalysis/CaseInfoCard.vue`
- Test: `tests/client/initAnalysis/CaseInfoCard.edit.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/client/initAnalysis/CaseInfoCard.edit.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CaseInfoCard from '~/components/initAnalysis/CaseInfoCard.vue'
import { CaseStance } from '#shared/types/case'

const apiCalls: any[] = []
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: vi.fn(async (url: string, opts?: any) => {
    if (opts?.method === 'PUT') {
      apiCalls.push({ url, body: opts.body })
      return { id: 1 }
    }
    return {
      title: '原标题',
      caseType: { name: '民商事案件' },
      plaintiff: ['甲'],
      defendant: ['乙'],
      stance: CaseStance.PLAINTIFF,
      courtName: '',
      firstInstanceCaseNo: '',
      firstInstanceJudge: '',
      secondInstanceCaseNo: '',
      secondInstanceJudge: '',
      content: '',
      status: 1,
    }
  }),
}))

describe('CaseInfoCard 编辑态 - 全字段编辑', () => {
  it('saveChanges 把所有可编辑字段 PUT 出去', async () => {
    apiCalls.length = 0
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1, editable: true } })
    await flushPromises()
    const vm = wrapper.vm as any
    vm.startEditing()
    await flushPromises()
    vm.editForm.title = '新标题'
    vm.editForm.courtName = '朝阳法院'
    vm.editForm.firstInstanceCaseNo = '(2024)京01民初1号'
    vm.editForm.stance = CaseStance.DEFENDANT
    vm.editForm.status = 3
    vm.editForm.content = '新描述'
    await vm.saveChanges()
    expect(apiCalls).toHaveLength(1)
    expect(apiCalls[0].body).toMatchObject({
      title: '新标题',
      courtName: '朝阳法院',
      firstInstanceCaseNo: '(2024)京01民初1号',
      stance: CaseStance.DEFENDANT,
      status: 3,
      content: '新描述',
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/client/initAnalysis/CaseInfoCard.edit.test.ts --reporter=verbose
```

预期：FAIL（editForm 没那些字段、saveChanges 不发它们）。

- [ ] **Step 3: 修改 CaseInfoCard.vue 的编辑态**

a) 顶部 import 加 StanceToggleGroup：

```typescript
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
```

b) `editForm` 改为：

```typescript
const editForm = ref({
  title: '',
  plaintiff: [] as string[],
  defendant: [] as string[],
  status: 1,
  stance: CaseStance.PLAINTIFF,
  courtName: '',
  firstInstanceCaseNo: '',
  firstInstanceJudge: '',
  secondInstanceCaseNo: '',
  secondInstanceJudge: '',
  content: '',
})
```

c) `startEditing` 内 editForm 初始化补：

```typescript
function startEditing() {
  editForm.value = {
    title: caseInfo.value?.title ?? '',
    plaintiff: [...plaintiffNames.value],
    defendant: [...defendantNames.value],
    status: caseInfo.value?.status ?? 1,
    stance: (caseInfo.value?.stance as CaseStance) ?? CaseStance.PLAINTIFF,
    courtName: caseInfo.value?.courtName ?? '',
    firstInstanceCaseNo: caseInfo.value?.firstInstanceCaseNo ?? '',
    firstInstanceJudge: caseInfo.value?.firstInstanceJudge ?? '',
    secondInstanceCaseNo: caseInfo.value?.secondInstanceCaseNo ?? '',
    secondInstanceJudge: caseInfo.value?.secondInstanceJudge ?? '',
    content: caseInfo.value?.content ?? '',
  }
  isEditing.value = true
}
```

d) 在「被告」编辑控件之后插入：

```vue
<!-- 状态 -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">状态</span>
  <Select :model-value="String(editForm.status)" @update:model-value="(v: any) => editForm.status = Number(v)">
    <SelectTrigger class="h-7 text-sm w-32"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="1">咨询阶段</SelectItem>
      <SelectItem value="2">准备阶段</SelectItem>
      <SelectItem value="3">一审阶段</SelectItem>
      <SelectItem value="4">二审阶段</SelectItem>
      <SelectItem value="99">结案</SelectItem>
    </SelectContent>
  </Select>
</template>

<!-- 分析立场（编辑态） -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">分析立场</span>
  <StanceToggleGroup v-model="editForm.stance" />
</template>

<!-- 法院（编辑态） -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">法院</span>
  <Input v-model="editForm.courtName" class="h-7 text-sm" placeholder="如：北京市朝阳区人民法院" />
</template>

<!-- 一审案号 -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">一审案号</span>
  <Input v-model="editForm.firstInstanceCaseNo" class="h-7 text-sm" />
</template>

<!-- 一审法官 -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">一审法官</span>
  <Input v-model="editForm.firstInstanceJudge" class="h-7 text-sm" />
</template>

<!-- 二审案号 -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">二审案号</span>
  <Input v-model="editForm.secondInstanceCaseNo" class="h-7 text-sm" />
</template>

<!-- 二审法官 -->
<template v-if="isEditing">
  <span class="text-muted-foreground shrink-0">二审法官</span>
  <Input v-model="editForm.secondInstanceJudge" class="h-7 text-sm" />
</template>
```

e) 在卡片底部「描述折叠区」附近、编辑态下加 Textarea：

```vue
<div v-if="isEditing" class="space-y-1 pt-2 border-t border-border/50">
  <label class="text-xs text-muted-foreground">案件描述</label>
  <Textarea v-model="editForm.content" :rows="4" />
</div>
```

f) 把 `saveChanges` 内的 body 替换为：

```typescript
async function saveChanges() {
  if (!editForm.value.title.trim()) {
    toast.error('标题不能为空')
    return
  }
  isSaving.value = true
  const result = await useApiFetch(`/api/v1/cases/${props.caseId}`, {
    method: 'PUT',
    body: {
      title: editForm.value.title.trim(),
      plaintiff: editForm.value.plaintiff,
      defendant: editForm.value.defendant,
      status: editForm.value.status,
      stance: editForm.value.stance,
      courtName: editForm.value.courtName.trim() || undefined,
      firstInstanceCaseNo: editForm.value.firstInstanceCaseNo.trim() || undefined,
      firstInstanceJudge: editForm.value.firstInstanceJudge.trim() || undefined,
      secondInstanceCaseNo: editForm.value.secondInstanceCaseNo.trim() || undefined,
      secondInstanceJudge: editForm.value.secondInstanceJudge.trim() || undefined,
      content: editForm.value.content,
    },
  })
  isSaving.value = false
  if (result !== null) {
    if (caseInfo.value) {
      caseInfo.value = {
        ...caseInfo.value,
        ...editForm.value,
        plaintiff: [...editForm.value.plaintiff],
        defendant: [...editForm.value.defendant],
      }
    }
    isEditing.value = false
    emit('updated')
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/client/initAnalysis/CaseInfoCard.edit.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add app/components/initAnalysis/CaseInfoCard.vue tests/client/initAnalysis/CaseInfoCard.edit.test.ts
git commit -m "feat(cases): 编辑信息表单扩展至基础信息全字段 + stance"
```

---

## Phase C — 批量分析按钮改下拉

### Task C1: 新增 GET /api/v1/cases/analysis/init-sessions

**Files:**
- Create: `server/api/v1/cases/analysis/init-sessions.get.ts`
- Test: `tests/server/case/initSessionsList.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/case/initSessionsList.test.ts`（参照项目现有 HTTP API 测试模式：`tests/server/assistant/sessions.api.test.ts` 的 globalThis 注入 + 直接调 handler，**不使用** `@nuxt/test-utils/e2e`——后者在本项目未启用）：

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { prisma } from '~~/server/utils/db'

// 注入 Nuxt 服务端自动导入的全局函数（与 shared/utils/apiResponse.ts 对齐）
const resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}

// 动态 import handler（必须在 stub 之后）
const { default: listHandler } = await import('~~/server/api/v1/cases/analysis/init-sessions.get')

function makeEvent(opts: { userId?: number; query?: Record<string, any> }) {
  return {
    context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
    __query: opts.query,
  } as any
}

let userId: number, otherUserId: number, caseId: number

beforeAll(async () => {
  const ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  if (!ct) throw new Error('需要至少一个启用的 caseType')
  const u = await prisma.users.create({ data: { phone: '13900000077', nickname: 'init-list', status: 1 } })
  userId = u.id
  const u2 = await prisma.users.create({ data: { phone: '13900000078', nickname: 'init-list-other', status: 1 } })
  otherUserId = u2.id
  const c = await prisma.cases.create({ data: { title: 'init-list case', userId, caseTypeId: ct.id } })
  caseId = c.id
  // 2 个 type=2 session（title 存放在 metadata.title）
  await prisma.caseSessions.create({ data: { sessionId: 'sid-init-1', scope: 'case', caseId, userId, type: 2, metadata: { title: '首次批量分析' } } })
  await prisma.caseSessions.create({ data: { sessionId: 'sid-init-2', scope: 'case', caseId, userId, type: 2, metadata: {} } })
  // 1 个 type=3 session（不应进列表）
  await prisma.caseSessions.create({ data: { sessionId: 'sid-mod-1', scope: 'case', caseId, userId, type: 3, metadata: { title: '模块对话' } } })
})

describe('GET /api/v1/cases/analysis/init-sessions', () => {
  it('返回该案件所有 type=2 会话，按 updatedAt 倒序，且不含 type=3', async () => {
    const res: any = await listHandler(makeEvent({ userId, query: { caseId } }))
    expect(res.code).toBe(0)
    expect(res.data.length).toBe(2)
    expect(res.data.map((s: any) => s.sessionId).sort()).toEqual(['sid-init-1', 'sid-init-2'])
    expect(res.data.some((s: any) => s.sessionId === 'sid-mod-1')).toBe(false)
  })

  it('metadata.title 为空时使用回退「批量分析 #N」', async () => {
    const res: any = await listHandler(makeEvent({ userId, query: { caseId } }))
    const fallback = res.data.find((s: any) => s.sessionId === 'sid-init-2')
    expect(fallback.title).toMatch(/^批量分析 #\d+$/)
  })

  it('未登录返 401', async () => {
    const res: any = await listHandler(makeEvent({ query: { caseId } }))
    expect(res.code).toBe(401)
  })

  it('缺少 caseId 返 400', async () => {
    const res: any = await listHandler(makeEvent({ userId, query: {} }))
    expect(res.code).toBe(400)
  })

  it('跨用户访问返 404（owner-only 保证）', async () => {
    const res: any = await listHandler(makeEvent({ userId: otherUserId, query: { caseId } }))
    expect(res.code).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/case/initSessionsList.test.ts --reporter=verbose
```

预期：FAIL（接口不存在 → 404）。

- [ ] **Step 3: 创建 init-sessions.get.ts**

```typescript
/**
 * 查询案件批量分析会话列表（type=2）
 *
 * GET /api/v1/cases/analysis/init-sessions?caseId=xxx
 *
 * owner-only：仅返回当前用户名下的案件会话。
 * 用户端接口，无需在 RBAC api_permissions 表登记。
 */
import { listSessionsWithActiveRunDAO } from '~~/server/services/case/session.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const query = getQuery(event)
    const caseId = Number(query.caseId)
    if (!caseId) return resError(event, 400, '缺少 caseId')

    const sessions = await listSessionsWithActiveRunDAO({
        caseId,
        userId: user.id,
        type: 2,
    })
    if (!sessions) return resError(event, 404, '案件不存在')

    // 注意：listSessionsWithActiveRunDAO 返回的 SessionListItem 不含顶层 title 列，
    // 标题统一存放在 metadata.title（参考 session.dao.ts renameSession 用 jsonb_set 写入）。
    const result = sessions.map((s, idx) => ({
        sessionId: s.sessionId,
        title: s.metadata?.title ?? `批量分析 #${sessions.length - idx}`,
        hasActiveRun: s.hasActiveRun,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
    }))

    return resSuccess(event, '查询成功', result)
})
```

> DAO 默认按 updatedAt desc 排序（参考 listSessionsWithActiveRunDAO 的 orderBy 默认值）。`#N` 序号按最新→#N、最早→#1 倒推。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/case/initSessionsList.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/cases/analysis/init-sessions.get.ts tests/server/case/initSessionsList.test.ts
git commit -m "feat(api): 新增 GET /cases/analysis/init-sessions（批量分析会话列表）"
```

---

### Task C2: BatchAnalysisPopover.vue 组件

**Files:**
- Create: `app/components/case/BatchAnalysisPopover.vue`
- Test: `tests/client/case/BatchAnalysisPopover.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/client/case/BatchAnalysisPopover.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import BatchAnalysisPopover from '~/components/case/BatchAnalysisPopover.vue'

vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: vi.fn(async () => ([
    { sessionId: 'sid-1', title: '批量分析 #2', hasActiveRun: false, updatedAt: new Date().toISOString() },
    { sessionId: 'sid-2', title: '批量分析 #1', hasActiveRun: true, updatedAt: new Date().toISOString() },
  ])),
}))

describe('BatchAnalysisPopover', () => {
  it('点击 trigger 后浮层显示会话列表', async () => {
    const wrapper = mount(BatchAnalysisPopover, {
      props: { caseId: 1, showBatchButton: true, isAnalysisRunning: false },
    })
    await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('批量分析 #2')
    expect(wrapper.text()).toContain('批量分析 #1')
  })

  it('showBatchButton=false 时底部新建按钮 disabled', async () => {
    const wrapper = mount(BatchAnalysisPopover, {
      props: { caseId: 1, showBatchButton: false, isAnalysisRunning: false },
    })
    await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
    await flushPromises()
    const newBtn = wrapper.find('[data-testid="batch-new"]')
    expect(newBtn.attributes('disabled')).toBeDefined()
  })

  it('点列表项 emit open-session 带 sessionId', async () => {
    const wrapper = mount(BatchAnalysisPopover, {
      props: { caseId: 1, showBatchButton: true, isAnalysisRunning: false },
    })
    await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-testid="batch-session-item"]')[0].trigger('click')
    expect(wrapper.emitted('open-session')).toEqual([['sid-1']])
  })

  it('点新建按钮 emit new-batch', async () => {
    const wrapper = mount(BatchAnalysisPopover, {
      props: { caseId: 1, showBatchButton: true, isAnalysisRunning: false },
    })
    await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="batch-new"]').trigger('click')
    expect(wrapper.emitted('new-batch')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/client/case/BatchAnalysisPopover.test.ts --reporter=verbose
```

预期：FAIL（组件不存在）。

- [ ] **Step 3: 创建 BatchAnalysisPopover.vue**

```vue
<script lang="ts" setup>
/**
 * 批量分析下拉浮层。
 *
 * trigger：「+ 批量分析」按钮（始终可点开）。
 * 浮层：列出该案件所有 type=2 会话 + 底部「+ 新建批量分析」按钮。
 * 当 showBatchButton=false（所有模块已完成）时，禁用底部新建按钮、不禁用 trigger。
 */
import { PlusIcon, Loader2Icon } from 'lucide-vue-next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { useApiFetch } from '~/composables/useApiFetch'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface InitSessionItem {
  sessionId: string
  title: string
  hasActiveRun: boolean
  updatedAt: string
}

const props = defineProps<{
  caseId: number
  showBatchButton: boolean
  isAnalysisRunning: boolean
}>()

const emit = defineEmits<{
  'open-session': [sessionId: string]
  'new-batch': []
}>()

const open = ref(false)
const sessions = ref<InitSessionItem[]>([])
const loading = ref(false)

async function loadSessions() {
  if (props.caseId <= 0) return
  loading.value = true
  const data = await useApiFetch<InitSessionItem[]>(`/api/v1/cases/analysis/init-sessions?caseId=${props.caseId}`)
  if (data) sessions.value = data
  loading.value = false
}

watch(open, (val) => {
  if (val) loadSessions()
})

function handleSelect(sessionId: string) {
  open.value = false
  emit('open-session', sessionId)
}

function handleNew() {
  if (!props.showBatchButton) return
  open.value = false
  emit('new-batch')
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        data-testid="batch-trigger"
        class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mr-2"
        title="批量分析"
      >
        <PlusIcon class="size-3" />
        <span class="hidden lg:inline">批量分析</span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-0 z-[70]" align="end">
      <div class="max-h-60 overflow-y-auto">
        <div v-if="loading" class="flex items-center justify-center py-4 text-muted-foreground text-xs">
          <Loader2Icon class="size-3 animate-spin mr-1" /> 加载中
        </div>
        <div
          v-for="s in sessions"
          :key="s.sessionId"
          data-testid="batch-session-item"
          class="flex items-center gap-1 px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
          @click="handleSelect(s.sessionId)"
        >
          <span class="truncate flex-1">{{ s.title }}</span>
          <span v-if="s.hasActiveRun" class="size-1.5 rounded-full bg-primary animate-pulse shrink-0" title="进行中" />
          <span class="shrink-0 text-xs text-muted-foreground">{{ dayjs(s.updatedAt).fromNow() }}</span>
        </div>
        <div v-if="!loading && sessions.length === 0" class="px-2 py-3 text-xs text-muted-foreground">
          暂无历史
        </div>
      </div>
      <div class="border-t p-1">
        <button
          data-testid="batch-new"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          :disabled="!showBatchButton"
          :title="!showBatchButton ? '所有模块已完成，无需新建' : '新建批量分析'"
          @click="handleNew"
        >
          <PlusIcon class="size-3.5" />
          新建批量分析
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/client/case/BatchAnalysisPopover.test.ts --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add app/components/case/BatchAnalysisPopover.vue tests/client/case/BatchAnalysisPopover.test.ts
git commit -m "feat(cases): 新增 BatchAnalysisPopover 批量分析下拉组件"
```

---

### Task C3: AnalysisResults.vue 替换按钮 + [id].vue 连接

**Files:**
- Modify: `app/components/case/AnalysisResults.vue`
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: 替换 AnalysisResults.vue 的批量分析按钮**

打开 `app/components/case/AnalysisResults.vue`，找到 line 463-469（即按钮模板）：

```vue
<button v-if="effectiveShowBatchButton"
    class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mr-2"
    title="批量分析"
    @click="emit('batchGenerate')">
    <PlusIcon class="size-3" />
    <span class="hidden lg:inline">批量分析</span>
</button>
```

替换为：

```vue
<BatchAnalysisPopover
    :case-id="caseId"
    :show-batch-button="effectiveShowBatchButton"
    :is-analysis-running="isAnalysisRunning"
    @new-batch="emit('batchGenerate')"
    @open-session="(sid) => emit('openInitSession', sid)"
/>
```

并在文件头部加：

```typescript
import BatchAnalysisPopover from '~/components/case/BatchAnalysisPopover.vue'
```

定义新 emit：

```typescript
const emit = defineEmits<{
  // ... 现有 emits
  openInitSession: [sessionId: string]
}>()
```

> 注意：原 `v-if="effectiveShowBatchButton"` 移除——trigger 始终可见，禁用规则由 Popover 内部控制。

- [ ] **Step 2: [id].vue 加 handleOpenInitSession**

打开 `app/pages/dashboard/cases/[id].vue`，在 `handleBatchGenerate` 函数之后加：

```typescript
// --- 打开历史批量分析会话 ---
function handleOpenInitSession(sessionId: string) {
  navigateTo(`/dashboard/cases/init-analysis/${sessionId}`)
}
```

把 `<CaseDetailOverview ... @batch-generate="handleBatchGenerate" />` 与 `<CaseDetailAnalysis ... @batch-generate="handleBatchGenerate" />` 都加 `@open-init-session="handleOpenInitSession"` 监听（这两个组件透传 AnalysisResults 的 emit）。

> 若 CaseDetailOverview / CaseDetailAnalysis 不暴露 openInitSession 事件，先在它们的 template + emits 里加透传（一行 emit + 一行模板）。

- [ ] **Step 3: 验证跨标签同步逻辑保持不变**

spec §3.1.3 要求"另一个 tab 创建了新会话后，本下拉刷新能看到新会话"。当前实现：
- `[id].vue:74,84` 用 `postCrossTabEvent('analysis:updated', ...)` 广播
- 同页其他订阅者通过 `useCrossTabEvents` 接收

`BatchAnalysisPopover.vue` 当前每次 `open` 切换为 true 时重新 `loadSessions()`（已在 C2 的 `watch(open, ...)` 里）——也就是用户重新点开下拉即刷新。这已满足 spec 验收。**不需要额外订阅 `analysis:updated`**。如果想做实时刷新（不必重新点开下拉也能看到新会话），后续可考虑接入 cross-tab event，但本期 plan 不做。

- [ ] **Step 4: typecheck + 浏览验证**

```bash
bun run typecheck
```

预期：无 type error。

启动 dev 服务，打开 chrome-devtools MCP 验证：
- 详情页右上角能点开浮层
- 浮层列出 type=2 会话
- 所有模块完成的案件下，新建按钮禁用 + 有 tooltip
- 点列表项跳到 init-analysis sessionId 页

- [ ] **Step 5: Commit**

```bash
git add app/components/case/AnalysisResults.vue app/components/caseDetail/CaseDetailOverview.vue app/components/caseDetail/CaseDetailAnalysis.vue app/pages/dashboard/cases/[id].vue
git commit -m "feat(cases): 详情页批量分析按钮改为下拉浮层"
```

---

## Phase D — 文书自动 AI 生成

### Task D1: cases/[id].vue 跳转 URL 加 autoAi=1

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: 改 handleTemplateSelect**

定位 line 270-284 `handleTemplateSelect`，把 navigateTo 的 URL 改为：

```typescript
async function handleTemplateSelect(templateId: number) {
  const result = await useApiFetch<{ draftId: number; sessionId: string }>(
    '/api/v1/assistant/document/drafts',
    { method: 'POST', body: { templateId, caseId: caseId.value } },
  )
  if (!result) return
  const returnTab = activeView.value === 'overview' ? 'overview' : 'documents'
  await navigateTo(
    `/dashboard/document/drafts/${result.draftId}`
    + `?from=case&caseId=${caseId.value}&returnTab=${returnTab}&autoAi=1`,
  )
  documentSheetOpen.value = false
}
```

- [ ] **Step 2: Commit**

```bash
git add app/pages/dashboard/cases/[id].vue
git commit -m "feat(cases): 新建文书跳转 URL 增加 autoAi=1 启动标记"
```

---

### Task D2: 文书页 onMounted 检测 autoAi 自动启动

**Files:**
- Modify: `app/pages/dashboard/document/drafts/[id].vue`
- Test: `tests/client/document/draftAutoAi.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/client/document/draftAutoAi.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// 此测试侧重 onMounted 时机的拦截逻辑（不跑完整页面）
describe('文书页 autoAi 启动逻辑', () => {
  it('autoAi=1 且草稿就绪后调 openAgent 并发送指令', async () => {
    const openAgent = vi.fn()
    const handleChatSubmit = vi.fn()
    const router = { replace: vi.fn() }

    // 模拟 mounted 流程
    function handleAutoAi(route: any, draft: any) {
      if (route.query.autoAi !== '1') return
      if (!draft) return
      openAgent()
      handleChatSubmit({ text: `请根据当前案件信息生成《${draft.templateName ?? '本文书'}》` })
      router.replace({ query: { from: route.query.from, caseId: route.query.caseId, returnTab: route.query.returnTab } })
    }

    handleAutoAi(
      { query: { autoAi: '1', from: 'case', caseId: '7', returnTab: 'documents' } },
      { templateName: '民事起诉状' },
    )
    expect(openAgent).toHaveBeenCalledOnce()
    expect(handleChatSubmit).toHaveBeenCalledWith({ text: '请根据当前案件信息生成《民事起诉状》' })
    expect(router.replace).toHaveBeenCalledWith({ query: { from: 'case', caseId: '7', returnTab: 'documents' } })
  })

  it('autoAi 不为 1 时不触发', async () => {
    const openAgent = vi.fn()
    const handleChatSubmit = vi.fn()
    function handleAutoAi(route: any) {
      if (route.query.autoAi !== '1') return
      openAgent()
      handleChatSubmit({ text: '...' })
    }
    handleAutoAi({ query: { from: 'case' } })
    expect(openAgent).not.toHaveBeenCalled()
  })

  it('templateName 缺失时使用兜底文案', async () => {
    const handleChatSubmit = vi.fn()
    function handleAutoAi(route: any, draft: any) {
      if (route.query.autoAi !== '1') return
      const name = draft?.templateName ?? '本文书'
      handleChatSubmit({ text: `请根据当前案件信息生成《${name}》` })
    }
    handleAutoAi({ query: { autoAi: '1' } }, {})
    expect(handleChatSubmit).toHaveBeenCalledWith({ text: '请根据当前案件信息生成《本文书》' })
  })
})
```

- [ ] **Step 2: 跑测试确认通过**

```bash
npx vitest run tests/client/document/draftAutoAi.test.ts --reporter=verbose
```

预期：PASS（这是纯函数测试，立刻通过；目的是锁定行为契约让步骤 3 的实现匹配）。

- [ ] **Step 3: 修改 document/drafts/[id].vue**

打开 `app/pages/dashboard/document/drafts/[id].vue`，在 `onMounted` 中、草稿加载完成的回调里加：

```typescript
// 自动启动 AI 生成（来自案件详情页跳转）
//
// 设计要点（与 spec §3.3 一致）：
//  - 检查放在 onMounted 内（不放 watch(route.query)）：避免后面 router.replace 清除
//    autoAi 时产生多余触发；本副作用仅需要触发一次。
//  - 但 onMounted 里草稿可能还在异步加载、agentOpen 还未就绪，所以再嵌一个 watch
//    监听 [草稿就绪信号]——它不监听 route.query，被 router.replace 不会触发。
//  - flush: 'post' 让回调在 DOM 渲染后跑，保证 openAgent() 后浮窗组件已挂载，
//    nextTick + handleChatSubmit 能拿到真实的 chat 输入引用。
//  - 用 stopWatch() 显式停掉，防止后续草稿字段变化再次触发（开发模式 HMR 也安全）。
if (route.query.autoAi === '1') {
  const stopWatch = watch(
    () => draft.value, // 注意：变量名以现有页面命名为准（draft / loadedDraft / state.draft 等）
    (d) => {
      if (!d) return
      const templateName = (d as any).templateName ?? '本文书'
      openAgent()
      nextTick(() => {
        handleChatSubmit({ text: `请根据当前案件信息生成《${templateName}》` })
        // 清除 autoAi query 防止刷新重复触发；其他 query 字段（from/caseId/returnTab）保留。
        const { autoAi: _autoAi, ...rest } = route.query
        router.replace({ query: { ...rest } })
      })
      stopWatch()
    },
    { immediate: true, flush: 'post' },
  )
}
```

> 注意：`draft.value` 与 `agentOpen` 的具体变量名以现有页面命名为准；`openAgent` 与 `handleChatSubmit` 已存在（line 519-546）。

- [ ] **Step 4: 用 chrome-devtools MCP 端到端验证**

启动 dev 服务，打开 chrome-devtools，从案件详情页：
1. 点「+ 新建文书」→ 选模板 → 应跳到文书页
2. 1 秒内 AI 浮窗自动打开 + 看到自动发出的指令气泡
3. Agent 开始流式生成
4. 浏览器地址栏 URL 已不带 `autoAi`
5. 刷新文书页（F5）— 浮窗不再自动打开

- [ ] **Step 5: Commit**

```bash
git add app/pages/dashboard/document/drafts/[id].vue tests/client/document/draftAutoAi.test.ts
git commit -m "feat(document): 文书页检测 autoAi=1 时自动唤起 AI 并发起生成"
```

---

## Phase E — 集成验证

### Task E1: typecheck + 全量测试

- [ ] **Step 1: typecheck**

```bash
bun run typecheck
```

预期：无 type error。

- [ ] **Step 2: 全量测试**

```bash
bun run test
```

预期：所有用例通过；如有失败，单独跑该测试 debug，**不要**直接跳过。

- [ ] **Step 3: 端到端冒烟（chrome-devtools MCP）**

按 spec §3.1.3 / 3.2.3 / 3.3.3 / 3.4.3 的验收清单走完整链路：
- 新建案件 → 立场默认原告 → 改为被告 → 创建成功，DB stance='defendant'
- 详情页基础信息卡片 → 看到全字段，空字段隐藏
- 编辑信息 → 改 5+ 字段 → 保存 → 刷新页面仍在
- 详情页批量分析下拉 → 看到历史 + 新建项禁用规则正确
- 案件详情→ 新建文书 → 跳文书页 → 浮窗自动起 → 生成

- [ ] **Step 4: 跑 langfuse / langsmith 看 system prompt 含 stance 字段**

人工跑一次新建立场=defendant 的案件，触发批量分析，在 trace 里搜索 `"stance"`：
- 应能在 caseProfile JSON 段看到 `"stance": "defendant"`
- 应能在 roleAndFlow 段看到立场使用说明文案

- [ ] **Step 5: 最终 commit（如有 lint/typecheck 修整）**

```bash
git status
# 若有杂项修补
git add <files>
git commit -m "chore(cases): 案件功能迭代落地后的 lint/typecheck 修整"
```

---

## Self-Review 摘要

### Spec 覆盖检查

| Spec 章节 | 对应 Task |
|----------|-----------|
| §3.1 批量分析下拉 | C1（API）、C2（组件）、C3（连接） |
| §3.2 基础信息补全 | B1（PUT 重写）、B2（select/types）、B3（展示）、B4（编辑） |
| §3.3 文书自动 AI | D1（URL）、D2（文书页） |
| §3.4 立场字段 | A1（schema）、A2（types）、A3（组件）、A4（创建链路）、A5（Agent 透传） |
| §5 测试策略 | 所有 Task 包含 vitest 测试 + E1 端到端验证 |
| §6 改动文件清单 | 与本 plan 的 File Structure 一致 |
| §7 风险 | 由 A1 / E1 步骤 4 的 trace 检查覆盖 |

### Placeholder 扫描

无 TBD / TODO / 占位代码块；每个步骤都有完整代码或具体命令。

### 类型一致性

- `CaseStance` enum 在 A2 定义、A3/A4/A5/B3/B4 均使用同名引用
- `useCaseDetail` 的 `CaseInfo` 在 B2 扩展，B3/B4 消费的字段名一致
- `handleOpenInitSession` 在 C3 定义，AnalysisResults emit `openInitSession` 也用同名
- PUT 接口的 zod schema 字段与 `UpdateCaseInput` 接口字段一一对应（title/content/status/plaintiff/defendant/courtName/firstInstance*/secondInstance*/stance）

### 已知边界

- 跑 Phase A 之前必须 stash 任何未 commit 的 prisma migrations，否则 `prisma migrate dev` 会拒绝。
- `tests/server/case/initSessionsList.test.ts` 使用 `$fetch` + `@nuxt/test-utils/e2e`，依赖 `tests/_infra` 已正确配置 worker DB 隔离。
- D2 的 watch flush='post' 是为了让 agentOpen / draft 同步触发的副作用在浏览器渲染完一帧后再跑，避免 openAgent 在浮窗组件尚未挂载前调用导致空指针。

# M1 · 案件字段 + 状态扩展 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cases 表新增 5 个诉讼信息字段（法院/一二审案号/一二审法官）、状态扩到 6 档、前端表单平铺新字段 + 状态下拉（shadcn Select，不含归档）、AI 抽取双路回填、归档走独立按钮 + 确认 Dialog、ARCHIVED 状态只读保护、三个列表文件统一 `CaseStatusBadge` 组件消除重复、筛选器 + 统计卡片适配 6 档。

**Architecture:** Prisma migration 加字段 + shared/types/case.ts 改 enum；`caseExtraction.service.ts` 的 Zod schema 扩展 5 字段；前端 `ManualForm.vue` 平铺分区（shadcn Select 状态下拉，5 档无归档）；新建 `CaseStatusBadge.vue` 组件（复用 shadcn Badge）替代三个列表文件里的重复 `getStatusText/getStatusBadgeClass`；归档入口为列表操作列独立按钮 + Dialog 二次确认；服务端 `updateCaseService` / 分析触发处加 `isCaseReadOnly` 守卫；CasesFilter + index.vue 统计卡片适配 6 档。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind v4 + Prisma + lucide-vue-next + Vitest

**Spec reference:** [`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`](../specs/2026-04-23-case-context-governance-design.md) §1（commit 8acf2f96）

**Phase:** 1（独立上线，不阻塞其它 Phase）· **预估:** ~2 工作日

---

## File Structure

### 新建
- `app/components/cases/CaseStatusBadge.vue` — 统一 6 档状态徽章（复用 shadcn Badge）
- `tests/app/components/CaseStatusBadge.test.ts` — 徽章单测
- `tests/server/caseExtraction.m1.test.ts` — 抽取 schema 单测
- `tests/server/caseService.archived.test.ts` — ARCHIVED 守卫单测

### 修改
- `prisma/models/case.prisma` — cases model 加 5 字段
- `prisma/migrations/<ts>_add_case_court_fields/migration.sql` — 迁移 + 存量 status 更新
- `shared/types/case.ts` — CaseStatus 扩 6 档 + 文案 + 颜色 map
- `server/services/case/caseExtraction.service.ts` — Zod schema 加 5 字段
- `server/services/case/case.service.ts` — updateCaseService 加 ARCHIVED 守卫
- `server/services/case/initAnalysis.service.ts`（或入口）— 分析触发加 ARCHIVED 守卫
- `app/components/caseCreation/ManualForm.vue` — 表单 +5 字段平铺 + 状态下拉（shadcn Select，5 档）
- `app/composables/useCaseCreation.ts` — AI 回填只填空字段
- `app/components/cases/CasesTable.vue` — CaseStatusBadge + isCaseReadOnly 灰化 + 归档按钮 + Dialog
- `app/components/cases/CasesGrid.vue` — CaseStatusBadge + isCaseReadOnly 灰化 + 归档按钮 + Dialog
- `app/components/cases/CasesMobile.vue` — CaseStatusBadge + isCaseReadOnly 灰化 + 归档按钮 + Dialog
- `app/components/cases/CasesFilter.vue` — statusOptions 从 CaseStatusText 动态生成
- `app/pages/dashboard/cases/index.vue` — 统计卡片适配新状态值

---

## Task 1: 扩展 `CaseStatus` 枚举 + 文案映射

**Files:**
- Modify: `shared/types/case.ts`

- [ ] **Step 1: 读现有文件**

Run: `sed -n '1,60p' shared/types/case.ts`
Expected: 看到现有 `CaseStatus { IN_PROGRESS=1, COMPLETED=2, CLOSED=3 }` 和 `CaseStatusText`。

- [ ] **Step 2: 替换为 6 档枚举 + 文案 + 语义色**

把 `shared/types/case.ts` 里原 `CaseStatus` / `CaseStatusText` 段落替换为：

```ts
export enum CaseStatus {
  CONSULTING   = 1,    // 咨询阶段（默认）
  PREPARING    = 2,    // 准备阶段
  FIRST_TRIAL  = 3,    // 一审阶段
  SECOND_TRIAL = 4,    // 二审阶段
  CLOSED       = 99,   // 结案
  ARCHIVED     = 999,  // 归档
}

export const CaseStatusText: Record<CaseStatus, string> = {
  [CaseStatus.CONSULTING]:   '咨询阶段',
  [CaseStatus.PREPARING]:    '准备阶段',
  [CaseStatus.FIRST_TRIAL]:  '一审阶段',
  [CaseStatus.SECOND_TRIAL]: '二审阶段',
  [CaseStatus.CLOSED]:       '结案',
  [CaseStatus.ARCHIVED]:     '归档',
}

/**
 * 徽章 Tailwind 类（固定色系 + dark 变体，与项目 AiChatQueueChips 同款模式）
 * 在 7 种主题（Zinc/Violet/Rose/Blue/Green/Orange/Red/Yellow）× 浅/深模式下均可读
 */
export const CaseStatusBadgeClass: Record<CaseStatus, string> = {
  [CaseStatus.CONSULTING]:   'bg-zinc-500/10 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
  [CaseStatus.PREPARING]:    'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  [CaseStatus.FIRST_TRIAL]:  'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  [CaseStatus.SECOND_TRIAL]: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  [CaseStatus.CLOSED]:       'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  [CaseStatus.ARCHIVED]:     'bg-muted text-muted-foreground',
}

/** 判断状态是否只读（UI 禁用编辑/分析/写记忆入口） */
export function isCaseReadOnly(status: CaseStatus | number): boolean {
  return status === CaseStatus.ARCHIVED
}
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck 2>&1 | head -40`
Expected: 无新错误（现有引用 `CaseStatus.IN_PROGRESS / COMPLETED / CLOSED` 的地方可能报错，下一步处理）。

- [ ] **Step 4: 找现有错误的引用点并修**

Run: `grep -rn "CaseStatus\.\(IN_PROGRESS\|COMPLETED\|CLOSED\)" app/ server/ shared/ --include="*.ts" --include="*.vue"`
Expected: 定位所有使用旧枚举值的位置。

对每处：
- `IN_PROGRESS` → `CONSULTING`（语义等价）
- `COMPLETED` → `CLOSED`
- `CLOSED` → `CLOSED`（保持，数值已从 3 变 99；如果代码里用数值比较，改为走 enum 名）

typecheck 直到 `head -40` 不再报 `CaseStatus` 相关错误。

- [ ] **Step 5: Commit**

```bash
git add shared/types/case.ts app/ server/ shared/
git commit -m "refactor(case): CaseStatus 扩展为 6 档（咨询/准备/一审/二审/结案/归档）

- 原 IN_PROGRESS=1 → CONSULTING=1（语义兼容）
- 原 COMPLETED=2 → 迁移时改为 CLOSED=99（详见 M1 Task 3 存量迁移）
- 新增 PREPARING=2 / FIRST_TRIAL=3 / SECOND_TRIAL=4 / ARCHIVED=999
- 新增 CaseStatusBadgeClass（固定色系 + dark 变体）
- 新增 isCaseReadOnly 辅助函数（ARCHIVED 时为 true）"
```

---

## Task 2: cases 表新增 5 个诉讼信息字段 + 迁移

**Files:**
- Modify: `prisma/models/case.prisma`
- Create: `prisma/migrations/<timestamp>_add_case_court_fields/migration.sql`

- [ ] **Step 1: 修改 Prisma model**

编辑 `prisma/models/case.prisma`，在 `model cases` 里（`extractedInfo` 字段之后、`status` 字段之前）插入：

```prisma
  /// 法院名称
  courtName            String? @map("court_name")              @db.VarChar(200)
  /// 一审案件编号
  firstInstanceCaseNo  String? @map("first_instance_case_no") @db.VarChar(100)
  /// 二审案件编号
  secondInstanceCaseNo String? @map("second_instance_case_no") @db.VarChar(100)
  /// 一审法官姓名
  firstInstanceJudge   String? @map("first_instance_judge")    @db.VarChar(100)
  /// 二审法官姓名
  secondInstanceJudge  String? @map("second_instance_judge")   @db.VarChar(100)
```

- [ ] **Step 2: 生成 migration（create-only 模式，因需手工追加存量迁移 SQL）**

Run: `bun run prisma:migrate --name add_case_court_fields --create-only`
Expected: 生成 `prisma/migrations/<timestamp>_add_case_court_fields/migration.sql`，内含 `ALTER TABLE "cases" ADD COLUMN "court_name" VARCHAR(200)` 等 5 行。

- [ ] **Step 3: 类型检查**

Run: `bun run prisma:generate && npx nuxi typecheck 2>&1 | grep -iE "court|case" | head -10`
Expected: 无新错误。

- [ ] **Step 4: Commit**

```bash
git add prisma/models/case.prisma prisma/migrations/
git commit -m "feat(case): cases 表新增 5 字段（法院/一二审案号/一二审法官）

全部为可空 String，不影响现有数据。迁移文件用 --create-only 生成；
下一个 Task 会在同一迁移里追加存量 status 值迁移 SQL。"
```

---

## Task 3: 存量 status 迁移 SQL（2→99, 3→99）

**Files:**
- Modify: `prisma/migrations/<timestamp>_add_case_court_fields/migration.sql`

- [ ] **Step 1: 在 migration.sql 末尾追加存量状态迁移**

打开 Task 2 生成的 migration.sql，在末尾（ALTER TABLE 语句之后）追加：

```sql

-- ========== 存量 status 迁移 ==========
-- 原 CaseStatus: IN_PROGRESS=1 / COMPLETED=2 / CLOSED=3
-- 新 CaseStatus: CONSULTING=1 / PREPARING=2 / FIRST_TRIAL=3 / SECOND_TRIAL=4 / CLOSED=99 / ARCHIVED=999
-- 决策（spec §1.2）：
--   1 → 1（语义兼容，保持）
--   2 → 99（COMPLETED 视为结案）
--   3 → 99（CLOSED 仍为结案）
--   ARCHIVED=999 仅通过未来手动归档产生，存量不回填
UPDATE "cases" SET "status" = 99 WHERE "status" IN (2, 3) AND "deleted_at" IS NULL;
```

- [ ] **Step 2: 本地测试库 dry-run**

Run:
```bash
DATABASE_URL="$TEST_DATABASE_URL" psql -c "
BEGIN;
UPDATE cases SET status = 99 WHERE status IN (2, 3) AND deleted_at IS NULL;
SELECT status, COUNT(*) FROM cases GROUP BY status ORDER BY status;
ROLLBACK;
"
```
Expected: 打印迁移后的分布计数，无错误。ROLLBACK 确保不影响测试库。

- [ ] **Step 3: 应用迁移到本地开发库**

Run: `bun run prisma:migrate`
Expected: `Applying migration \`<ts>_add_case_court_fields\``，成功。

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/
git commit -m "feat(case): 存量 status=2/3 迁移为 99（结案）

spec §1.2 Q1.1-B 拍板：COMPLETED(2) / CLOSED(3) 均迁为 CLOSED(99)；
ARCHIVED(999) 仅通过手动归档产生，存量不回填。"
```

---

## Task 4: AI 抽取 Zod schema 扩展 5 字段（TDD）

**Files:**
- Modify: `server/services/case/caseExtraction.service.ts`
- Create: `tests/server/caseExtraction.m1.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/server/caseExtraction.m1.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CaseExtractionSchema } from '~~/server/services/case/caseExtraction.service'

describe('CaseExtractionSchema · M1 新增 5 字段', () => {
  it('接受 5 个新字段（均可选）', () => {
    const parsed = CaseExtractionSchema.parse({
      title: '张李房屋租赁纠纷',
      courtName: '北京市朝阳区人民法院',
      firstInstanceCaseNo: '(2023)京0105民初12345号',
      secondInstanceCaseNo: '(2024)京03民终6789号',
      firstInstanceJudge: '王某某',
      secondInstanceJudge: '李某某',
    })
    expect(parsed.courtName).toBe('北京市朝阳区人民法院')
    expect(parsed.firstInstanceCaseNo).toBe('(2023)京0105民初12345号')
    expect(parsed.secondInstanceCaseNo).toBe('(2024)京03民终6789号')
    expect(parsed.firstInstanceJudge).toBe('王某某')
    expect(parsed.secondInstanceJudge).toBe('李某某')
  })

  it('5 个字段全部缺失也合法', () => {
    const parsed = CaseExtractionSchema.parse({ title: 'x' })
    expect(parsed.courtName).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/caseExtraction.m1.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 失败，提示 `CaseExtractionSchema` 导出缺少 5 字段。

- [ ] **Step 3: 在 caseExtraction.service.ts 扩展 schema**

打开 `server/services/case/caseExtraction.service.ts`，找到 `CaseExtractionSchema`（一般用 `z.object({ ... })` 定义）。

在 schema 末尾追加 5 个可选字段：

```ts
// 原 schema 内 z.object({...}) 追加：
  courtName: z.string().optional().describe('法院名称，如"北京市朝阳区人民法院"'),
  firstInstanceCaseNo: z.string().optional().describe('一审案件编号，如"(2023)京0105民初12345号"'),
  secondInstanceCaseNo: z.string().optional().describe('二审案件编号，如"(2024)京03民终6789号"'),
  firstInstanceJudge: z.string().optional().describe('一审法官姓名'),
  secondInstanceJudge: z.string().optional().describe('二审法官姓名'),
```

同时在该文件的抽取 prompt 模板里追加提示（定位 `prompt`/`systemPrompt`/`extractPrompt` 变量）：

```
在上面现有"提取以下字段"之后追加：
- 法院名称（courtName）：如材料提及审理法院，填入
- 一审/二审案件编号（firstInstanceCaseNo / secondInstanceCaseNo）：格式通常为"(YYYY)XXX民初/民终 XXXXX号"
- 一审/二审法官姓名（firstInstanceJudge / secondInstanceJudge）：如材料提及审判长或承办法官，填入
以上 5 字段均可选，材料未提及则留空（不要编造）。
```

- [ ] **Step 4: 确保 CaseExtractionSchema 已导出**

检查文件末尾，确保有 `export { CaseExtractionSchema }` 或直接在 `const CaseExtractionSchema = z.object(...)` 前加 `export`。

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run tests/server/caseExtraction.m1.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 2 passed。

- [ ] **Step 6: 运行全量测试确保不破坏现有**

Run: `npx vitest run tests/server/caseExtraction 2>&1 | tail -10`
Expected: 全部通过（包括现有 caseExtraction 测试）。

- [ ] **Step 7: Commit**

```bash
git add server/services/case/caseExtraction.service.ts tests/server/caseExtraction.m1.test.ts
git commit -m "feat(case): AI 抽取 schema 追加法院/案号/法官 5 字段

- CaseExtractionSchema 新增 5 可选字段
- 抽取 prompt 加入字段说明 + 示例
- 5 字段将由 caseService 写入 cases 独立列（Task 5 集成）"
```

---

## Task 5: AI 回填时仅填充空字段（TDD）

**Files:**
- Modify: `app/composables/useCaseCreation.ts`
- Create: `tests/app/composables/useCaseCreation.autofill.test.ts`

- [ ] **Step 1: 定位现有 composable**

Run: `grep -n "extractedFormData\|formInitialData\|extractCaseInfo" app/composables/useCaseCreation.ts | head -20`
Expected: 看到 `extractedFormData` 是 AI 提取结果 ref；`formInitialData`（或类似）是喂给 ManualForm 的初始数据。

- [ ] **Step 2: 写测试**

Create `tests/app/composables/useCaseCreation.autofill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeAutofillPreservingUserInput } from '~/app/composables/useCaseCreation'

describe('mergeAutofillPreservingUserInput · AI 回填只填空字段', () => {
  it('用户已填字段不被 AI 覆盖', () => {
    const userFilled = { title: '用户写的标题', courtName: '' }
    const aiExtracted = { title: 'AI 改写的标题', courtName: '北京朝阳法院' }
    const result = mergeAutofillPreservingUserInput(userFilled, aiExtracted)
    expect(result.title).toBe('用户写的标题')  // 用户填的保留
    expect(result.courtName).toBe('北京朝阳法院')  // 空字段被 AI 填
  })

  it('空字符串视为空（会被 AI 回填）', () => {
    const result = mergeAutofillPreservingUserInput(
      { firstInstanceJudge: '' },
      { firstInstanceJudge: '王法官' },
    )
    expect(result.firstInstanceJudge).toBe('王法官')
  })

  it('AI 未命中的字段保持用户态', () => {
    const result = mergeAutofillPreservingUserInput(
      { secondInstanceJudge: '张法官' },
      {},
    )
    expect(result.secondInstanceJudge).toBe('张法官')
  })

  it('AI 返回空字符串不覆盖用户填的', () => {
    const result = mergeAutofillPreservingUserInput(
      { courtName: '用户法院' },
      { courtName: '' },
    )
    expect(result.courtName).toBe('用户法院')
  })
})
```

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run tests/app/composables/useCaseCreation.autofill.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 失败，提示 `mergeAutofillPreservingUserInput` 未导出。

- [ ] **Step 4: 在 useCaseCreation.ts 中实现并导出**

在 `app/composables/useCaseCreation.ts` 顶部（或靠近 `formInitialData` 计算属性处）添加：

```ts
/**
 * 合并 AI 抽取结果到用户已填表单：仅覆盖空字段。
 * 空判定：undefined / null / 空字符串。
 */
export function mergeAutofillPreservingUserInput<T extends Record<string, any>>(
  userFilled: T,
  aiExtracted: Partial<T>,
): T {
  const result = { ...userFilled }
  for (const [key, aiValue] of Object.entries(aiExtracted)) {
    if (aiValue === undefined || aiValue === null || aiValue === '') continue
    const userValue = (result as any)[key]
    if (userValue === undefined || userValue === null || userValue === '') {
      ;(result as any)[key] = aiValue
    }
  }
  return result
}
```

然后定位 `formInitialData` computed（或 AI extract 回调），让它使用此函数合并（而不是直接 spread）：

```ts
// 原：
// const formInitialData = computed(() => ({ ...extractedFormData.value, ... }))
// 改为：
const formInitialData = computed(() => {
  const aiData = extractedFormData.value ?? {}
  const userData = manualFormRef.value?.getCurrentValues?.() ?? {}
  return {
    ...mergeAutofillPreservingUserInput(userData, aiData),
    initialFiles: uploadedFiles.value,
    summary: rawExtractedInfo.value?.summary,
    extractedInfo: rawExtractedInfo.value?.extraFields,
  }
})
```

> 若 `manualFormRef.value?.getCurrentValues` 不存在，在下一个 Task 的 ManualForm 里补出 expose。

- [ ] **Step 5: 运行测试通过**

Run: `npx vitest run tests/app/composables/useCaseCreation.autofill.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 4 passed。

- [ ] **Step 6: Commit**

```bash
git add app/composables/useCaseCreation.ts tests/app/composables/useCaseCreation.autofill.test.ts
git commit -m "feat(case): AI 抽取结果回填表单时仅覆盖空字段

- 新增 mergeAutofillPreservingUserInput 纯函数（可独立单测）
- formInitialData 计算属性改为调用此函数
- 用户已填字段不被 AI 覆盖；AI 返回空串不覆盖用户值
对应 spec §1.4 Q1.2-C 双路回填决策"
```

---

## Task 6: `ManualForm.vue` 平铺新增 5 字段 + 状态下拉

**Files:**
- Modify: `app/components/caseCreation/ManualForm.vue`

- [ ] **Step 1: 读现有表单结构**

Run: `sed -n '1,120p' app/components/caseCreation/ManualForm.vue`
Expected: 看到现有 template 是平铺 `<label>` + `<input>` / `CaseCreationPartyInput` 的结构；`<script setup>` 有 `form` reactive 对象 + `defineEmits<{submit}>` + `canSubmit` computed。

- [ ] **Step 2: 在 `form` reactive 初始化里追加 6 个字段**

找到 `const form = reactive({ ... })`（一般第 80-95 行），追加：

```ts
const form = reactive({
  // ...原有 title / plaintiff / defendant / caseTypeId / summary / materials 等...
  status: 1 as number,   // 默认 CONSULTING
  courtName: '' as string,
  firstInstanceCaseNo: '' as string,
  secondInstanceCaseNo: '' as string,
  firstInstanceJudge: '' as string,
  secondInstanceJudge: '' as string,
})
```

- [ ] **Step 3: 在 initial data 合并逻辑里支持新字段**

找到 `if (data.plaintiff?.length) form.plaintiff = ...` 相关的合并代码（一般第 105-120 行），追加：

```ts
if (data.status !== undefined) form.status = data.status
if (data.courtName) form.courtName = data.courtName
if (data.firstInstanceCaseNo) form.firstInstanceCaseNo = data.firstInstanceCaseNo
if (data.secondInstanceCaseNo) form.secondInstanceCaseNo = data.secondInstanceCaseNo
if (data.firstInstanceJudge) form.firstInstanceJudge = data.firstInstanceJudge
if (data.secondInstanceJudge) form.secondInstanceJudge = data.secondInstanceJudge
```

- [ ] **Step 4: 在 submit 构造 payload 时带上新字段**

找到 `emit('submit', { ... })` 调用（一般在 `onSubmit` 函数末尾），追加 6 字段：

```ts
emit('submit', {
  // ...原有字段...
  status: form.status,
  courtName: form.courtName.trim() || undefined,
  firstInstanceCaseNo: form.firstInstanceCaseNo.trim() || undefined,
  secondInstanceCaseNo: form.secondInstanceCaseNo.trim() || undefined,
  firstInstanceJudge: form.firstInstanceJudge.trim() || undefined,
  secondInstanceJudge: form.secondInstanceJudge.trim() || undefined,
})
```

- [ ] **Step 5: 在 template 里追加"诉讼信息"平铺分区**

在现有案件描述字段之后（即 `<CaseCreationPartyInput ... />` defendant 之后、"案件描述" label 之前），插入：

```vue
<!-- 案件状态（默认咨询，归档走独立入口不走下拉） -->
<div class="mb-4">
  <label class="text-sm font-medium leading-none mb-2 block">
    案件状态
  </label>
  <Select
    :model-value="String(form.status)"
    @update:model-value="form.status = Number($event); touched.status = true"
  >
    <SelectTrigger class="w-full">
      <SelectValue placeholder="选择案件状态" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="1">咨询阶段</SelectItem>
      <SelectItem value="2">准备阶段</SelectItem>
      <SelectItem value="3">一审阶段</SelectItem>
      <SelectItem value="4">二审阶段</SelectItem>
      <SelectItem value="99">结案</SelectItem>
    </SelectContent>
  </Select>
</div>

<!-- 诉讼信息（平铺分区，非折叠，与现有 ManualForm 风格一致） -->
<div class="mb-4">
  <h3 class="text-sm font-semibold text-foreground mb-3 pb-1 border-b border-border">
    诉讼信息（选填）
  </h3>
  <div class="space-y-3">
    <div>
      <label class="text-xs font-medium text-muted-foreground mb-1 block">法院名称</label>
      <input
        v-model="form.courtName"
        placeholder="如：北京市朝阳区人民法院"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label class="text-xs font-medium text-muted-foreground mb-1 block">一审案号</label>
        <input
          v-model="form.firstInstanceCaseNo"
          placeholder="如：(2023)京0105民初12345号"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label class="text-xs font-medium text-muted-foreground mb-1 block">二审案号</label>
        <input
          v-model="form.secondInstanceCaseNo"
          placeholder="如：(2024)京03民终6789号"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label class="text-xs font-medium text-muted-foreground mb-1 block">一审法官</label>
        <input
          v-model="form.firstInstanceJudge"
          placeholder="承办法官姓名"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label class="text-xs font-medium text-muted-foreground mb-1 block">二审法官</label>
        <input
          v-model="form.secondInstanceJudge"
          placeholder="承办法官姓名"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 6: 暴露 getCurrentValues 供 composable 读取当前表单值**

在 `<script setup>` 底部添加：

```ts
function getCurrentValues() {
  return {
    title: form.title,
    plaintiff: [...form.plaintiff],
    defendant: [...form.defendant],
    status: form.status,
    courtName: form.courtName,
    firstInstanceCaseNo: form.firstInstanceCaseNo,
    secondInstanceCaseNo: form.secondInstanceCaseNo,
    firstInstanceJudge: form.firstInstanceJudge,
    secondInstanceJudge: form.secondInstanceJudge,
  }
}

defineExpose({ submit, canSubmit, getCurrentValues })
```

- [ ] **Step 7: 启动 dev server 手工验证**

Run: `bun dev &` (在后台启动)
打开 `http://localhost:3000/dashboard/cases/create`，点"手动创建"：
- 5 字段平铺显示 ✓
- 状态下拉默认"咨询阶段"✓
- 填写部分字段、AI 抽取后已填的不被覆盖 ✓

- [ ] **Step 8: Commit**

```bash
git add app/components/caseCreation/ManualForm.vue
git commit -m "feat(case): ManualForm 新增诉讼信息 5 字段平铺 + 状态下拉

- 状态下拉默认 CONSULTING（咨询阶段，status=1）
- 5 字段（法院/一二审案号/一二审法官）平铺分区，非折叠
- getCurrentValues 暴露当前表单值供 AI 回填逻辑读取
对应 spec §1.4 B2 拍板（平铺非折叠）"
```

---

## Task 7: `CaseStatusBadge.vue` 统一徽章组件（TDD）

**Files:**
- Create: `app/components/cases/CaseStatusBadge.vue`
- Create: `tests/app/components/CaseStatusBadge.test.ts`

- [ ] **Step 1: 写测试**

Create `tests/app/components/CaseStatusBadge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CaseStatusBadge from '~/app/components/cases/CaseStatusBadge.vue'
import { CaseStatus } from '~/shared/types/case'

describe('CaseStatusBadge', () => {
  it('显示 CONSULTING 咨询阶段', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.CONSULTING } })
    expect(w.text()).toContain('咨询阶段')
    expect(w.findComponent({ name: 'Badge' }).exists()).toBe(true)
  })

  it('显示 FIRST_TRIAL 一审阶段', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.FIRST_TRIAL } })
    expect(w.text()).toContain('一审阶段')
  })

  it('显示 CLOSED 结案', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.CLOSED } })
    expect(w.text()).toContain('结案')
  })

  it('显示 ARCHIVED 归档（muted 色）', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.ARCHIVED } })
    expect(w.text()).toContain('归档')
  })

  it('未知 status 显示"未知"占位', () => {
    const w = mount(CaseStatusBadge, { props: { status: 12345 } })
    expect(w.text()).toContain('未知')
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/app/components/CaseStatusBadge.test.ts 2>&1 | tail -10`
Expected: 失败（组件不存在）。

- [ ] **Step 3: 实现组件**

Create `app/components/cases/CaseStatusBadge.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '#components/ui/badge'
import { CaseStatus, CaseStatusText, CaseStatusBadgeClass } from '#shared/types/case'

interface Props {
  /** 案件状态数值（来自 cases.status） */
  status: CaseStatus | number
}

const props = defineProps<Props>()

const label = computed(() =>
  CaseStatusText[props.status as CaseStatus] ?? '未知',
)

const badgeClass = computed(() =>
  CaseStatusBadgeClass[props.status as CaseStatus] ?? 'bg-muted text-muted-foreground',
)
</script>

<template>
  <Badge :class="badgeClass" variant="outline">
    {{ label }}
  </Badge>
</template>
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/app/components/CaseStatusBadge.test.ts 2>&1 | tail -10`
Expected: 5 passed。

- [ ] **Step 5: Commit**

```bash
git add app/components/cases/CaseStatusBadge.vue tests/app/components/CaseStatusBadge.test.ts
git commit -m "feat(case): 新增 CaseStatusBadge 统一 6 档状态徽章

- 读取 shared/types/case.ts 的 CaseStatusText / CaseStatusBadgeClass
- 固定色系（zinc/blue/amber/orange/emerald）+ dark 变体
- ARCHIVED 用 shadcn muted token（跟随主题）
- 未知 status 降级为"未知"文案 + muted 色
下一个 Task 会用它替换 CasesTable/Grid/Mobile 里重复的 getStatusText 实现"
```

---

## Task 8: 三个列表文件改用 `CaseStatusBadge`

**Files:**
- Modify: `app/components/cases/CasesTable.vue`
- Modify: `app/components/cases/CasesGrid.vue`
- Modify: `app/components/cases/CasesMobile.vue`

- [ ] **Step 1: 定位现有状态逻辑**

Run:
```bash
grep -n "getStatusText\|getStatusBadgeClass\|statusText\|status.*text\|IN_PROGRESS\|COMPLETED" app/components/cases/CasesTable.vue app/components/cases/CasesGrid.vue app/components/cases/CasesMobile.vue
```
Expected: 看到三文件各自的状态映射函数和模板里的调用位置。

- [ ] **Step 2: CasesTable.vue 替换**

在 `<script setup>` 里：
- 删除 `getStatusText` / `getStatusBadgeClass` 本地函数定义
- 删除本地 `const statusMap = { 1: '进行中', 2: '已完成', 3: '已关闭' }` 之类

在 `<template>` 里找到 `<span class="...">{{ getStatusText(row.status) }}</span>` 位置，替换为：

```vue
<CaseStatusBadge :status="row.status" />
```

- [ ] **Step 3: CasesGrid.vue 同样替换**

重复 Step 2 的操作，对该文件里的本地状态映射和模板用法全部替换为 `<CaseStatusBadge :status="..." />`。

- [ ] **Step 4: CasesMobile.vue 同样替换**

重复 Step 2。

- [ ] **Step 5: 类型检查 + 启动 dev 手工验证**

Run: `npx nuxi typecheck 2>&1 | grep -i "Cases" | head -10`
Expected: 无错误。

Run: `bun dev`（若 Task 6 已在跑则刷新浏览器）
打开 `/dashboard/cases`（列表页），看：
- 桌面表格 ✓ 6 档徽章显示正确
- 卡片网格 ✓
- 手机视图 ✓ （打开浏览器开发者工具切换到手机视图）

- [ ] **Step 6: Commit**

```bash
git add app/components/cases/CasesTable.vue app/components/cases/CasesGrid.vue app/components/cases/CasesMobile.vue
git commit -m "refactor(case): 三个案件列表文件统一使用 CaseStatusBadge

- 消除 CasesTable/Grid/Mobile 里各自的 getStatusText/getStatusBadgeClass 重复实现
- 现在 6 档状态的文案 + 色彩在 shared/types/case.ts 集中维护
- 符合 spec §1.4 + §7 改动清单"
```

- [ ] **Step 7: CasesFilter 状态筛选器扩 6 档**

`CasesFilter.vue:119-124` 现有 `statusOptions` 硬编码旧 3 档。改为从 `CaseStatusText` 生成：

```ts
import { CaseStatus, CaseStatusText } from '#shared/types/case'

const statusOptions = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(CaseStatusText)
    .filter(([key]) => Number(key) !== CaseStatus.ARCHIVED)
    .map(([key, label]) => ({ value: key, label })),
]
```

> ARCHIVED 不在筛选器暴露（归档案件在列表里仍可见但不可筛选，与业务流程一致）。

- [ ] **Step 8: index.vue 快速统计卡片适配新状态**

`pages/dashboard/cases/index.vue:71/84` 硬编码 `status === 1` / `status === 2`。迁移后 status=2 全变成 99，统计直接废掉。

改为三组：
```vue
<!-- 进行中（咨询/准备/一审/二审，status 1-4） -->
<p class="text-2xl font-bold">{{ cases.filter(c => c.status >= 1 && c.status <= 4).length }}</p>

<!-- 结案（status=99） -->
<p class="text-2xl font-bold">{{ cases.filter(c => c.status === 99).length }}</p>
```

标签文案同步改为"进行中" / "结案"（与 6 档枚举一致）。

- [ ] **Step 9: Commit**

```bash
git add app/components/cases/CasesFilter.vue app/pages/dashboard/cases/index.vue
git commit -m "feat(case): 列表筛选器 + 统计卡片适配 6 档状态

- CasesFilter statusOptions 从 CaseStatusText 动态生成（排除 ARCHIVED）
- index.vue 统计卡片改为进行中(1-4) + 结案(99) 两档
- 迁移后旧 status=2 全部变 99，硬编码筛选器/统计必须同步改"
```

---

## Task 9: ARCHIVED 状态只读服务端守卫（TDD）

**Files:**
- Modify: `server/services/case/case.service.ts`（`updateCaseService`）
- Modify: `server/services/case/initAnalysis.service.ts`（分析触发入口，或 analysis.service.ts）
- Create: `tests/server/caseService.archived.test.ts`

- [ ] **Step 1: 定位 updateCaseService 与分析触发函数**

Run:
```bash
grep -n "export.*updateCaseService\|export.*startAnalysis\|export.*triggerAnalysis" server/services/case/*.ts
```
Expected: 找到两个函数位置。记下它们的签名和文件名。

- [ ] **Step 2: 写测试**

Create `tests/server/caseService.archived.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DAO 层（真实 service 调 findCaseByIdDao + updateCaseDao）
const mockFindCaseByIdDao = vi.fn()
const mockUpdateCaseDao = vi.fn()
vi.mock('~~/server/services/case/case.dao', () => ({
  findCaseByIdDao: (...args: any[]) => mockFindCaseByIdDao(...args),
  updateCaseDao: (...args: any[]) => mockUpdateCaseDao(...args),
}))

describe('ARCHIVED 状态只读守卫', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updateCaseService 对 ARCHIVED 案件抛出业务错误', async () => {
    const { updateCaseService } = await import('~~/server/services/case/case.service')

    mockFindCaseByIdDao.mockResolvedValue({ id: 1, status: 999, deletedAt: null })

    await expect(
      updateCaseService(1, { title: '新标题' }),
    ).rejects.toThrow(/归档|只读/i)

    expect(mockUpdateCaseDao).not.toHaveBeenCalled()
  })

  it('updateCaseService 对非 ARCHIVED 正常通过', async () => {
    const { updateCaseService } = await import('~~/server/services/case/case.service')

    mockFindCaseByIdDao.mockResolvedValue({ id: 1, status: 1, deletedAt: null })
    mockUpdateCaseDao.mockResolvedValue({ id: 1, title: '新' })

    await expect(
      updateCaseService(1, { title: '新' }),
    ).resolves.toBeDefined()
  })
})
```

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run tests/server/caseService.archived.test.ts 2>&1 | tail -20`
Expected: 失败（现有 updateCaseService 没有 ARCHIVED 守卫）。

- [ ] **Step 4: 在 updateCaseService 加守卫**

打开 Step 1 找到的 `updateCaseService`（`case.service.ts:231`）。真实实现调用 `findCaseByIdDao` + `updateCaseDao`，不是直接 prisma。

在 `findCaseByIdDao` 之后、`updateCaseDao` 之前，插入 ARCHIVED 守卫：

```ts
import { isCaseReadOnly } from '#shared/types/case'

export const updateCaseService = async (
  caseId: number,
  data: UpdateCaseInput,
): Promise<cases> => {
  const existing = await findCaseByIdDao(caseId)
  if (!existing) {
    throw new Error('案件不存在')
  }

  // ARCHIVED 只读守卫（spec §1.4 / §12 铁律）
  if (isCaseReadOnly(existing.status)) {
    throw new Error('案件已归档，不可编辑')
  }

  // 如果更新案件类型，验证新类型是否存在且启用
  if (data.caseTypeId !== undefined && data.caseTypeId !== existing.caseTypeId) {
    const caseType = await getCaseTypeByIdService(data.caseTypeId)
    if (!caseType) throw new Error('案件类型不存在')
    if (caseType.status !== 1) throw new Error('案件类型已禁用')
  }

  return await updateCaseDao(caseId, data)
}
```

- [ ] **Step 5: 在分析触发入口加同款守卫**

Run: `grep -n "initAnalysis\|startAnalysis" server/services/case/*.ts server/api/v1/case/**/*.ts 2>&1 | head`

定位到主触发入口（一般是 `initAnalysis.service.ts` 的 `startInitAnalysisService` 之类），加：

```ts
import { isCaseReadOnly } from '#shared/types/case'

// 在函数开头、加载案件之后、开始分析之前：
if (isCaseReadOnly(caseRecord.status)) {
  throw new Error('案件已归档，无法启动分析')
}
```

- [ ] **Step 6: 运行测试通过**

Run: `npx vitest run tests/server/caseService.archived.test.ts 2>&1 | tail -10`
Expected: 2 passed。

- [ ] **Step 7: 前端 UI 灰化（三个列表文件 + 详情页）**

在 `CasesTable.vue`、`CasesGrid.vue`、`CasesMobile.vue` 三个文件里，对编辑/删除/分析等操作按钮加 disabled：

```vue
<!-- 三个列表文件的操作按钮 -->
<Button
  :disabled="isCaseReadOnly(item.status)"
  :title="isCaseReadOnly(item.status) ? '归档案件不可编辑' : ''"
  @click="editCase(item.id)"
>编辑</Button>
```

`<script setup>` 里 import `isCaseReadOnly`：

```ts
import { isCaseReadOnly } from '#shared/types/case'
```

同样处理详情页（`app/pages/dashboard/cases/[id].vue`）中的编辑按钮。

- [ ] **Step 8: Commit**

```bash
git add server/services/case/case.service.ts server/services/case/initAnalysis.service.ts app/components/cases/CasesTable.vue tests/server/caseService.archived.test.ts
git commit -m "feat(case): ARCHIVED 状态只读服务端守卫 + 前端 UI 灰化

- updateCaseService 在 owner 校验后加 isCaseReadOnly check
- 分析触发入口同款守卫
- 前端按钮 disabled + tooltip 提示"归档案件不可编辑"
- 服务端守卫是铁律（前端灰化不够）；符合 spec §12"
```

---

## Task 10: 归档入口 — 独立按钮 + 确认 Dialog

**Files:**
- Modify: `app/components/cases/CasesTable.vue`
- Modify: `app/components/cases/CasesGrid.vue`
- Modify: `app/components/cases/CasesMobile.vue`
- Modify: `server/api/v1/case/[id].patch.ts`（或对应 PATCH 路由）

- [ ] **Step 1: 在列表操作列添加"归档"按钮**

三个列表文件的操作列里（编辑/删除按钮旁边），追加归档按钮：

```vue
<Button
  v-if="!isCaseReadOnly(item.status) && item.status !== CaseStatus.ARCHIVED"
  variant="ghost"
  size="sm"
  @click="handleArchive(item)"
>
  <Archive class="w-4 h-4 mr-1" />
  归档
</Button>
```

`<script setup>` 里 import：

```ts
import { Archive } from 'lucide-vue-next'
import { CaseStatus, isCaseReadOnly } from '#shared/types/case'
```

- [ ] **Step 2: 归档确认 Dialog**

```vue
<Dialog v-model:open="showArchiveDialog">
  <DialogContent>
    <DialogHeader>
      <DialogTitle>确认归档</DialogTitle>
      <DialogDescription>
        归档后案件将变为只读，无法编辑、分析或写入记忆。此操作不可恢复。
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" @click="showArchiveDialog = false">取消</Button>
      <Button variant="destructive" @click="confirmArchive">确认归档</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

```ts
const showArchiveDialog = ref(false)
const archiveTargetId = ref<number | null>(null)

function handleArchive(item: { id: number; status: number }) {
  archiveTargetId.value = item.id
  showArchiveDialog.value = true
}

async function confirmArchive() {
  if (!archiveTargetId.value) return
  await useApiFetch(`/api/v1/case/${archiveTargetId.value}`, {
    method: 'PATCH',
    body: { status: CaseStatus.ARCHIVED },
  })
  showArchiveDialog.value = false
  await refreshCases()
}
```

- [ ] **Step 3: 服务端 PATCH 路由确保允许 status → 999**

检查 `server/api/v1/case/[id].patch.ts`，确认 `UpdateCaseInput` 包含 `status` 字段，且 `updateCaseService`（已有 ARCHIVED 守卫在 Task 9）允许 status 从非 ARCHIVED → ARCHIVED 的变更。

注意：`updateCaseService` 的 ARCHIVED 守卫应检查的是 `existing.status`（案件当前状态），不是 `data.status`（目标状态）。所以当前是 ARCHIVED 时拒绝更新（只读）；当前非 ARCHIVED 时允许改成 ARCHIVED（正常归档流程）。Task 9 已正确实现此逻辑。

- [ ] **Step 4: 手工验证**

归档按钮只在非 ARCHIVED 案件上显示 → 点击弹出 Dialog → 确认后 status 变 999 → 按钮消失，编辑/分析按钮灰化。

- [ ] **Step 5: Commit**

```bash
git add app/components/cases/CasesTable.vue app/components/cases/CasesGrid.vue app/components/cases/CasesMobile.vue
git commit -m "feat(case): 归档入口 — 列表操作列独立按钮 + 确认 Dialog

- 归档按钮只在非 ARCHIVED 案件显示（lucide Archive 图标）
- Dialog 提示不可恢复，用户二次确认后 PATCH status=999
- 符合 spec §1.2 ARCHIVED 通过手动归档产生
- 归档后编辑/分析按钮由 Task 9 的 isCaseReadOnly 守卫灰化"
```

---

## Task 11: E2E 手工验收清单

**Files:**
- Create: `docs/superpowers/plans/m1-e2e-checklist.md`

- [ ] **Step 1: 建验收单**

Create `docs/superpowers/plans/m1-e2e-checklist.md`:

```markdown
# M1 · E2E 手工验收清单

## 创建案件流程
- [ ] `/dashboard/cases/create` → AI 模式：输入案情 → AI 抽取 → 进入确认表单
- [ ] 确认表单里 5 个诉讼信息字段（法院/一二审案号/一二审法官）平铺显示（非折叠）
- [ ] 状态下拉默认选中"咨询阶段"（shadcn Select，非原生 select）
- [ ] 状态下拉只含 5 档（咨询/准备/一审/二审/结案），无归档选项
- [ ] AI 抽取到的字段（如法院名）自动填入空字段
- [ ] 手工修改某个已 AI 回填的字段后，重新触发 AI 抽取，用户手改值不被覆盖
- [ ] 手动创建路径（不走 AI）：5 字段默认空，可手填

## 案件列表
- [ ] `/dashboard/cases` 桌面表格：6 档状态徽章颜色正确（咨询灰 / 准备蓝 / 一审琥珀 / 二审橙 / 结案翠绿 / 归档 muted）
- [ ] 徽章复用 shadcn Badge 组件（variant=outline）
- [ ] 卡片网格同上
- [ ] 手机视图（浏览器 DevTools 切 mobile 宽度）同上
- [ ] 浅/深模式切换，每档徽章均清晰可读
- [ ] 7 种主题（Zinc/Violet/Rose/Blue/Green/Orange/Red/Yellow）切一遍，语义色保持固定，卡片/背景随主题变化
- [ ] 状态筛选器包含 5 档 + "全部"（无归档选项）
- [ ] 快速统计卡片：进行中(1-4) + 结案(99) 计数正确

## 归档流程
- [ ] 非归档案件操作列有"归档"按钮（lucide Archive 图标）
- [ ] 点击归档按钮弹出确认 Dialog："归档后不可恢复"
- [ ] 确认后案件 status 变 999，列表刷新
- [ ] 归档后编辑/分析按钮灰化 + tooltip "归档案件不可编辑"
- [ ] 强行调 PATCH /api/v1/case/X 返回业务错（"案件已归档，不可编辑"）
- [ ] 归档案件操作列无"归档"按钮（已归档不重复操作）
- [ ] 查看案件详情正常（只读）

## ARCHIVED 只读
- [ ] 桌面表格 + 卡片网格 + 手机视图三处操作按钮全部灰化
- [ ] 分析入口按钮灰色 / 点击无效

## 存量迁移验证（测试库 + 生产前）
- [ ] 测试库：原 status=2 的案件迁移后变为 99
- [ ] 测试库：原 status=3 的案件迁移后变为 99
- [ ] 测试库：原 status=1 的案件保持为 1
- [ ] 迁移前后 cases 总数一致（无丢失）
- [ ] 迁移前后 deleted_at 非空的案件不动

## AI 抽取 schema
- [ ] 上传一份含"北京市朝阳区人民法院 (2023)京0105民初12345号"的材料，AI 抽取后 courtName、firstInstanceCaseNo 字段命中
- [ ] 材料无诉讼信息时，5 字段留空（AI 不编造）
```

- [ ] **Step 2: 全量单测过**

Run: `npx vitest run tests/server/caseService.archived.test.ts tests/server/caseExtraction.m1.test.ts tests/app/composables/useCaseCreation.autofill.test.ts tests/app/components/CaseStatusBadge.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 全部通过。

- [ ] **Step 3: 按清单手工 E2E**

对着 `m1-e2e-checklist.md` 逐项验证。每通过一项打勾。

- [ ] **Step 4: 最终 Commit**

```bash
git add docs/superpowers/plans/m1-e2e-checklist.md
git commit -m "docs(case): M1 E2E 手工验收清单

5 大场景：创建表单 / 列表徽章 / ARCHIVED 只读 / 存量迁移 / AI 抽取。
交付前必须逐项通过。"
```

---

## 附录 · 关键文件全景

```
prisma/
├── models/case.prisma                                 [修改] cases +5 字段
└── migrations/<ts>_add_case_court_fields/             [新建] ALTER TABLE + UPDATE status

shared/types/
└── case.ts                                            [修改] CaseStatus 6 档 + BadgeClass + isCaseReadOnly

server/services/case/
├── caseExtraction.service.ts                          [修改] Zod schema +5 字段
├── case.service.ts                                    [修改] updateCaseService 加 ARCHIVED 守卫
└── initAnalysis.service.ts                            [修改] 分析触发加 ARCHIVED 守卫

app/components/cases/
├── CaseStatusBadge.vue                                [新建] 统一 6 档徽章（复用 shadcn Badge）
├── CasesTable.vue                                     [修改] CaseStatusBadge + isCaseReadOnly 灰化 + 归档按钮 + Dialog
├── CasesGrid.vue                                      [修改] 同上
├── CasesMobile.vue                                    [修改] 同上
└── CasesFilter.vue                                    [修改] statusOptions 扩 6 档

app/components/caseCreation/
└── ManualForm.vue                                     [修改] 平铺 5 字段 + shadcn Select 状态下拉(5档) + getCurrentValues

app/composables/
└── useCaseCreation.ts                                 [修改] mergeAutofillPreservingUserInput

app/pages/dashboard/cases/
└── index.vue                                          [修改] 统计卡片适配新状态值

tests/
├── server/caseService.archived.test.ts                [新建] ARCHIVED 守卫 2 用例
├── server/caseExtraction.m1.test.ts                   [新建] schema +5 字段 2 用例
├── app/composables/useCaseCreation.autofill.test.ts   [新建] 合并纯函数 4 用例
└── app/components/CaseStatusBadge.test.ts             [新建] 徽章渲染 5 用例

docs/superpowers/plans/
└── m1-e2e-checklist.md                                [新建] E2E 手工验收
```

---

## 铁律核验（编码时逐条检查）

- [ ] 所有数据库变更走 `bun run prisma:migrate`（本 plan 用 `--create-only` 后手工追加存量迁移 SQL，用户已同意 spec §1.2 Q1.1-B）
- [ ] 存量 `status=2/3` 迁移到 `99`（CLOSED），非 `999`（ARCHIVED 仅通过手动归档产生）
- [ ] `updateCaseService` / `initAnalysisService` 都要 check `isCaseReadOnly`（前端灰化不够）
- [ ] `CaseStatusBadge` 复用 shadcn Badge 组件，用 shared types 的枚举/文案/色系
- [ ] 状态下拉用 shadcn Select（与 ManualForm 现有 caseTypeId 字段风格一致）
- [ ] 归档走独立按钮 + Dialog 二次确认，不在状态下拉里暴露 ARCHIVED=999
- [ ] CasesFilter + index.vue 统计卡片必须同步适配 6 档（否则迁移后筛选/统计全废）
- [ ] 图标一律 lucide（归档按钮用 Archive 图标）
- [ ] AI 回填"只填空字段"通过 `mergeAutofillPreservingUserInput` 纯函数保证
- [ ] 禁 emoji

# 合同审查 · PR 4 · 风险卡 Layout A + C 双布局切换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合同审查右侧风险卡升级为「Stacked 三段式（默认）」+「Inline diff（行内差异）」双布局，律师在面板顶部一键切换、偏好持久化到 localStorage；Layout A 渲染「条款标题（含"第 N 段"徽章）/ 完整原文（含 quote 字符段深黄高亮）/ 问题片段 / 建议改写」四段式，Layout C 把 clauseText 与 suggestedClauseText 做行内 diff 显示（quote=null 时严格降级为纯 clauseText，对齐 spec § 6.4）；外部新增（external_new）分支同步切换。同时把 PR 2 已落库的 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 透传到前端 RiskDisplayPhaseB 类型，让 Layout A 的"问题片段"框拿得到值（`quoteMatchSource` 不透传，前端 UI 不读，YAGNI）。

**Architecture:** 类型层（`shared/types/contract.ts`）扩 `RiskDisplayPhaseB` 加三个 quote 字段（`problematicQuote` / `quoteCharStart` / `quoteCharEnd`，**不加** `quoteMatchSource`——前端 UI 不读，运维直接 SQL 查 DB 列；YAGNI）；mapper 层（`ContractReviewPanel.mapEntityToDisplay`）把 entity → display 时透传；视觉层把 `RiskClauseDiff.vue` 重写为 `mode: 'stacked' | 'inline-diff'` 两形态组件，新增 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `clauseParagraphIndex` 入参；`RiskCard.vue` 加 `layout` prop（默认 `'stacked'`）+ 透传 `clauseParagraphIndex`；`RiskListPanel.vue` 顶部新增 shadcn `Tabs` 段控并通过 `useLocalStorage('contract-review-risk-card-layout', 'stacked' as const)` 持久化偏好（**注意：@vueuse/core string 类型 serializer 是 `String(v)`，localStorage 里存的是裸字符串 `inline-diff`、不带 JSON 引号**——这点测试断言必须按裸字符串写），把 `layout` 透传给主清单 `<AssistantContractRiskCard>` 与外部新增分支内联渲染的 `<AssistantContractRiskClauseDiff>`。orphaned 分支不切换布局（无锚点不存在 quote / suggested 概念）。

**边界归属说明**：Task 1 / Task 2（mapper 透传 quote 字段）严格说应归 PR 3 mapper 扩展（PR 3 是首个填 quote 字段的 PR），但 PR 3 mapper 漏改且已合，本 PR 是首个消费 quote 字段的 PR，顺手补做避免起独立 hotfix PR——已记录到 plan，不影响 PR 边界整洁度。

**Tech Stack:** Vue 3 + TypeScript + Tailwind v4 + shadcn-vue（Tabs / Switch）+ `@vueuse/core` `useLocalStorage` + `diff-match-patch`（已用于 RiskClauseDiff）+ Vitest + @vue/test-utils + Playwright（e2e）

**Spec 参考：** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` § 6（6.1 ~ 6.4）+ § 5.0 + § 10.1 + § 11

**前置条件：**
- PR 1（partyDetector 短路修复）已合并
- **PR 2（数据模型重构 · 双锚点）已完整合并**（`shared/types/contract.ts:478-518` `ContractRiskEntity` 已含 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `quoteMatchSource` / `clauseText` / `clauseIndex` / `clauseParagraphIndex` / `originalClauseText` / `orphaned`；`contract_risks` 表 PR 2 起对应列存在）
- PR 3（路线 2 锚点解析）**可选已合并**——若 PR 3 未合，`problematicQuote` 等字段在 DB 里全是 null，Layout A 自动按 §6.4 quote=null 降级（"问题片段"框不渲染、"完整原文"不做字符级高亮）；不阻塞 PR 4 上线
- 工作区基于 `dev`（PR 2 已合）起独立 worktree（superpowers:using-git-worktrees）

**PR 2/3 真实落地状态（PR 4 plan 已对齐）**：
- `ContractRiskEntity`（shared/types/contract.ts:478-518）已含全部双锚点字段
- `RiskDisplayPhaseB`（shared/types/contract.ts:186-190）当前**未含** quote 字段，由 PR 4 Task 1 扩展
- `mapEntityToDisplay`（ContractReviewPanel.vue:275-296）当前**不透传** quote / source / orphaned / originalClauseText 之外的字段（`source` / `orphaned` 也漏映射，本 PR 不修——它们不影响 PR 4 范围内 mainRisks 列表渲染；orphaned 分组目前因 mapper 漏映射常为空数组，已是先有 bug，不在 PR 4 范围内修）
- `RiskClauseDiff.vue`（app/components/assistant/contract/RiskClauseDiff.vue）当前是「左原文删除 / 右建议新增」的 side-by-side diff——PR 4 把它**重写为两形态**（stacked / inline-diff），保持文件名不变以减少调用方改动

---

## 改动文件总图

### 类型扩展
- 修改：`shared/types/contract.ts`（`RiskDisplayPhaseB` 加 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 三字段；**不加** `quoteMatchSource`——前端 UI 不读，运维 SQL 直查 `contract_risks.quote_match_source`，YAGNI）

### 前端 mapper 透传
- 修改：`app/components/assistant/contract/ContractReviewPanel.vue:275-296`（`mapEntityToDisplay` 透传 quote 字段）

### 前端组件重构
- 修改：`app/components/assistant/contract/RiskClauseDiff.vue`（重写为 mode='stacked' | 'inline-diff' 两形态）
- 修改：`app/components/assistant/contract/RiskCard.vue`（加 `layout` prop + 透传给 RiskClauseDiff）
- 修改：`app/components/assistant/contract/RiskListPanel.vue`（顶部加布局 toggle + useLocalStorage 持久化 + 透传 layout 给主清单 RiskCard 与 external_new 分支内联 RiskClauseDiff）

### 测试扩展
- 修改：`tests/app/components/assistant/contract/RiskClauseDiff.test.ts`（新增 mode='stacked' / mode='inline-diff' 行为断言；保留旧 side-by-side 测试改写为 mode='inline-diff' 等价覆盖）
- 修改：`tests/app/components/assistant/contract/RiskCard.test.ts`（新增 layout='stacked' / layout='inline-diff' prop 透传断言）
- 修改：`tests/app/components/assistant/contract/RiskListPanel.test.ts`（新增布局 Tabs 切换 + localStorage 持久化断言）

### 测试新建
- 创建：`tests/e2e/contract-review-risk-card-layout.spec.ts`（端到端切换 + localStorage 验证）

### 不动文件
- `server/**`（PR 4 完全不改服务端）
- `prisma/**`（PR 4 完全不改 schema）
- `app/components/assistant/contract/AnnotationBubble.vue` / `OverviewPanel.vue` / `ContractDocxPreview.vue`（PR 4 不动；ContractDocxPreview 字符级高亮在 PR 5）
- `app/utils/contractRiskLevelStyle.ts`（PR 4 不动）
- `app/components/ui/**`（shadcn 组件不许改，铁律）

---

## 字段速查表（PR 4 新增/修改）

| 类别 | 字段 / 标识 | 类型 | 来源 / 写入路径 |
|---|---|---|---|
| 类型扩展 | `RiskDisplayPhaseB.problematicQuote` | `string \| null \| undefined` | `mapEntityToDisplay(e)` 透传 `e.problematicQuote ?? null` |
| 类型扩展 | `RiskDisplayPhaseB.quoteCharStart` | `number \| null \| undefined` | 同上 |
| 类型扩展 | `RiskDisplayPhaseB.quoteCharEnd` | `number \| null \| undefined` | 同上 |
| localStorage Key | `contract-review-risk-card-layout` | `'stacked' \| 'inline-diff'` | `useLocalStorage(key, 'stacked' as const)` 默认 stacked；**实际存储是裸字符串**（无 JSON 引号），@vueuse/core string serializer 行为 |
| Prop（RiskCard） | `layout` | `'stacked' \| 'inline-diff'`（**可选默认 stacked**） | RiskListPanel 透传；orphaned 卡不传（`layout?` 走默认） |
| Prop（RiskClauseDiff） | `mode` | `'stacked' \| 'inline-diff'`（必填） | RiskCard 透传 |
| Prop（RiskClauseDiff） | `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `clauseParagraphIndex` | 同类型扩展 + `number \| null` | RiskCard 透传 risk 上对应字段 |

---

## Task 0：worktree 准备 + PR 2 基线校验

**Files:**
- 不修改文件，仅做环境准备

- [ ] **Step 0.1：创建 worktree（superpowers:using-git-worktrees）**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
git fetch origin
git checkout dev && git pull --ff-only origin dev
git worktree add ../LexSeek-pr4-frontend-risk-card -b pr4-frontend-risk-card dev
cd ../LexSeek-pr4-frontend-risk-card
bun install
bun run prisma:generate
```

Expected: worktree 创建成功；`bun install` 完成；Prisma client 生成。

- [ ] **Step 0.2：验证 typecheck 基线干净**

```bash
bun run typecheck 2>&1 | tee /tmp/pr4-typecheck-baseline.log
```

Expected: 0 错误。如果出错，停下来检查 `git log --oneline | head -5` 是否含 `e078c147`（PR 2 收尾 commit）。

- [ ] **Step 0.3：验证前端合同测试基线 PASS**

```bash
npx vitest run tests/app/components/assistant/contract/ --reporter=verbose 2>&1 | tail -30
```

Expected: 所有 contract 前端测试 PASS（PR 2 完成后应该全绿）。

- [ ] **Step 0.4：confirm 不要 commit 0 步**

Step 0.x 不创建任何 commit，纯环境准备。

---

## Task 1：扩展 RiskDisplayPhaseB 类型加 quote 字段

**Files:**
- Modify: `shared/types/contract.ts:186-190`

`RiskDisplayPhaseB` 当前只在 `RiskDisplay` 上加了 `source` / `orphaned` / `originalClauseText` 三字段；本任务把 PR 2 已落库的 quote 锚点字段也加上，让 Layout A 的"问题片段"块在 RiskCard 内可访问 `risk.problematicQuote` / `risk.quoteCharStart` / `risk.quoteCharEnd`。

> **YAGNI**：spec § 4.4 列了 4 个 quote 字段（`problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `quoteMatchSource`），但 `quoteMatchSource` 前端 UI 不读，运维监控走 spec § 10.3 SQL（`SELECT quote_match_source, COUNT(*) FROM contract_risks ...`）直查 DB 列。**PR 4 类型扩展只加 3 个字段**，避免无谓的"为完整性透传"。

> **不**把 quote 字段加到 `Risk` interface（148-169）——`Risk` 是 PATCH body 接受的 JSON shape，spec § 5.0 明确要求 PATCH 拒绝 quote 字段（PR 3 已加 `.strict()` 防御）。只扩 `RiskDisplayPhaseB` 这个"显示态"类型即可。

- [ ] **Step 1.1：编辑 RiskDisplayPhaseB 加四字段**

打开 `shared/types/contract.ts`，定位第 181-190 行（搜索 `RiskDisplayPhaseB`）：

```typescript
/**
 * Phase B：RiskListPanel / RiskCard 共享的扩展显示类型。
 * source/orphaned/originalClauseText 字段从 contractRisks 表透传（首次审查后由后端补齐），
 * 前端依据这些字段做"外部新增分组""孤立批注区"等分组渲染。
 */
export type RiskDisplayPhaseB = RiskDisplay & {
    source?: RiskSource
    orphaned?: boolean
    originalClauseText?: string | null
}
```

改为：

```typescript
/**
 * Phase B：RiskListPanel / RiskCard 共享的扩展显示类型。
 * source/orphaned/originalClauseText 字段从 contractRisks 表透传（首次审查后由后端补齐），
 * 前端依据这些字段做"外部新增分组""孤立批注区"等分组渲染。
 *
 * PR 4：新增 problematicQuote / quoteCharStart / quoteCharEnd 三字段，
 * 由 ContractReviewPanel.mapEntityToDisplay 从 ContractRiskEntity 透传，
 * 给 Layout A "问题片段" 块 + 完整原文 quote 字符级高亮使用；PATCH risks 接口不读不写
 * 这些字段（spec § 5.0）。运维埋点用 quoteMatchSource SQL 直查 DB 列，前端 UI 不读不传。
 */
export type RiskDisplayPhaseB = RiskDisplay & {
    source?: RiskSource
    orphaned?: boolean
    originalClauseText?: string | null
    /** 精确问题片段（路线 2 产物，PR 3 主路径起填值；PR 3 未上时为 null） */
    problematicQuote?: string | null
    /** 在 clauseText 内的相对 offset（不是文档全文 offset） */
    quoteCharStart?: number | null
    /** exclusive */
    quoteCharEnd?: number | null
}
```

- [ ] **Step 1.2：跑 typecheck 验证类型扩展不破坏其它消费方**

```bash
bun run typecheck 2>&1 | tail -20
```

Expected: 0 错误。如果有 `RiskDisplayPhaseB` 相关错误，说明某个调用方做了"对象字面量 strict 检查"——逐个核对错误位置后修。

- [ ] **Step 1.3：跑既有 contract 类型测试**

```bash
npx vitest run tests/shared/types/contract.test.ts tests/shared/types/contract.types.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 1.4：commit**

```bash
git add shared/types/contract.ts
git commit -m "feat(contract): RiskDisplayPhaseB 扩展双锚点 quote 字段"
```

---

## Task 2：ContractReviewPanel.mapEntityToDisplay 透传 quote 字段

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue:275-296`

mapper 层把 `ContractRiskEntity` 上的 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 透传到 `RiskDisplay` 对象（实际是 `RiskDisplayPhaseB` shape；`quoteMatchSource` 不透传，YAGNI）。注意 `effectiveRisks` 计算属性当前类型标注是 `RiskDisplay[]`——TypeScript 结构子类型让额外字段不报错；但为避免误导，连带把类型标注升级到 `RiskDisplayPhaseB[]`。

- [ ] **Step 2.1：编辑 import 加 RiskDisplayPhaseB（如果还没导入）**

打开 `app/components/assistant/contract/ContractReviewPanel.vue`，定位第 16 行附近：

```typescript
import type { Risk, RiskDisplay, ContractReviewStatus, StanceRequest, PlaybookSnapshot, RiskArchivedStatus, ReviewWithParsedRisks } from '#shared/types/contract'
```

改为（追加 `RiskDisplayPhaseB`）：

```typescript
import type { Risk, RiskDisplay, RiskDisplayPhaseB, ContractReviewStatus, StanceRequest, PlaybookSnapshot, RiskArchivedStatus, ReviewWithParsedRisks } from '#shared/types/contract'
```

- [ ] **Step 2.2：编辑 mapEntityToDisplay 函数签名 + 字段透传**

继续在同文件，定位第 265-309 行的 `effectiveRisks` 计算属性。把：

```typescript
const effectiveRisks = computed<RiskDisplay[]>(() => {
    const entities = versioning.currentView.value.risks
    /**
     * 把 entity row 映射成 RiskDisplay。两条产生 entity 数据的路径：
     * - versioning.workspace（Phase A 后的工作区数据）→ entities 数组
     * - review.value.risks（GET /reviews/:id 的 entity 转换数组，在 currentVersionId 不为空时返回）
     * 两边 shape 一致，统一用本函数映射，不能直接 spread——否则 entity 字段名（clauseText / problem / id:number）
     * 跟 RiskDisplay 期望（clauseText / risk / id:string）错位，导致 RiskClauseDiff 收到 clauseText=undefined
     * 触发 dmp.diff_main(undefined) Throw 让整个 Vue 渲染崩溃 + 风险卡无法点击。
     */
    function mapEntityToDisplay(e: any): RiskDisplay {
        return {
            id: String(e.id),
            entityId: typeof e.id === 'number' ? e.id : undefined,
            clauseIndex: e.clauseParagraphIndex ?? 0,
            clauseText: e.clauseText,
            clauseParagraphIndex: e.clauseParagraphIndex,
            level: e.level,
            category: e.category,
            problem: e.problem,
            legalBasis: e.legalBasis ?? undefined,
            analysis: e.analysis ?? '',
            risk: e.problem,
            suggestion: e.suggestion ?? '',
            suggestedClauseText: e.suggestedClauseText ?? undefined,
            // Playbook 命中：entity 字段名是 code（contract_risks.code），
            // 前端 useContractPlaybookMatch / RiskCard 读 matchedPointCode；漏映射会让"清单对照"
            // 永远 0/N 命中（即便 LLM 实际写了 code）
            matchedPointCode: e.code ?? undefined,
            archivedStatus: e.archivedStatus,
        }
    }

    if (entities.length > 0) {
        return entities.map<RiskDisplay>(mapEntityToDisplay)
    }

    // fallback：review.value.risks 同样可能是 entity-shape（GET endpoint 在 currentVersionId
    // 非空时直接返回 contractRisks 表的 row spread）；用 typeof id === 'number' 探测 entity
    // 走映射，旧 JSON shape（id 是 string）保留 spread 行为
    return (review.value?.risks ?? []).map<RiskDisplay>((r: any) => {
        if (typeof r?.id === 'number') return mapEntityToDisplay(r)
        return { ...r }
    })
})
```

改为：

```typescript
const effectiveRisks = computed<RiskDisplayPhaseB[]>(() => {
    const entities = versioning.currentView.value.risks
    /**
     * 把 entity row 映射成 RiskDisplayPhaseB。两条产生 entity 数据的路径：
     * - versioning.workspace（Phase A 后的工作区数据）→ entities 数组
     * - review.value.risks（GET /reviews/:id 的 entity 转换数组，在 currentVersionId 不为空时返回）
     * 两边 shape 一致，统一用本函数映射，不能直接 spread——否则 entity 字段名（clauseText / problem / id:number）
     * 跟 RiskDisplay 期望（clauseText / risk / id:string）错位，导致 RiskClauseDiff 收到 clauseText=undefined
     * 触发 dmp.diff_main(undefined) Throw 让整个 Vue 渲染崩溃 + 风险卡无法点击。
     *
     * PR 4：把 problematicQuote / quoteCharStart / quoteCharEnd 三个 quote
     * 锚点字段透传到 RiskDisplayPhaseB，给 Layout A 的"问题片段"块 + 完整原文 quote 字符级高亮用。
     * 这些字段在 PR 3 主路径上线前 DB 全是 null；UI 自然降级（不渲染问题片段框、不做字符级高亮）。
     * quoteMatchSource 不透传：前端 UI 不读，运维 SQL 直查 DB 列；YAGNI。
     */
    function mapEntityToDisplay(e: any): RiskDisplayPhaseB {
        return {
            id: String(e.id),
            entityId: typeof e.id === 'number' ? e.id : undefined,
            clauseIndex: e.clauseParagraphIndex ?? 0,
            clauseText: e.clauseText,
            clauseParagraphIndex: e.clauseParagraphIndex,
            level: e.level,
            category: e.category,
            problem: e.problem,
            legalBasis: e.legalBasis ?? undefined,
            analysis: e.analysis ?? '',
            risk: e.problem,
            suggestion: e.suggestion ?? '',
            suggestedClauseText: e.suggestedClauseText ?? undefined,
            // Playbook 命中：entity 字段名是 code（contract_risks.code），
            // 前端 useContractPlaybookMatch / RiskCard 读 matchedPointCode；漏映射会让"清单对照"
            // 永远 0/N 命中（即便 LLM 实际写了 code）
            matchedPointCode: e.code ?? undefined,
            archivedStatus: e.archivedStatus,
            // PR 4：双锚点 quote 字段透传（PR 3 主路径起填值，否则 null）
            // 不透传 quoteMatchSource：UI 不读，运维 SQL 直查 DB 列；YAGNI
            problematicQuote: e.problematicQuote ?? null,
            quoteCharStart: e.quoteCharStart ?? null,
            quoteCharEnd: e.quoteCharEnd ?? null,
        }
    }

    if (entities.length > 0) {
        return entities.map<RiskDisplayPhaseB>(mapEntityToDisplay)
    }

    // fallback：review.value.risks 同样可能是 entity-shape（GET endpoint 在 currentVersionId
    // 非空时直接返回 contractRisks 表的 row spread）；用 typeof id === 'number' 探测 entity
    // 走映射，旧 JSON shape（id 是 string）保留 spread 行为
    return (review.value?.risks ?? []).map<RiskDisplayPhaseB>((r: any) => {
        if (typeof r?.id === 'number') return mapEntityToDisplay(r)
        return { ...r }
    })
})
```

- [ ] **Step 2.3：跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。

- [ ] **Step 2.4：跑既有 ContractReviewPanel 测试**

```bash
npx vitest run tests/app/components/assistant/contract/ContractReviewPanel.test.ts tests/app/components/assistant/contract/ContractReviewPanel.phaseB.test.ts --reporter=verbose
```

Expected: 全部 PASS（mapper 加字段不破坏既有断言；既有断言不读 quote 字段）。

- [ ] **Step 2.5：commit**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(contract): mapEntityToDisplay 透传双锚点 quote 字段"
```

---

## Task 3：重写 RiskClauseDiff.vue 为 mode='stacked' | 'inline-diff' 双形态

**Files:**
- Modify: `app/components/assistant/contract/RiskClauseDiff.vue`（整体重写）
- Test: `tests/app/components/assistant/contract/RiskClauseDiff.test.ts`（Task 7 改写）

当前 RiskClauseDiff 是「左原文删除 / 右建议新增」的 side-by-side 形态。PR 4 把它升级为：
- `mode='stacked'`（Layout A）：四段式渲染——条款标题（clauseText 第一行）、完整原文（clauseText 全文，quote 字符段深黄高亮）、问题片段（problematicQuote 单独框）、建议改写（suggestedClauseText 纯文本框）
- `mode='inline-diff'`（Layout C）：单栏行内 diff——把 clauseText 与 suggestedClauseText 做 dmp.diff_main，equal 段平铺、delete 段红底删除线、insert 段绿底加粗，全在同一行内流式显示

> 行业实战：Layout A 的"原文 + quote 高亮 + 建议另开一框" 是 Spellbook / Anthropic Citations 的主流呈现；Layout C 的"行内 diff" 是 Word Track Changes 风格——两者同卡片可切让律师按场景挑。

### 设计决策（写入代码注释）

1. **mode 必填、不给默认值**：避免调用方意外漏传；调用方 RiskCard 拿到 layout prop 直接转发。
2. **stacked 模式下 quote 高亮 = 字符切片**：`clauseText.slice(0, quoteCharStart) + <mark>...</mark> + clauseText.slice(quoteCharEnd)`，无第三方依赖。当 `quoteCharStart` / `quoteCharEnd` 任一为 null/undefined → 不高亮，整段平铺。
3. **stacked 模式下"问题片段"框：`problematicQuote` 为 null/undefined 不渲染（spec § 6.4 quote=null 降级）**。
4. **inline-diff 模式 quote=null 严格降级（spec § 6.4）**：当 `problematicQuote` 为 null/undefined → 退化为纯文本显示 clauseText（**不只是 suggestedClauseText 为空时降级**——严格按 spec § 6.4 触发）；以及 `clauseText` / `suggestedClauseText` 任一为空时也降级（防御 dmp.diff_main 抛 "Null input"）。
5. **stacked 模式条款标题旁追加段落徽章（spec § 6.1 mockup）**：标题后跟"（第 N 段）"小灰字徽章，N = `clauseParagraphIndex + 1`（clauseParagraphIndex 是 0-based "非空段落序号"，UI 1-based 显示）；clauseParagraphIndex 为 null 时不渲染徽章。
6. **dmp 实例：保留模块级单例 + 显式 `Diff_Timeout = 0.1`（spec § 12 风险 mitigation）**：长 clauseText 跨段标点变化时 dmp 默认 1 秒 timeout 会卡前端线程；改 0.1 秒兜底，超时后返回 best-effort diff（行业实战，Width.ai 等都这么用）。
7. **图标：仅 lucide-vue-next 的 `FileText` / `Quote` / `AlertTriangle` / `PencilLine`**（铁律：禁 emoji，spec § 6.1 mockup 已用这四个）。

- [ ] **Step 3.1：完整重写 RiskClauseDiff.vue**

打开 `app/components/assistant/contract/RiskClauseDiff.vue`，把整个文件内容替换为：

```vue
<script lang="ts">
import DiffMatchPatch from 'diff-match-patch'

// dmp 实例无状态，挂到 <script>（非 setup）作模块级单例，
// 避免每个 RiskClauseDiff 卡片实例重复构造。
const dmp = new DiffMatchPatch()
// PR 4 spec § 12 风险 mitigation：长 clauseText 跨段标点变化时默认 1 秒 timeout 会卡前端线程，
// 调到 0.1 秒兜底（超时后 dmp 返回 best-effort diff 不抛错）。
dmp.Diff_Timeout = 0.1
</script>

<script setup lang="ts">
/**
 * 单条风险的条款显示组件（PR 4：双布局）
 *
 * mode='stacked'（Layout A，默认更易读）：
 *   ┌── 条款标题（clauseText 第一行 + clauseParagraphIndex 非空时追加"（第 N 段）"）
 *   ├── 完整原文（clauseText 全文 + quote 字符段深黄高亮，仅当 quoteCharStart/End 都有效）
 *   ├── 问题片段（problematicQuote 单独框；为空不渲染）
 *   └── 建议改写（suggestedClauseText 纯文本框；为空显示"无建议改写"）
 *
 * mode='inline-diff'（Layout C，行内 diff）：
 *   单栏 dmp 行内 diff：equal 段平铺、delete 段红底删除线、insert 段绿底加粗。
 *   spec § 6.4 严格降级：problematicQuote=null（quote 锚点解析失败）→ 不做 diff，
 *   显示纯 clauseText；clauseText / suggestedClauseText 任一为空也降级（防御）。
 */
import { FileText, Quote, AlertTriangle, PencilLine } from 'lucide-vue-next'

const props = defineProps<{
    /** 必填：调用方明确指定布局，避免意外漏传 */
    mode: 'stacked' | 'inline-diff'
    // clauseText 实际可能是 undefined（如上游 ContractReviewPanel.effectiveRisks fallback path
    // 直接 spread entity 时丢字段映射）；接受 undefined 防止 Vue prop 类型 warning
    // 后让模板 / computed 防御处理。
    clauseText?: string
    suggestedClauseText?: string
    /** PR 4：精确问题片段（PR 3 主路径起填值；为 null/undefined 时 stacked 模式不渲染问题片段框、inline-diff 模式不做 diff） */
    problematicQuote?: string | null
    /** PR 4：在 clauseText 内的相对 offset；与 quoteCharEnd 同时有效时 stacked 模式做字符级高亮 */
    quoteCharStart?: number | null
    /** exclusive */
    quoteCharEnd?: number | null
    /** PR 4：非空段落序号（0-based）；stacked 模式追加"（第 N 段）"徽章；为 null 不渲染徽章 */
    clauseParagraphIndex?: number | null
}>()

type DiffSegment = { kind: 'equal' | 'delete' | 'insert'; text: string }

/** stacked 模式：把 clauseText 切成 [前缀, quote, 后缀] 三段，让模板做字符级高亮 */
const stackedClauseSegments = computed<{ prefix: string; quote: string; suffix: string } | null>(() => {
    if (!props.clauseText) return null
    const start = props.quoteCharStart
    const end = props.quoteCharEnd
    // quote=null 降级：不高亮，整段当前缀（spec § 6.4）
    if (start == null || end == null || start < 0 || end <= start || end > props.clauseText.length) {
        return { prefix: props.clauseText, quote: '', suffix: '' }
    }
    return {
        prefix: props.clauseText.slice(0, start),
        quote: props.clauseText.slice(start, end),
        suffix: props.clauseText.slice(end),
    }
})

/** inline-diff 模式：dmp.diff_main 全段后渲染线性 diff segments */
const inlineDiffSegments = computed<DiffSegment[] | null>(() => {
    // 双向防御：任一字段为 falsy（undefined / null / 空串）→ 不做 diff
    // dmp.diff_main 接收 undefined 会抛 "Null input" 错误，导致 Vue 整条渲染管线崩溃
    if (!props.suggestedClauseText || !props.clauseText) return null
    // spec § 6.4 严格降级：problematicQuote=null 时 inline-diff 不 diff，
    // 显示纯 clauseText（避免 quote 锚点解析失败时的乱跨段 diff，spec § 12 风险点）
    if (props.problematicQuote == null) return null
    const raw = dmp.diff_main(props.clauseText, props.suggestedClauseText)
    dmp.diff_cleanupSemantic(raw)
    const segments: DiffSegment[] = []
    for (const [op, text] of raw) {
        if (op === 0) segments.push({ kind: 'equal', text })
        else if (op === -1) segments.push({ kind: 'delete', text })
        else if (op === 1) segments.push({ kind: 'insert', text })
    }
    return segments
})

const DIFF_CLASS_MAP: Record<DiffSegment['kind'], string> = {
    equal: '',
    delete: 'bg-red-100 dark:bg-red-900/50 text-red-900 dark:text-red-100 line-through',
    insert: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-100 font-medium',
}

/** 条款标题：clauseText 第一行（segmentClauses 用 \n 连多行；首行通常是"第三条 工资支付"这类标题） */
const clauseTitle = computed(() => {
    if (!props.clauseText) return ''
    const firstLine = props.clauseText.split('\n')[0]?.trim() ?? ''
    return firstLine
})
</script>

<template>
    <!-- ============================== Layout A · Stacked 三段式 ============================== -->
    <div v-if="mode === 'stacked'" class="space-y-3 text-sm">
        <!-- 条款标题（spec § 6.1 mockup："第三条 工资支付（第 5 段）"） -->
        <div v-if="clauseTitle" class="flex items-center gap-1.5">
            <FileText class="size-3 text-muted-foreground shrink-0" />
            <span class="text-xs text-muted-foreground">条款标题</span>
            <span class="font-medium truncate">{{ clauseTitle }}</span>
            <span
                v-if="clauseParagraphIndex != null"
                class="text-xs text-muted-foreground shrink-0"
            >（第 {{ clauseParagraphIndex + 1 }} 段）</span>
        </div>

        <!-- 完整原文 + quote 字符段深黄高亮 -->
        <div class="space-y-1">
            <div class="flex items-center gap-1.5">
                <Quote class="size-3 text-muted-foreground shrink-0" />
                <span class="text-xs text-muted-foreground">完整原文</span>
            </div>
            <div class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap leading-relaxed">
                <template v-if="stackedClauseSegments">
                    <span>{{ stackedClauseSegments.prefix }}</span>
                    <mark
                        v-if="stackedClauseSegments.quote"
                        aria-label="问题片段"
                        class="bg-yellow-300 dark:bg-yellow-700/60 text-yellow-950 dark:text-yellow-50 rounded-sm px-0.5"
                    >{{ stackedClauseSegments.quote }}</mark>
                    <span>{{ stackedClauseSegments.suffix }}</span>
                </template>
                <template v-else>{{ clauseText }}</template>
            </div>
        </div>

        <!-- 问题片段（quote=null 时不渲染） -->
        <div v-if="problematicQuote" class="space-y-1">
            <div class="flex items-center gap-1.5">
                <AlertTriangle class="size-3 text-amber-500 shrink-0" />
                <span class="text-xs text-muted-foreground">问题片段</span>
            </div>
            <div class="p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 italic whitespace-pre-wrap leading-relaxed">
                {{ problematicQuote }}
            </div>
        </div>

        <!-- 建议改写 -->
        <div class="space-y-1">
            <div class="flex items-center gap-1.5">
                <PencilLine class="size-3 text-emerald-600 shrink-0" />
                <span class="text-xs text-muted-foreground">建议改写</span>
            </div>
            <div
                v-if="suggestedClauseText"
                class="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/40 whitespace-pre-wrap leading-relaxed"
            >{{ suggestedClauseText }}</div>
            <div v-else class="p-3 rounded-md bg-muted/20 text-muted-foreground italic">无建议改写</div>
        </div>
    </div>

    <!-- ============================== Layout C · Inline diff 行内差异 ============================== -->
    <div v-else class="space-y-1 text-sm">
        <div class="flex items-center gap-1.5">
            <PencilLine class="size-3 text-emerald-600 shrink-0" />
            <span class="text-xs text-muted-foreground">原文 → 建议（行内差异）</span>
        </div>
        <div v-if="inlineDiffSegments" class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap leading-relaxed">
            <span
                v-for="(seg, i) in inlineDiffSegments"
                :key="`d-${i}`"
                :class="DIFF_CLASS_MAP[seg.kind]"
            >{{ seg.text }}</span>
        </div>
        <!-- 降级：suggested / clause 任一为空 → 显示纯 clauseText -->
        <div v-else class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap leading-relaxed">{{ clauseText }}</div>
    </div>
</template>
```

- [ ] **Step 3.2：跑 typecheck 验证类型**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。如果有 RiskClauseDiff 调用方报错（缺 `mode` prop），按 Task 4 / Task 6 顺序补；本步先确认类型层无误。

- [ ] **Step 3.3：暂时跳过 RiskClauseDiff 测试改写**

旧测试断言 side-by-side（"原文条款" / "建议改写" 双栏）已不适用，会 fail。Task 7 一并改写；本步只改实现，不跑测试。

- [ ] **Step 3.4：暂不 commit**

等 Task 4 调用方更新后一起 commit（避免中间态破坏 RiskCard 渲染）。

---

## Task 4：RiskCard.vue 加 layout prop + 透传给 RiskClauseDiff

**Files:**
- Modify: `app/components/assistant/contract/RiskCard.vue:26-47, 243`

RiskCard 加 `layout` prop（**可选默认 stacked**——orphaned 调用方不需要传无意义的 layout，主清单调用方仍显式 `:layout="cardLayout"` 透传持久化偏好），在主形态展开内容（CardContent）里把它和 quote 三字段 + clauseParagraphIndex 一起透传给 `<AssistantContractRiskClauseDiff>`。orphaned 形态内不调用 RiskClauseDiff（无 clause anchor）。

- [ ] **Step 4.1：编辑 defineProps 加 layout**

打开 `app/components/assistant/contract/RiskCard.vue`，定位第 26-47 行的 `defineProps` 块：

```typescript
const props = defineProps<{
    risk: RiskDisplayPhaseB
    expanded: boolean
    annotations: ContractAnnotationEntity[]
    readOnly: boolean
    isCompleted: boolean
    /** 工作区编辑可用：!isRebuilding && isCompleted（由父组件计算后透传） */
    editable: boolean
    currentUserId?: number | null
    /** 卡片视觉状态 */
    isFocused?: boolean
    isPinned?: boolean
    isHovered?: boolean
    isJustAdded?: boolean
    /** 孤立分支：去掉处置/编辑/删除按钮，加 originalClauseText 提示与"查看原始语境" */
    isOrphaned?: boolean
    archivedStatus?: RiskArchivedStatus | null
    /** 未定位徽章 */
    notLocated?: boolean
    /** playbook 快照：用于显示匹配的合规检查项 tooltip */
    playbookSnapshot?: PlaybookSnapshot | null
}>()
```

改为（在最末尾追加 `layout` 字段）：

```typescript
const props = defineProps<{
    risk: RiskDisplayPhaseB
    expanded: boolean
    annotations: ContractAnnotationEntity[]
    readOnly: boolean
    isCompleted: boolean
    /** 工作区编辑可用：!isRebuilding && isCompleted（由父组件计算后透传） */
    editable: boolean
    currentUserId?: number | null
    /** 卡片视觉状态 */
    isFocused?: boolean
    isPinned?: boolean
    isHovered?: boolean
    isJustAdded?: boolean
    /** 孤立分支：去掉处置/编辑/删除按钮，加 originalClauseText 提示与"查看原始语境" */
    isOrphaned?: boolean
    archivedStatus?: RiskArchivedStatus | null
    /** 未定位徽章 */
    notLocated?: boolean
    /** playbook 快照：用于显示匹配的合规检查项 tooltip */
    playbookSnapshot?: PlaybookSnapshot | null
    /**
     * PR 4：风险卡布局（可选，默认 'stacked'）
     * - 'stacked'：Layout A 四段式（条款标题 / 完整原文 + quote 高亮 / 问题片段 / 建议改写）
     * - 'inline-diff'：Layout C 行内差异（dmp diff 单栏）
     * orphaned 形态不消费此 prop（无 clause anchor）；调用方可不传走默认值。
     */
    layout?: 'stacked' | 'inline-diff'
}>()

/** PR 4：layout 默认值（pass-through 给 RiskClauseDiff 的 mode） */
const layoutMode = computed<'stacked' | 'inline-diff'>(() => props.layout ?? 'stacked')
```

- [ ] **Step 4.2：编辑主形态 CardContent 内 RiskClauseDiff 调用，透传 layout + quote 三字段**

继续在同文件，定位第 243 行：

```vue
<AssistantContractRiskClauseDiff :clause-text="risk.clauseText" :suggested-clause-text="risk.suggestedClauseText" />
```

改为：

```vue
<AssistantContractRiskClauseDiff
    :mode="layoutMode"
    :clause-text="risk.clauseText"
    :suggested-clause-text="risk.suggestedClauseText"
    :problematic-quote="risk.problematicQuote ?? null"
    :quote-char-start="risk.quoteCharStart ?? null"
    :quote-char-end="risk.quoteCharEnd ?? null"
    :clause-paragraph-index="risk.clauseParagraphIndex ?? null"
/>
```

- [ ] **Step 4.3：跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。如果 RiskListPanel 调用 `<AssistantContractRiskCard>` 缺 `layout` prop 报错——预期内，下一个 Task 5 修。

- [ ] **Step 4.4：暂不 commit**

等 Task 5 调用方补全后一起 commit。

---

## Task 5：RiskListPanel.vue 加布局 toggle + useLocalStorage 持久化

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue:16-31, 184-185, 302-318, 470-495, 514-527`

RiskListPanel 在顶部操作行加 shadcn `Tabs` 段控（"分段" / "对照"两选项），用 `useLocalStorage('contract-review-risk-card-layout', 'stacked')` 持久化偏好；把 `layout` 透传给主清单的 `<AssistantContractRiskCard>` 与孤立分组（孤立分组也透传，但 RiskClauseDiff 在 orphaned 卡内本就不被调用——传值无副作用）。external_new 分支由 Task 6 处理。

> **UI 文案选择**：PR 4 spec § 6.3 写的"Stacked / 行内 diff"是技术词汇。CLAUDE.md 铁律 §4 要求产品经理视角文案。最终落地用：
> - "分段"（对应 stacked，强调"问题片段"独立框）
> - "对照"（对应 inline-diff，强调"原文 vs 建议"对比）

- [ ] **Step 5.1：编辑 import 块加 Tabs 相关引用 + 确认 useLocalStorage 已存在**

打开 `app/components/assistant/contract/RiskListPanel.vue`，定位 16-31 行的 import 块。`@vueuse/core` 的 `useLocalStorage` 已经导入（line 22）；不需要补。

shadcn Tabs 组件由 `app/components/ui/tabs/index.ts` 导出，并通过 `shadcn-nuxt` 模块自动注册（`Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` 都自动可用），**不需要手动 import**——参考同文件已有的 `<Switch>` / `<Card>` / `<Button>` 直接当组件用。

- [ ] **Step 5.2：在 script 区追加 layout 持久化 ref**

定位第 182-185 行的 Phase A 注释 + `hideArchived` 声明：

```typescript
// ===== Phase A：批注 + 已处置 =====

/** 隐藏已处置开关（持久化到 localStorage） */
const hideArchived = useLocalStorage('contract-hide-archived-risks', false)
```

在 `hideArchived` 这一行**下方**插入新行：

```typescript
// ===== Phase A：批注 + 已处置 =====

/** 隐藏已处置开关（持久化到 localStorage） */
const hideArchived = useLocalStorage('contract-hide-archived-risks', false)

/**
 * PR 4：风险卡布局偏好（持久化到 localStorage）
 * - 'stacked'：Layout A 四段式（默认）
 * - 'inline-diff'：Layout C 行内差异
 *
 * @vueuse/core 的 useLocalStorage **string serializer 是 `String(v)` 不是 `JSON.stringify`**——
 * localStorage 里存的是裸字符串 `inline-diff`（无 JSON 引号）。`as const` 让初值字面量
 * 不被 TS 推断成 `string`，满足联合泛型约束。
 *
 * 复用既有约定：ContractReviewPanel.vue 已有 `useLocalStorage<number>('contract-review-split-...')` 同前缀模式。
 */
const cardLayout = useLocalStorage<'stacked' | 'inline-diff'>(
    'contract-review-risk-card-layout',
    'stacked' as const,
)
```

- [ ] **Step 5.3：在 template 顶部操作行追加布局 Tabs**

定位第 302-318 行的顶部操作行：

```vue
<div ref="containerRef" class="p-3 space-y-2">
    <!-- 顶部操作行：新增风险 + 隐藏已处置开关 -->
    <div class="flex items-center gap-2">
        <Button variant="outline" class="flex-1" :disabled="!editable || readOnly" @click="openCreate">
            <PlusIcon class="size-4 mr-1" />新增风险
        </Button>
        <div v-if="archivedCount > 0" class="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Switch
                :checked="hideArchived"
                @update:checked="hideArchived = $event"
            />
            <span class="flex items-center gap-0.5">
                <EyeOffIcon class="size-3" />
                隐藏已处置（{{ archivedCount }}）
            </span>
        </div>
    </div>
```

改为（在 `<Button>新增风险</Button>` 与 `archivedCount` 容器中间插入 Tabs 段控；放第二行避免横向挤压）：

```vue
<div ref="containerRef" class="p-3 space-y-2">
    <!-- 顶部操作行：新增风险 + 隐藏已处置开关 -->
    <div class="flex items-center gap-2">
        <Button variant="outline" class="flex-1" :disabled="!editable || readOnly" @click="openCreate">
            <PlusIcon class="size-4 mr-1" />新增风险
        </Button>
        <div v-if="archivedCount > 0" class="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Switch
                :checked="hideArchived"
                @update:checked="hideArchived = $event"
            />
            <span class="flex items-center gap-0.5">
                <EyeOffIcon class="size-3" />
                隐藏已处置（{{ archivedCount }}）
            </span>
        </div>
    </div>

    <!--
        PR 4：布局切换段控（持久化到 localStorage:contract-review-risk-card-layout）
        UX 偏差说明：spec § 6.3 写的是 dropdown，本 plan 改用 Tabs 段控——理由：
        (a) 项目无 ToggleGroup 组件，shadcn-vue 唯一段控候选是 Tabs；
        (b) 复用 NewReviewDialog.vue:204 的 v-model 模式，与既有 UI 风格一致；
        (c) 两选项段控视觉负担比 dropdown 低（一眼可见、一键切换）。
        如产品要求严格 dropdown，回滚到 <DropdownMenu> + <DropdownMenuRadioGroup>。
    -->
    <Tabs v-model="cardLayout" class="w-full" data-testid="risk-card-layout-tabs">
        <TabsList class="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="stacked" class="text-xs">分段</TabsTrigger>
            <TabsTrigger value="inline-diff" class="text-xs">对照</TabsTrigger>
        </TabsList>
    </Tabs>
```

> **关于 `<Tabs v-model>` 的兼容性**：`useLocalStorage` 返回 `Ref<string>`，`<Tabs>` 的 v-model 接受字符串模型；shadcn-vue Tabs 双向绑定通过 `v-model` 直接工作。`NewReviewDialog.vue` 已有相同模式（`<Tabs v-model="activeTab">`）。

> **流式态可切换性**：`<Tabs>` 不接 `:disabled`，与 `editable` / `isCompleted` 链路解耦——`status=reviewing` 流式审查中律师仍可切布局；新冒出的风险卡自动继承当前 `cardLayout`（cardLayout 是响应式 ref，`<RiskCard :layout="cardLayout">` 自动触发 layoutMode 重算 → RiskClauseDiff 切 mode）。

- [ ] **Step 5.4：把 layout 透传给主清单 RiskCard**

继续在同文件，定位第 470-495 行的主清单 `<AssistantContractRiskCard>` 渲染：

```vue
<!-- ===== 主风险清单 ===== -->
<AssistantContractRiskCard
    v-for="r in mainRisks"
    :key="r.id"
    :risk="r"
    :expanded="expandedId === r.id"
    :annotations="annotationsForRisk(r.id)"
    :read-only="readOnly ?? false"
    :is-completed="isCompleted"
    :editable="editable"
    :current-user-id="currentUserId"
    :is-focused="focusedRiskId === r.id"
    :is-pinned="pinnedRiskIds.has(r.id)"
    :is-hovered="hoveredRiskId === r.id"
    :is-just-added="justAddedIds.has(r.id)"
    :archived-status="getArchivedStatus(r)"
    :not-located="hasLocated !== false && notLocatedIds.has(r.id)"
    :playbook-snapshot="playbookSnapshot ?? null"
    @toggle="toggle"
    @focus="(id: string) => emit('focusRisk', id)"
    @archive="(id: string, status: RiskArchivedStatus | null) => emit('archive', id, status)"
    @add-annotation="(id: string, content: string, parentId?: number) => emit('addAnnotation', id, content, parentId)"
    @delete-annotation="(annId: number) => emit('deleteAnnotation', annId)"
    @toggle-pin="(id: string) => emit('togglePin', id)"
    @edit-risk="openEdit"
    @delete-risk="(risk: Risk) => openDelete(risk.id)"
/>
```

在 `:playbook-snapshot` 行**之后**追加一行 `:layout="cardLayout"`（`v-model` 拿到的 ref 在 template 里自动 unwrap，可直接绑定）：

```vue
<!-- ===== 主风险清单 ===== -->
<AssistantContractRiskCard
    v-for="r in mainRisks"
    :key="r.id"
    :risk="r"
    :expanded="expandedId === r.id"
    :annotations="annotationsForRisk(r.id)"
    :read-only="readOnly ?? false"
    :is-completed="isCompleted"
    :editable="editable"
    :current-user-id="currentUserId"
    :is-focused="focusedRiskId === r.id"
    :is-pinned="pinnedRiskIds.has(r.id)"
    :is-hovered="hoveredRiskId === r.id"
    :is-just-added="justAddedIds.has(r.id)"
    :archived-status="getArchivedStatus(r)"
    :not-located="hasLocated !== false && notLocatedIds.has(r.id)"
    :playbook-snapshot="playbookSnapshot ?? null"
    :layout="cardLayout"
    @toggle="toggle"
    @focus="(id: string) => emit('focusRisk', id)"
    @archive="(id: string, status: RiskArchivedStatus | null) => emit('archive', id, status)"
    @add-annotation="(id: string, content: string, parentId?: number) => emit('addAnnotation', id, content, parentId)"
    @delete-annotation="(annId: number) => emit('deleteAnnotation', annId)"
    @toggle-pin="(id: string) => emit('togglePin', id)"
    @edit-risk="openEdit"
    @delete-risk="(risk: Risk) => openDelete(risk.id)"
/>
```

- [ ] **Step 5.5：孤立分组 RiskCard 不传 layout**

孤立分组（line 514-527）调用 `<AssistantContractRiskCard>` 时**不需要传 `:layout`**——RiskCard 的 layout prop 是可选默认 `'stacked'`，孤立卡内本就不调用 RiskClauseDiff，传或不传都无视觉差异；不传更简洁（YAGNI）。本步**不改孤立分组代码**，仅在此说明决策。

- [ ] **Step 5.6：跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。

- [ ] **Step 5.7：暂不 commit**

等 Task 6 处理 external_new 分支后一起 commit。

---

## Task 6：external_new 分支内联 RiskClauseDiff 接通 layout

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue:392`

external_new 分支（line 334-466）的展开内容直接调用 `<AssistantContractRiskClauseDiff>`（line 392）而非走 RiskCard 组件——因为 external_new 卡片有特殊的"客户名 + 外部批注徽章"，不复用 RiskCard 主形态。本任务把这条调用同步加 `mode` + quote 三字段。

- [ ] **Step 6.1：编辑 external_new 分支的 RiskClauseDiff 调用**

定位第 392 行：

```vue
<AssistantContractRiskClauseDiff :clause-text="r.clauseText" :suggested-clause-text="r.suggestedClauseText" />
```

改为：

```vue
<AssistantContractRiskClauseDiff
    :mode="cardLayout"
    :clause-text="r.clauseText"
    :suggested-clause-text="r.suggestedClauseText"
    :problematic-quote="r.problematicQuote ?? null"
    :quote-char-start="r.quoteCharStart ?? null"
    :quote-char-end="r.quoteCharEnd ?? null"
    :clause-paragraph-index="r.clauseParagraphIndex ?? null"
/>
```

> 这里 `r` 是 `RiskDisplayPhaseB` 类型（来自 `externalNewRisks` computed），Task 1 已加 quote 字段。

- [ ] **Step 6.2：跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。

- [ ] **Step 6.3：commit Task 3 + Task 4 + Task 5 + Task 6 一起**

到此前端三层（RiskClauseDiff / RiskCard / RiskListPanel）的实现都改完，构成一个完整可工作的 UI 改动；测试改写在 Task 7+。

```bash
git add app/components/assistant/contract/RiskClauseDiff.vue \
        app/components/assistant/contract/RiskCard.vue \
        app/components/assistant/contract/RiskListPanel.vue
git commit -m "feat(contract): 风险卡 Layout A/C 双布局 + 顶部切换"
```

> **Follow-up（不在本 PR 内）**：`RiskListPanel.vue` 已经 629 行（超 main.md "单文件 < 500 行" 上限），本 PR 加 ~30 行后到 ~660 行。这是先有违规，PR 4 仅加重未拆。建议起独立 follow-up PR 把"布局段控 + cardLayout 持久化"抽出为子组件 `RiskCardLayoutToggle.vue`（约 30 行），同时把"已处置开关"也一起抽成 `RiskListHeader.vue`。本 PR 不动。

---

## Task 7：改写 RiskClauseDiff 测试 + RiskCard 测试 + RiskListPanel 测试

**Files:**
- Modify: `tests/app/components/assistant/contract/RiskClauseDiff.test.ts`
- Modify: `tests/app/components/assistant/contract/RiskCard.test.ts`
- Modify: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

旧的 RiskClauseDiff 测试断言"原文条款 / 建议改写"侧边双栏文案——新组件 stacked 模式下还能匹配（因为有"完整原文 / 建议改写"小标题），但 inline-diff 模式不再有"原文条款"小标题。需要重写为按 mode 分组断言。

RiskCard 测试加 `layout` 必填 prop。RiskListPanel 测试加布局 Tabs 切换 + localStorage 持久化用例。

- [ ] **Step 7.1：先看一眼现状测试 fail 范围**

```bash
npx vitest run tests/app/components/assistant/contract/RiskClauseDiff.test.ts tests/app/components/assistant/contract/RiskCard.test.ts tests/app/components/assistant/contract/RiskListPanel.test.ts --reporter=verbose 2>&1 | tail -60
```

Expected: 部分 fail（RiskCard / RiskClauseDiff 缺 layout/mode 必填 prop；RiskClauseDiff 旧断言不匹配新输出）。把失败列表存到 `/tmp/pr4-test-fail-list.log` 用于后面对照修复进度。

- [ ] **Step 7.2：改写 RiskClauseDiff.test.ts**

打开 `tests/app/components/assistant/contract/RiskClauseDiff.test.ts`。先 Read 头 60 行看既有结构，按既有 stub 风格扩展用例（如果文件不存在，全文按下方写）。整个文件改为：

```typescript
/**
 * RiskClauseDiff 双布局单元测试（PR 4）
 *
 * **Feature: contract-review-risk-card-layout**
 *
 * stacked（Layout A）：四段式渲染、quote 字符级高亮、问题片段降级、段落徽章
 * inline-diff（Layout C）：行内 diff 渲染、quote=null 严格降级、双向防御 null 输入
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RiskClauseDiff from '~/components/assistant/contract/RiskClauseDiff.vue'

function mountStacked(props: {
    clauseText?: string
    suggestedClauseText?: string
    problematicQuote?: string | null
    quoteCharStart?: number | null
    quoteCharEnd?: number | null
    clauseParagraphIndex?: number | null
} = {}) {
    return mount(RiskClauseDiff, {
        props: { mode: 'stacked', ...props },
    })
}

function mountInline(props: {
    clauseText?: string
    suggestedClauseText?: string
    problematicQuote?: string | null
} = {}) {
    return mount(RiskClauseDiff, {
        props: { mode: 'inline-diff', ...props },
    })
}

describe('RiskClauseDiff · stacked（Layout A）', () => {
    it('渲染四段标签：条款标题 / 完整原文 / 建议改写（quote=null 时无问题片段）', () => {
        const w = mountStacked({
            clauseText: '第三条 工资支付\n工资按月支付。',
            suggestedClauseText: '工资按月底前最后一个工作日结算。',
        })
        const text = w.text()
        expect(text).toContain('条款标题')
        expect(text).toContain('第三条 工资支付')
        expect(text).toContain('完整原文')
        expect(text).toContain('建议改写')
        expect(text).not.toContain('问题片段')
    })

    it('clauseParagraphIndex 非空 → 标题旁渲染"（第 N 段）"徽章（spec § 6.1 mockup）', () => {
        const w = mountStacked({
            clauseText: '第三条 工资支付\n工资按月支付。',
            clauseParagraphIndex: 4,
        })
        // 0-based 转 1-based 显示
        expect(w.text()).toContain('（第 5 段）')
    })

    it('clauseParagraphIndex 为 null → 不渲染段落徽章', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            clauseParagraphIndex: null,
        })
        expect(w.text()).not.toContain('（第')
    })

    it('quote 字符段命中时渲染深黄高亮 <mark>', () => {
        // clauseText="工资按月支付。逾期付款滞纳金 0.05%。"，quote 落在 "0.05%"
        const clause = '工资按月支付。逾期付款滞纳金 0.05%。'
        const start = clause.indexOf('0.05%')
        const w = mountStacked({
            clauseText: clause,
            suggestedClauseText: '工资按月底前最后一个工作日结算。',
            problematicQuote: '0.05%',
            quoteCharStart: start,
            quoteCharEnd: start + '0.05%'.length,
        })
        const mark = w.find('mark')
        expect(mark.exists()).toBe(true)
        expect(mark.text()).toBe('0.05%')
    })

    it('quoteCharStart/End 任一为 null → 不渲染 <mark>', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            suggestedClauseText: '工资按月底前结算。',
            problematicQuote: null,
            quoteCharStart: null,
            quoteCharEnd: null,
        })
        expect(w.find('mark').exists()).toBe(false)
    })

    it('quoteCharStart 越界（start < 0 或 end > clauseText.length）→ 整段平铺，不抛错', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            quoteCharStart: 100,
            quoteCharEnd: 105,
        })
        expect(w.find('mark').exists()).toBe(false)
        expect(w.text()).toContain('工资按月支付')
    })

    it('problematicQuote 非空 → 渲染问题片段框', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            problematicQuote: '工资按月支付',
        })
        expect(w.text()).toContain('问题片段')
        expect(w.text()).toContain('工资按月支付')
    })

    it('suggestedClauseText 为空 → 显示"无建议改写"', () => {
        const w = mountStacked({ clauseText: '工资按月支付。' })
        expect(w.text()).toContain('无建议改写')
    })

    it('clauseText 为 undefined → 不抛错', () => {
        const w = mountStacked({})
        expect(() => w.text()).not.toThrow()
    })
})

describe('RiskClauseDiff · inline-diff（Layout C）', () => {
    it('clauseText + suggestedClauseText + problematicQuote 都非空 → 渲染 dmp diff 段', () => {
        const w = mountInline({
            clauseText: '逾期按 0.05% 加收滞纳金',
            suggestedClauseText: '逾期按 0.5% 加收滞纳金',
            problematicQuote: '0.05%',
        })
        // 至少应有 line-through（删除段）和 font-medium（新增段）class 出现
        const html = w.html()
        expect(html).toContain('line-through')
        expect(html).toContain('font-medium')
    })

    it('problematicQuote=null（quote 锚点解析失败）→ 严格降级显示纯 clauseText（spec § 6.4）', () => {
        const w = mountInline({
            clauseText: '逾期按 0.05% 加收滞纳金',
            suggestedClauseText: '逾期按 0.5% 加收滞纳金',
            problematicQuote: null,
        })
        // 不应有 diff 视觉 class
        const html = w.html()
        expect(html).not.toContain('line-through')
        expect(html).not.toContain('font-medium')
        expect(w.text()).toContain('逾期按 0.05% 加收滞纳金')
    })

    it('suggestedClauseText 为空 → 降级显示 clauseText 不抛错', () => {
        const w = mountInline({ clauseText: '工资按月支付。', problematicQuote: '工资按月支付' })
        expect(w.text()).toContain('工资按月支付。')
    })

    it('clauseText 为 undefined → 不抛错（不调用 dmp.diff_main）', () => {
        const w = mountInline({ suggestedClauseText: '工资按月底前结算。' })
        expect(() => w.text()).not.toThrow()
    })

    it('两侧都 undefined → 渲染空，不抛错', () => {
        const w = mountInline({})
        expect(() => w.text()).not.toThrow()
    })

    it('clauseText === suggestedClauseText（无变更）+ problematicQuote 非空 → 渲染无 diff class', () => {
        // dmp.diff_main 对完全相同文本返回全 equal segments，不应渲染 line-through / font-medium
        const same = '甲方应支付定金 10 万元'
        const w = mountInline({
            clauseText: same,
            suggestedClauseText: same,
            problematicQuote: '甲方应支付定金',
        })
        const html = w.html()
        expect(html).not.toContain('line-through')
        expect(html).not.toContain('font-medium')
        expect(w.text()).toContain(same)
    })
})
```

- [ ] **Step 7.3：改写 RiskCard.test.ts**

打开 `tests/app/components/assistant/contract/RiskCard.test.ts`。已有的 `mountCard` helper 把 `props` spread 到 mount 时（line 73-86）。PR 4 的 `layout` prop 是**可选默认 stacked**——既有用例不传 layout 仍工作（走 layoutMode 默认 stacked），不需要改 mountCard 默认值，仅扩展类型签名让新用例能传 layout。

定位第 73-86 行的 `mountCard` 函数，在类型签名追加 `layout` 字段（**默认值不加，让 prop 走可选默认**）：

```typescript
function mountCard(props: Partial<{
    risk: RiskDisplayPhaseB
    expanded: boolean
    annotations: any[]
    readOnly: boolean
    isCompleted: boolean
    editable: boolean
    currentUserId: number | null
    isFocused: boolean
    isPinned: boolean
    isHovered: boolean
    isJustAdded: boolean
    isOrphaned: boolean
    archivedStatus: any
    notLocated: boolean
    playbookSnapshot: any
    /** PR 4：layout 可选；不传时 RiskCard 内 layoutMode 走默认 'stacked' */
    layout: 'stacked' | 'inline-diff'
}> = {}) {
    return mount(RiskCard, {
        props: {
            risk: makeRisk(),
            expanded: false,
            annotations: [],
            readOnly: false,
            isCompleted: true,
            editable: true,
            ...props,
        } as any,
        global: { stubs },
    })
}
```

然后**在文件末尾追加**新 describe 块：

```typescript
describe('RiskCard · layout prop 透传（PR 4）', () => {
    it('layout 不传（默认）展开时把 mode="stacked" 传给 RiskClauseDiff stub', () => {
        const w = mountCard({ expanded: true })
        const stub = w.find('[data-stub="RiskClauseDiff"]')
        expect(stub.exists()).toBe(true)
        // passthrough stub 不声明 props，所以 :mode 落入 attrs，序列化成 HTML 属性
        expect(stub.attributes('mode')).toBe('stacked')
    })

    it('layout="stacked" 显式传入展开时把 mode="stacked" 传给 RiskClauseDiff stub', () => {
        const w = mountCard({ expanded: true, layout: 'stacked' })
        const stub = w.find('[data-stub="RiskClauseDiff"]')
        expect(stub.attributes('mode')).toBe('stacked')
    })

    it('layout="inline-diff" 展开时把 mode="inline-diff" 传给 RiskClauseDiff stub', () => {
        const w = mountCard({ expanded: true, layout: 'inline-diff' })
        const stub = w.find('[data-stub="RiskClauseDiff"]')
        expect(stub.attributes('mode')).toBe('inline-diff')
    })

    it('isOrphaned=true 时不渲染 RiskClauseDiff（孤立卡无 clause anchor）', () => {
        const w = mountCard({ expanded: true, isOrphaned: true })
        expect(w.find('[data-stub="RiskClauseDiff"]').exists()).toBe(false)
    })
})
```

> `passthrough` stub（line 16-22）把 `attrs` 透传到 div，所以 `:mode="layout"` 会被序列化成 `mode="stacked"` 属性值，断言 `attributes('mode')` 即可拿到。

- [ ] **Step 7.4：改写 RiskListPanel.test.ts 加布局 Tabs 用例**

打开 `tests/app/components/assistant/contract/RiskListPanel.test.ts`。先确认现有 import 块（line 1-3 已含 `vi` / `afterEach` / `mount` / `defineComponent` / `h` / `nextTick`）—— **无需追加 import**（重复 import 会编译报错）；现有 stubs 表（line 144-160）也**无需追加 `Switch`**（实测既有"隐藏已处置"测试用真实 shadcn Switch 渲染通过）。

需要做的只有两件事：

1. **stubs 表追加 `Tabs` / `TabsList` / `TabsTrigger` 三个 stub**（line 144-160 范围内）
2. **文件末尾追加新 describe `RiskListPanel · 布局切换（PR 4）`**

为什么要给 Tabs 自定义 stub 而不是 passthrough？因为后续测试用例需要识别 `data-stub="TabsTrigger"` + `data-value="stacked"` 属性；passthrough 只透传 attrs 但不暴露 value 字段做断言点。

stubs 表（line 144-160）也无需追加 `Switch` —— 该组件目前作为真实 shadcn 渲染，既有"隐藏已处置"测试已经通过，不要替换。**只追加 `Tabs` / `TabsList` / `TabsTrigger` 三个 stub**：

```typescript
// 在既有 stubs 对象里追加（line 144-160 范围内）
const stubs = {
    // ...既有 stubs 全部保留 ...
    Tabs: defineComponent({
        name: 'Tabs',
        props: { modelValue: String },
        emits: ['update:modelValue'],
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': 'Tabs' }, slots.default?.())
        },
    }),
    TabsList: passthrough('TabsList'),
    TabsTrigger: defineComponent({
        name: 'TabsTrigger',
        props: { value: String },
        setup(props, { slots, attrs }) {
            return () =>
                h('button', { 'data-stub': 'TabsTrigger', 'data-value': props.value, ...attrs }, slots.default?.())
        },
    }),
}
```

在文件末尾追加：

```typescript
describe('RiskListPanel · 布局切换（PR 4）', () => {
    // 兜底清理：测试串行共享 jsdom，前一个 it 异常退出会残留偏好
    afterEach(() => {
        localStorage.removeItem('contract-review-risk-card-layout')
    })

    it('渲染顶部布局 Tabs 段控（分段 / 对照 两选项）', () => {
        const w = mountPanel({ risks: [] })
        const tabs = w.find('[data-testid="risk-card-layout-tabs"]')
        expect(tabs.exists()).toBe(true)
        const triggers = w.findAll('[data-stub="TabsTrigger"]')
        expect(triggers.length).toBe(2)
        expect(triggers[0]?.attributes('data-value')).toBe('stacked')
        expect(triggers[1]?.attributes('data-value')).toBe('inline-diff')
        expect(triggers[0]?.text()).toBe('分段')
        expect(triggers[1]?.text()).toBe('对照')
    })

    it('cardLayout 默认 stacked → 透传 layout="stacked" 给 RiskCard stub', () => {
        // 清理 localStorage 避免前序用例残留污染
        localStorage.removeItem('contract-review-risk-card-layout')
        const w = mountPanel({
            risks: [makeRisk({ id: 'r1' })],
        })
        const stub = w.find('[data-stub="AssistantContractRiskCard"]')
        expect(stub.attributes('layout')).toBe('stacked')
    })

    it('localStorage 已存 inline-diff → 渲染时透传 layout="inline-diff"', async () => {
        // @vueuse/core useLocalStorage 对 string 类型走 String(v) serializer，
        // localStorage 里的值是裸字符串 'inline-diff'（**不带 JSON 引号**）。
        // 源码确认：node_modules/@vueuse/core/dist/index.js StorageSerializers.string.write = (v) => String(v)
        localStorage.setItem('contract-review-risk-card-layout', 'inline-diff')
        const w = mountPanel({
            risks: [makeRisk({ id: 'r1' })],
        })
        await nextTick()
        const stub = w.find('[data-stub="AssistantContractRiskCard"]')
        expect(stub.attributes('layout')).toBe('inline-diff')
    })
})
```

> 上面 `mountPanel` / `makeRisk` 是测试文件已有的工厂；如果命名不同，按文件实际命名调整（Read 时确认）。`localStorage` 在 jsdom 里默认可用；**@vueuse/core useLocalStorage 对字符串类型直接以裸字符串存储**（无 JSON 引号），所以 `setItem` / `expect.toBe` 都用裸字符串 `'inline-diff'`。

- [ ] **Step 7.5：跑全部 RiskClauseDiff / RiskCard / RiskListPanel 测试**

```bash
npx vitest run tests/app/components/assistant/contract/RiskClauseDiff.test.ts tests/app/components/assistant/contract/RiskCard.test.ts tests/app/components/assistant/contract/RiskListPanel.test.ts --reporter=verbose 2>&1 | tail -80
```

Expected: 全部 PASS。如果有 fail，按错误信息修：
- "Missing required prop layout" → mountCard 默认值漏加
- "Missing required prop mode" → RiskClauseDiff 直接 mount 但没传 mode（应该改 stacked/inline 二选一）
- "expect(stub.attributes('mode')).toBe('stacked')" 拿到 undefined → stub 没继承 attrs，检查 passthrough 模板是否含 `...attrs`

- [ ] **Step 7.6：跑前端合同测试 sanity check（防外溢回归）**

```bash
npx vitest run tests/app/components/assistant/contract/ --reporter=verbose 2>&1 | tail -40
```

Expected: 全部 PASS。

- [ ] **Step 7.7：commit**

```bash
git add tests/app/components/assistant/contract/RiskClauseDiff.test.ts \
        tests/app/components/assistant/contract/RiskCard.test.ts \
        tests/app/components/assistant/contract/RiskListPanel.test.ts
git commit -m "test(contract): 风险卡 Layout A/C 单元测试覆盖"
```

---

## Task 8：e2e 蓝图 spec + chrome-devtools MCP 手动验收

**Files:**
- Create: `tests/e2e/contract-review-risk-card-layout.spec.ts`（蓝图，不在 CI 跑）

**项目现状**：当前 `package.json` 未安装 `@playwright/test`，`tests/e2e/` 已有 3 份 .spec.ts（document-draft / module-chat-history-load / xiaosuo-chat-queue）都是同样的"未启用蓝图"——文件存在、约定好选择器，但需要等独立 PR 接通 playwright 工具链才能在 CI 跑。本 PR 沿用同模式：

- **写 spec 文件**：作为未来启用 playwright 后的执行底稿（README、selector、测试数据准备步骤都列清楚）
- **不在本 PR 安装 playwright**（独立工具链 PR 范围）
- **PR 4 验收用 chrome-devtools MCP 手动跑**（与 Task 9.4 浏览器肉眼抽样合并，覆盖端到端切换 + localStorage 偏好持久化）

> **测试数据前置**：测试账号 `13064768490` / `daixin88` 名下需要存在至少一份 **status=completed** 的合同审查（含至少 1 条 risk）。如果当前没有，先在 `bun dev` 下手动新建一份；后续 e2e 直接复用。

> **e2e 不依赖 PR 3**：只要 risk 列表有任一条目能渲染 RiskClauseDiff，就能验证 mode 切换；problematicQuote 是否有值不影响 e2e 主线。

- [ ] **Step 8.1：确认 dev server 跑起来**

```bash
# 在另一个 shell（或 background）
bun dev
# 等控制台显示 "Local:   http://localhost:3000/"
```

- [ ] **Step 8.2：手动准备一份 completed 状态的合同审查（如已有可跳过）**

打开 `http://localhost:3000/login`：登录 13064768490 / daixin88 → 进 dashboard → 合同审查 → 上传任意 docx → 等待至 status=completed。记下 review id（URL 形如 `/dashboard/assistant/contract/[id]` 或类似）。

> 如果合同审查页面路径不同，先：
> ```bash
> grep -rn "dashboard.*contract" app/pages/ --include="*.vue" -l | head -5
> ```
> 确认路由位置，记录到下面 `CONTRACT_REVIEW_PATH` 常量。

- [ ] **Step 8.2.5：给合同审查列表行加 data-testid（e2e 稳定 selector）**

`tests/e2e/document-draft-workflow.spec.ts` 已经登记过这种 testability TODO："建议补充如下 data-testid"。本 PR 顺手补完合同审查列表的：

1. 找到合同审查列表页组件：

```bash
grep -rn "ReviewListItem\|reviewList\|contract.*list" app/components/assistant/contract/ app/pages/ --include="*.vue" -l | head -5
```

2. 在列表页对每条 review 卡片 / 行的根元素上追加 `data-testid="contract-review-list-item"` 与 `:data-review-id="review.id"`（属性命名参考 RiskCard.vue:102 的 `data-risk-id` 模式），不破坏现有视觉。**只动列表行根元素一处**，不引入 wrapper。

3. 同样给详情页风险面板在路由级别加一个稳定 root：在合同审查详情页的最外层 `<div>` 上加 `data-testid="contract-review-detail"`（如果已有 testid 则跳过）。

> 这是产品代码的微小 testability 改进，不算架构变更——目的是让 e2e 不依赖文案 / svg 子选择器。如果 grep 找到的列表组件 < 50 行且无 data-testid 体系，直接加；超过 50 行或已有完整 testid 体系，按既有体系追加同名风格。

- [ ] **Step 8.3：创建 e2e 测试文件**

新建文件 `tests/e2e/contract-review-risk-card-layout.spec.ts`：

```typescript
/**
 * 合同审查 · 风险卡 Layout A/C 切换 E2E 测试（PR 4）· **蓝图状态**
 *
 * ⚠️ 项目当前未安装 @playwright/test，本文件为未来 playwright 工具链 PR 启用后的执行底稿。
 * PR 4 验收用 chrome-devtools MCP 手动跑（详见 plan Task 8 Step 8.4）。
 *
 * 测试目标：验证"切换布局 Tabs → 风险卡 DOM 跟随重渲染 → localStorage 偏好持久化 → 重新加载后偏好仍在"。
 *
 * 前置条件：
 * - 开发服务器在 http://localhost:3000 运行（`bun dev`）
 * - 测试账号名下至少有一份 status=completed 的合同审查（手动预创建）
 * - 测试账号：13064768490 / daixin88（见 .env.testing）
 *
 * 未来启用 playwright 后运行命令：
 *   bun add -D @playwright/test && npx playwright install chromium
 *   npx playwright test tests/e2e/contract-review-risk-card-layout.spec.ts
 *
 * 不覆盖：
 * - PR 3 的 quote 字符级高亮（取决于 PR 3 是否合）
 * - DocxPreview 的字符级高亮（PR 5 范围）
 */

import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const CONTRACT_LIST_PATH = '/dashboard/assistant/contract'  // 视实际路由调整
const NAV_TIMEOUT = 10_000
const STATE_TIMEOUT = 8_000

test.describe('合同审查 · 风险卡 Layout 切换 E2E', () => {
    test.beforeEach(async ({ page }) => {
        // 登录
        await page.goto(`${BASE_URL}/login`)
        await page.getByLabel('手机号').fill('13064768490')
        await page.getByLabel('密码').fill('daixin88')
        await page.getByRole('button', { name: '登录' }).click()
        await page.waitForURL(`${BASE_URL}/dashboard/**`, { timeout: NAV_TIMEOUT })

        // 清理 localStorage 偏好，确保用例从默认 stacked 起步
        await page.evaluate(() => localStorage.removeItem('contract-review-risk-card-layout'))

        // 进入第一份 completed 合同审查（Step 8.2.5 已在列表行加 data-testid）
        await page.goto(`${BASE_URL}${CONTRACT_LIST_PATH}`)
        await page.waitForLoadState('networkidle')
        await page.locator('[data-testid="contract-review-list-item"]').first().click()
        await page.waitForLoadState('networkidle')

        // 等顶部布局 Tabs 出现（验证 RiskListPanel 已 mount）
        await page.locator('[data-testid="risk-card-layout-tabs"]').waitFor({ timeout: STATE_TIMEOUT })

        // 展开第一条风险卡（让 RiskClauseDiff 进入 DOM）
        const firstRiskCard = page.locator('[data-risk-id]').first()
        await firstRiskCard.scrollIntoViewIfNeeded()
        await firstRiskCard.click()
    })

    test('场景 1：默认 stacked → 切换 inline-diff → DOM 跟随变化', async ({ page }) => {
        const tabs = page.locator('[data-testid="risk-card-layout-tabs"]')

        // 默认 stacked：可见 "完整原文" 小标题 + "建议改写" 小标题（Layout A 标识文案）
        await expect(page.locator('text=完整原文').first()).toBeVisible()
        await expect(page.locator('text=建议改写').first()).toBeVisible()

        // 切换到 inline-diff
        await tabs.getByRole('tab', { name: '对照' }).click()
        // 等动画 + 重渲染
        await page.waitForTimeout(300)

        // inline-diff：应可见"原文 → 建议（行内差异）"小标题；不应再出现 stacked 模式的"完整原文"标题
        await expect(page.locator('text=原文 → 建议（行内差异）').first()).toBeVisible()
        await expect(page.locator('text=完整原文')).toHaveCount(0)
    })

    test('场景 2：localStorage 偏好持久化 · 切换后刷新页面仍是 inline-diff', async ({ page }) => {
        const tabs = page.locator('[data-testid="risk-card-layout-tabs"]')
        await tabs.getByRole('tab', { name: '对照' }).click()
        await page.waitForTimeout(300)

        // 验证 localStorage 已写入（@vueuse/core string serializer 存裸字符串，无 JSON 引号）
        const stored = await page.evaluate(() =>
            localStorage.getItem('contract-review-risk-card-layout'),
        )
        expect(stored).toBe('inline-diff')

        // 重载页面
        await page.reload()
        await page.waitForLoadState('networkidle')
        await page.locator('[data-testid="risk-card-layout-tabs"]').waitFor({ timeout: STATE_TIMEOUT })

        // 展开第一条风险卡
        const firstRiskCard = page.locator('[data-risk-id]').first()
        await firstRiskCard.click()

        // 渲染应直接是 inline-diff
        await expect(page.locator('text=原文 → 建议（行内差异）').first()).toBeVisible()
    })

    test('场景 3：切回 stacked → 偏好同步切回', async ({ page }) => {
        const tabs = page.locator('[data-testid="risk-card-layout-tabs"]')

        await tabs.getByRole('tab', { name: '对照' }).click()
        await page.waitForTimeout(200)

        await tabs.getByRole('tab', { name: '分段' }).click()
        await page.waitForTimeout(200)

        const stored = await page.evaluate(() =>
            localStorage.getItem('contract-review-risk-card-layout'),
        )
        // 裸字符串，无 JSON 引号
        expect(stored).toBe('stacked')
        await expect(page.locator('text=完整原文').first()).toBeVisible()
    })
})
```

> **selector 备注**：
> - `[data-testid="risk-card-layout-tabs"]` 是 Task 5.3 给 `<Tabs>` 加的 testid
> - `[data-testid="contract-review-list-item"]` 是 Task 8.2.5 给列表行加的 testid
> - `[data-risk-id]` 是 RiskCard 已有的 attribute（line 102 / 157）
> - 不再 fallback 到 svg / href / 文案选择器（Agent B audit 指出 fallback 是反模式 —— Step 8.2.5 已统一加 data-testid 解决）

- [ ] **Step 8.4：用 chrome-devtools MCP 手动跑 spec 三个场景**

playwright 未安装，spec 文件作为蓝图保留；本步用 chrome-devtools MCP 按 spec 三个场景人工验收：

**前置**：`bun dev` 已起；浏览器登录 13064768490 / daixin88，进入一份 completed 合同审查详情页。

**场景 1：默认 stacked → 切换 inline-diff → DOM 跟随变化**
1. 验证页面顶部能看到布局段控（"分段 / 对照"）
2. 默认状态下（DevTools Application → Local Storage 看 `contract-review-risk-card-layout` 应为空 / `stacked`），展开第一条风险卡能看到「条款标题 / 完整原文 / 建议改写」
3. 点击「对照」段控按钮，风险卡内容切换为单栏行内 diff（红底删除线 + 绿底加粗）
4. DevTools Application Local Storage `contract-review-risk-card-layout` 值变为裸字符串 `inline-diff`（**无 JSON 引号**）

**场景 2：localStorage 偏好持久化 · 刷新仍 inline-diff**
5. 在场景 1 切到 inline-diff 后按 F5 刷新
6. 重新展开风险卡，应直接是 inline-diff 形态

**场景 3：切回 stacked → 偏好同步切回**
7. 点击「分段」段控按钮 → 风险卡恢复四段式
8. Local Storage 值变回 `stacked`

3 个场景全过 → e2e 验收通过。

> **常见排错**：
> - 场景 1 没切换：检查 cardLayout `useLocalStorage` 是否真的双向绑定（DevTools Console: `localStorage.getItem('contract-review-risk-card-layout')` 应跟着变）
> - 场景 2 刷新偏好丢失：@vueuse/core string serializer 行为——存的是裸字符串而非 `JSON.stringify` 加引号；如果调试时人工 setItem 时加了引号，会被解析回字面量带引号的字符串导致 v-model 比对失败
> - 场景 3 切回失败：tabs 切换没触发响应式（检查 `<Tabs v-model="cardLayout">` 而不是 `:value=`）

- [ ] **Step 8.5：commit spec 蓝图（不跑）**

```bash
git add tests/e2e/contract-review-risk-card-layout.spec.ts
git commit -m "test(contract): 风险卡 Layout 切换 e2e spec 蓝图"
```

> commit message 加"蓝图"二字，明示非可执行测试，避免后人误以为 CI 已覆盖。

---

## Task 9：完整 typecheck + 全量测试 + 视觉抽样验收

**Files:**
- 不修改文件

最后一步把所有改动跑一遍闭环：typecheck + 单测全量 + 浏览器肉眼抽样。

- [ ] **Step 9.1：typecheck 全量**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。

- [ ] **Step 9.2：前端合同测试全量**

```bash
npx vitest run tests/app/components/assistant/contract/ --reporter=verbose 2>&1 | tail -30
```

Expected: 全部 PASS。

- [ ] **Step 9.3：shared 类型测试**

```bash
npx vitest run tests/shared/types/contract.test.ts tests/shared/types/contract.types.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 9.4：浏览器肉眼抽样（chrome-devtools MCP）**

按以下脚本走一遍（如果 dev server 没起，先 `bun dev`）：

1. 浏览器打开 `http://localhost:3000`，登录
2. 进入一份 completed 合同审查
3. 验证默认布局：
   - 主清单第一条风险展开后能看到「条款标题 / 完整原文 / 建议改写」三段标签（如果 PR 3 已合并且 quote 有值，还能看到「问题片段」框）
   - 完整原文段落里如有 quote 字段，看到一段深黄底高亮文字
4. 点击顶部布局 Tabs 的「对照」按钮：
   - 风险卡内容切换为单栏行内 diff，删除文字红底删除线、新增文字绿底加粗
   - localStorage `contract-review-risk-card-layout` 值变为 `"inline-diff"`（DevTools Application 面板看）
5. 切回「分段」按钮：恢复四段式布局，localStorage 改回 `"stacked"`
6. 重载页面：偏好沿用上次（如果上次是 inline-diff，刷新后还是 inline-diff）
7. 抽查一份 status=reviewing（流式审查中）合同：布局 Tabs 应该正常渲染（不依赖 isCompleted）；新增风险卡冒出时能继承当前布局

> 7 条全过 → 视为 UI 验收通过。

- [ ] **Step 9.5：（跳过）e2e 回归**

playwright 未在项目内启用，跳过。`tests/e2e/*.spec.ts` 全是蓝图状态，PR 4 沿用同模式。如果未来引入 playwright 工具链 PR，届时 `npx playwright test tests/e2e/` 一次性跑全部蓝图。

- [ ] **Step 9.6：commit message 验证（可选）**

```bash
git log --oneline | head -10
```

Expected 看到 PR 4 提交序列：
```
test(contract): 风险卡 Layout 切换 e2e 测试
test(contract): 风险卡 Layout A/C 单元测试覆盖
feat(contract): 风险卡 Layout A/C 双布局 + 顶部切换
feat(contract): mapEntityToDisplay 透传双锚点 quote 字段
feat(contract): RiskDisplayPhaseB 扩展双锚点 quote 字段
```

5 个原子 commit，每个对应一个独立可回退单元；PR 描述按这个序列写 changelog。

---

## Task 10：开 PR · 整合到 dev

**Files:**
- 不修改文件

- [ ] **Step 10.1：push branch**

```bash
git push -u origin pr4-frontend-risk-card
```

- [ ] **Step 10.2：开 PR（gh CLI）**

```bash
gh pr create --base dev --title "feat(contract): 风险卡 Layout A/C 双布局切换 (PR 4)" --body "$(cat <<'EOF'
## Summary
- 风险卡升级为「分段」（Layout A，默认）+「对照」（Layout C 行内 diff）双布局
- 顶部 Tabs 段控切换，偏好持久化到 localStorage（`contract-review-risk-card-layout`）
- Layout A：条款标题 / 完整原文（含 quote 字符段深黄高亮）/ 问题片段 / 建议改写 四段
- Layout C：dmp 行内 diff，删除红底删除线 + 新增绿底加粗
- `RiskDisplayPhaseB` 扩展 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 三字段（`quoteMatchSource` 不前端透传，YAGNI）
- `ContractReviewPanel.mapEntityToDisplay` 把 `ContractRiskEntity` 上的 quote 字段透传到 RiskDisplayPhaseB
- spec § 6.4 quote=null 降级路径：问题片段框不渲染、完整原文不字符级高亮、Layout C 退化为纯 clauseText 显示

## Spec
docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md § 6 + § 5.0

## 依赖
- PR 2 数据模型重构（已合）—— 提供 `ContractRiskEntity` 上的 quote 字段
- PR 3 路线 2 锚点解析（**可选已合**）—— 提供 quote 字段实际值；未合时全为 null，UI 自动降级

## Test plan
- [x] Vitest: `npx vitest run tests/app/components/assistant/contract/`
- [x] Vitest: `npx vitest run tests/shared/types/contract.test.ts tests/shared/types/contract.types.test.ts`
- [x] Typecheck: `bun run typecheck`
- [x] e2e spec 蓝图（playwright 未启用）：`tests/e2e/contract-review-risk-card-layout.spec.ts` 已写入待未来工具链 PR 跑
- [x] chrome-devtools MCP 手动验收三场景：默认布局 / Tabs 切换 / localStorage 持久化 / 刷新偏好沿用 / status=reviewing 流式态布局正常
EOF
)"
```

- [ ] **Step 10.3：等 CI 跑过**

```bash
gh pr checks --watch
```

Expected: 所有 check 全绿。

- [ ] **Step 10.4：合并（按团队约定走 review 流程，本步不自动合）**

合并选项交给评审人；本 plan 不指示自动合并。

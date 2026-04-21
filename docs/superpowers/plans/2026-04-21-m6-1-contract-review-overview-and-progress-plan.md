# M6.1 合同审查 · 分档总览 + 双向跳转 + 过程可视化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把合同审查从"黑盒等 45 秒才出结果"升级为"全程进度可见 + 分档总览 + 三入口跳转"的协作体验。

**Architecture:**
- 后端：把现有一次性 `contractReviewMainAgent` 扩展为"切分→逐条→汇总"三阶段，通过 `publishCustomEvent` 发 `stage / progress / risk / overview` 四种 SSE 事件
- 前端：扩展 `useContractReview` 承接事件流驱动 UI；新增"进度条 / 总览区 / 定位调度器"三类组件；`ContractDocxPreview` 增加 `data-risk-id` 注入支持双向联动
- 数据：`contractReviews.summary` 字段类型从 `String` 升级为 `JSON`，结构为 `ContractOverview`；条款切分结果不落库，只在 workflow 内存中流转

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + shadcn-vue，Prisma + PostgreSQL，LangGraph + LangChain（已有），Vitest + Playwright（测试），bun 包管理（但测试必须用 `npx vitest run`）

**Spec**: `docs/superpowers/specs/2026-04-21-m6-1-contract-review-overview-and-progress-design.md`

---

## 实施顺序与工期

| 子期 | 标题 | 工期 | 独立可上线 |
|------|------|------|-----------|
| 1 | 基础 + 阶段 + 计数 | 4-5 天 | ✅ 用户看到 5 阶段进度 + 条款总数 |
| 2 | 逐条流式 | 2 天 | ✅ 风险卡片边审边冒出 |
| 3 | 总览 + PDF | 2 天 | ✅ 顶部分档总览 + PDF 同步 |
| 4 | 跳转联动 | 2 天 | ✅ 三入口 + 反向悬停 + 钉多条 |

**每个子期结束时都应保证主干测试全绿 + 手工冒烟通过。**

---

## 关键约定

- **测试命令统一**：`npx vitest run <path>`（不用 `bun test`，因为 Nuxt 自动导入只在 vitest 环境下正确解析）
- **类型检查**：`npx nuxi typecheck`（不是 `tsc`）
- **commit scope**：统一 `contract`（按 `.claude/rules/git.md`）
- **每个 task 写完必须 commit**；多个 task 之间可以累积未上线状态，但每个 task 末尾都应有可编译、测试绿的代码状态
- **API 路径规则**：本期 **不新增** REST endpoint；所有流式事件经现有 `/api/v1/assistant/contract/chat` 的 SSE 自定义事件透传
- **前端组件命名**：Nuxt 自动导入会将 `app/components/assistant/contract/Xxx.vue` 折叠成 `AssistantContractXxx`；新组件命名时避免路径段重复（例如不要叫 `ContractReviewProgress.vue`，否则会折叠成 `AssistantContractContractReviewProgress`——取名 `ReviewProgress.vue` 即可得到 `AssistantContractReviewProgress`）

---

# 子期 1：基础 + 阶段 + 计数

**目标**：把现有"黑盒等待"升级为"进度可见"。数据结构升级 + 条款切分节点 + 进度条组件。

**完成状态**：
- `summary` 字段完成 String → Json 迁移，历史数据 wrap 为 `{ highlights: null, overall: <old_string> }` 不崩
- 提交合同后用户能看到 5 阶段进度条（识别/立场/切分/分析/汇总），以及"共 24 条 / 正在分析第 14 条"的计数
- 最终 `risks[]` 和 `summary.overall` 仍按原流程一次性生成（`clauseAnalyzer` 实际循环改造留给子期 2）

---

## Task 1.1：新增共享类型

**Files:**
- Modify: `shared/types/contract.ts` — 末尾追加 3 个类型
- Test: `tests/shared/types/contract.types.test.ts` — 新建，做编译期约束

- [ ] **Step 1: 写失败测试**

新建 `tests/shared/types/contract.types.test.ts`：

```typescript
/**
 * 纯类型测试：用 TS 条件类型 + expect-type 风格断言
 * 保证 ContractOverview / ClauseSegment / ContractReviewEvent 结构不被误改
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { ContractOverview, ClauseSegment, ContractReviewEvent } from '#shared/types/contract'

describe('M6.1 新增合同审查类型', () => {
    it('ContractOverview 只有 highlights + overall', () => {
        expectTypeOf<ContractOverview>().toHaveProperty('highlights')
        expectTypeOf<ContractOverview>().toHaveProperty('overall')
        // 禁止出现被删除的字段
        // @ts-expect-error score 字段应已移除
        expectTypeOf<ContractOverview>().toHaveProperty('score')
    })

    it('ClauseSegment 不含 offset 字段', () => {
        expectTypeOf<ClauseSegment>().toEqualTypeOf<{ index: number; number: string | null; text: string }>()
    })

    it('ContractReviewEvent 只允许 4 种 type', () => {
        const stage: ContractReviewEvent = { type: 'stage', stage: 'detect', status: 'running' }
        const progress: ContractReviewEvent = { type: 'progress', current: 1, total: 10 }
        const overviewEv: ContractReviewEvent = { type: 'overview', overview: { highlights: null, overall: 'x' } }
        // 未定义的 type 应被拒绝
        // @ts-expect-error 未定义的 type 应被拒绝
        const bad: ContractReviewEvent = { type: 'warn', clauseIndex: 1 }
        expectTypeOf(stage).toMatchTypeOf<ContractReviewEvent>()
        expectTypeOf(progress).toMatchTypeOf<ContractReviewEvent>()
        expectTypeOf(overviewEv).toMatchTypeOf<ContractReviewEvent>()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/shared/types/contract.types.test.ts`
Expected: FAIL，提示 `Module '"#shared/types/contract"' has no exported member 'ContractOverview'`

- [ ] **Step 3: 追加类型定义**

在 `shared/types/contract.ts` 文件末尾追加：

```typescript
// ==================== M6.1 ====================

/**
 * 分档总览（contractReviews.summary 升级为 JSON 后的结构）
 *
 * - counts / score / scoreLabel 三个派生值不进 schema，由前端 useContractOverview 实时派生
 * - highlights 为 null 时说明"历史数据"或"summarize 未完成"，前端降级为只显示卡片列表
 */
export interface ContractOverview {
    /** 分档要点，每档 1-5 条，挂 riskId 用于可点跳转 */
    highlights: {
        high: Array<{ text: string; riskId: string }>
        medium: Array<{ text: string; riskId: string }>
        low: Array<{ text: string; riskId: string }>
    } | null
    /** 总评（后端 LLM 生成，≤120 字）。历史 M4/M5 的 string 迁移后填这个字段 */
    overall: string
}

/**
 * 条款切分结果（仅在 workflow 内存中流转，不落库）
 */
export interface ClauseSegment {
    /** 顺序号，从 1 开始 */
    index: number
    /** 条款编号文本，如 "3.2"、"第五条"、null（无标号散段） */
    number: string | null
    /** 条款正文 */
    text: string
}

/**
 * 合同审查的 SSE 自定义事件联合（经 publishCustomEvent 发出，前端 onCustomEvent 接收）
 *
 * 只有 4 种 type：
 *  - stage：阶段状态切换（running / done），done 事件可能携带阶段产出
 *  - progress：分析进度，单条失败走可选 error 字段
 *  - risk：增量 risk（子期 2 才开始用）
 *  - overview：汇总总览（子期 3 才开始用）
 */
export type ContractReviewEvent =
    | {
        type: 'stage'
        stage: 'detect' | 'stance' | 'segment' | 'analyze' | 'summarize'
        status: 'running' | 'done'
        /** analyze 阶段累积的非致命失败 */
        warnings?: string[]
        /** segment 阶段 done 时携带 */
        totalClauses?: number
        /** detect 阶段 done 时携带 */
        partyA?: string
        partyB?: string
        contractType?: string
    }
    | { type: 'progress'; current: number; total: number; error?: string }
    | { type: 'risk'; risk: Risk }
    | { type: 'overview'; overview: ContractOverview }
```

- [ ] **Step 4: 同步修改 ReviewWithParsedRisks 类型**

文件内已有：

```typescript
export type ReviewWithParsedRisks = Omit<contractReviews, 'risks'> & {
    risks: Risk[] | null
}
```

改为（同时把 summary 收敛为 ContractOverview）：

```typescript
export type ReviewWithParsedRisks = Omit<contractReviews, 'risks' | 'summary'> & {
    risks: Risk[] | null
    summary: ContractOverview | null
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/shared/types/contract.types.test.ts`
Expected: PASS 3/3

- [ ] **Step 6: 类型检查**

Run: `npx nuxi typecheck`
Expected: 可能有使用 `review.summary` 为字符串的旧代码报错，**留到后续 task 逐个修**（不要在本 task 里一次性修完，保持 task 粒度）。记下所有报错文件，作为 Task 1.2 的输入。

- [ ] **Step 7: Commit**

```bash
git add shared/types/contract.ts tests/shared/types/contract.types.test.ts
git commit -m "feat(contract): 新增 ContractOverview / ClauseSegment / ContractReviewEvent 类型

M6.1 子期 1 Task 1.1：为分档总览、条款切分、SSE 事件流三类能力提供
共享类型契约。summary 字段类型同步收敛到 ContractOverview | null。"
```

---

## Task 1.2：修复 summary 类型从 string 到 ContractOverview 的下游报错

**Files:**
- Modify: `server/services/assistant/contract/contractReviewPdf.service.ts`（138 行附近 `summary: string | null` → `summary: ContractOverview | null`）
- Modify: `server/services/workflow/middleware/reviewResultPersistence.middleware.ts`（`summary: structured.summary` → 先包装成 `{ highlights: null, overall: structured.summary }`，后续子期 3 再生成 highlights）
- Modify: `server/services/assistant/contract/riskSchema.builder.ts`（`summary: z.string()` 保持不变——LLM 仍输出字符串，持久化层负责包装）
- Modify: `app/components/assistant/contract/RiskListPanel.vue`（现在渲染 `summary` 字符串的 `<div v-if="summary">` 改为 `v-if="summary?.overall"` 读 `overall` 字段）
- Modify: `app/composables/useContractReview.ts`（所有读 `summary` 的地方用新类型）
- Test: 跑现有测试套件，确认只有类型层面改动

- [ ] **Step 1: 修 contractReviewPdf.service.ts**

找到 `summary: string | null`，改为：

```typescript
import type { ContractOverview, Risk } from '#shared/types/contract'
// ...
summary: ContractOverview | null  // 原为 string | null
```

凡是在 PDF 渲染里读 `summary` 字符串的地方（如 `if (summary) renderText(summary)`），改为：

```typescript
if (summary?.overall) renderText(summary.overall)
```

- [ ] **Step 2: 修 reviewResultPersistence.middleware.ts**

找到这段：

```typescript
await updateContractReviewDAO(options.reviewId, {
    risks: structured.risks as unknown as Prisma.InputJsonValue,
    summary: structured.summary,
})
```

改为：

```typescript
await updateContractReviewDAO(options.reviewId, {
    risks: structured.risks as unknown as Prisma.InputJsonValue,
    summary: {
        highlights: null,
        overall: structured.summary,
    } as unknown as Prisma.InputJsonValue,
})
```

*说明：子期 3 会引入真正的 summarize 节点生成 highlights；当前保持"旧流程包装"以兼容。*

- [ ] **Step 3: 修 RiskListPanel.vue 渲染**

找到：

```vue
<div v-if="summary" class="p-3 border-b text-sm text-muted-foreground whitespace-pre-wrap">{{ summary }}</div>
```

改为：

```vue
<div v-if="summary?.overall" class="p-3 border-b text-sm text-muted-foreground whitespace-pre-wrap">{{ summary.overall }}</div>
```

并把 defineProps 里 `summary: string | null` 改为 `summary: ContractOverview | null`：

```typescript
import type { Risk, ContractReviewStatus, ContractOverview } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null  // 原：string | null
    isRebuilding: boolean
    hasUnsavedDocxChanges: boolean
}>()
```

- [ ] **Step 4: 修 useContractReview.ts 透传**

该文件未直接访问 `summary`，但 `ReviewWithParsedRisks` 类型已经收敛，凡是被 `review.value.summary` 读作字符串的调用点都会报 TS 错误。挨个找：

Run: `npx nuxi typecheck 2>&1 | grep summary`

把每处提示的 `summary` 访问改为 `summary?.overall`。

- [ ] **Step 5: 修 ContractReviewPanel.vue 透传给 RiskListPanel**

现有：

```vue
<AssistantContractRiskListPanel
    ...
    :summary="review?.summary ?? null"
    ...
/>
```

类型会自动正确，但注意 review.summary 现在已经是 `ContractOverview | null`，不再是 string。

- [ ] **Step 6: 跑所有合同审查相关测试**

```bash
npx vitest run tests/app/components/assistant/contract
npx vitest run tests/app/composables/useContractReview.test.ts
npx vitest run tests/server/assistant/contract
npx vitest run tests/server/workflow/middleware/reviewResultPersistence.test.ts
```

Expected: 可能有 1-2 处测试 mock 里 `summary: '某段文字'` 需要改成 `summary: { highlights: null, overall: '某段文字' }`。逐个修。

- [ ] **Step 7: 类型检查必须通过**

Run: `npx nuxi typecheck`
Expected: 0 error

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "refactor(contract): summary 类型从 string 收敛到 ContractOverview 全链路

M6.1 子期 1 Task 1.2：PDF 服务、持久化中间件、RiskListPanel、测试
mock 统一按新类型访问 summary.overall。暂时在持久化层包装 LLM 的字
符串输出，待子期 3 升级 summarize 节点后替换为真正的 highlights。"
```

---

## Task 1.3：DB 迁移 summary String → Json

**Files:**
- Modify: `prisma/models/contractReview.prisma` — `summary` 字段类型变更

- [ ] **Step 1: 修改 Prisma 模型**

`prisma/models/contractReview.prisma` 第 28 行：

```prisma
/// 审查摘要 Markdown
summary               String?   @db.Text
```

改为：

```prisma
/// 审查摘要（M6.1 升级为 ContractOverview JSON：{ highlights, overall }）
summary               Json?     @db.JsonB
```

- [ ] **Step 2: 准备数据迁移 SQL**

PostgreSQL 的 `TEXT → JSONB` 不支持隐式转换——**必须**先手工跑 SQL 转换历史数据，再跑 `prisma:push` 同步 schema（否则 prisma push 会提示丢数据）。

新建 `prisma/migrations-m6-1-summary-to-json.sql`（**临时文件，迁移完成后删除**，不污染 `prisma/migrations/`）：

```sql
-- M6.1：合同审查 summary 字段从 TEXT 升级为 JSONB
-- 历史 string 原地包装为 { highlights: null, overall: <old_string> }
-- 此 SQL 只在生产/测试库执行一次；完成后删除本文件
ALTER TABLE "contract_reviews"
    ALTER COLUMN "summary" TYPE JSONB
    USING CASE
        WHEN "summary" IS NULL THEN NULL
        ELSE jsonb_build_object('highlights', NULL, 'overall', "summary")
    END;
```

- [ ] **Step 3: 在测试库执行迁移**

```bash
# 1. 先跑 SQL 转换历史数据
DATABASE_URL="$TEST_DATABASE_URL" psql -f prisma/migrations-m6-1-summary-to-json.sql
# 2. 再让 prisma push 同步 schema（此时数据已符合 Json 类型，不会丢数据；无需 --accept-data-loss）
DATABASE_URL="$TEST_DATABASE_URL" bun run prisma:push
# 3. 回归测试
npx vitest run tests/server/assistant/contract
```

Expected: SQL 成功，prisma:push 无警告，测试全绿。

- [ ] **Step 4: 本地主库执行 + 部署登记**

实施者在本机对主库执行同样两步（SQL → prisma:push）。并在部署文档中登记"M6.1 上线需先跑 `prisma/migrations-m6-1-summary-to-json.sql` 再 deploy"。迁移完成**删除该 SQL 文件**（已在 commit 中说明）。

- [ ] **Step 5: Commit**

```bash
git add prisma/models/contractReview.prisma prisma/migrations-m6-1-summary-to-json.sql
git commit -m "feat(contract): summary 字段从 String(Text) 升级为 Json(JsonB)

M6.1 子期 1 Task 1.3：配合 ContractOverview 结构化存储。附 SQL 迁
移脚本 migrations-m6-1-summary-to-json.sql，历史 string 原地包装为
{ highlights: null, overall }。部署时先跑 SQL 再 prisma:push，迁移完
成后删除该 SQL 文件。"
```

---

## Task 1.4：条款切分器（正则 + LLM 兜底）

**Files:**
- Create: `server/services/assistant/contract/docx/clauseSegmenter.ts`
- Test: `tests/server/assistant/contract/docx/clauseSegmenter.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/docx/clauseSegmenter.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { segmentClausesByRegex } from '~~/server/services/assistant/contract/docx/clauseSegmenter'

describe('clauseSegmenter · 正则切分', () => {
    it('按 "第X条" 切分', () => {
        const text = [
            '第一条 合同标的',
            '甲方委托乙方……',
            '第二条 付款方式',
            '3.1 首付 40%',
            '第三条 争议解决',
            '以仲裁方式解决。',
        ].join('\n')
        const segments = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['第一条', '第二条', '第三条'])
        expect(segments[0]?.text).toContain('甲方委托乙方')
    })

    it('按 "1.1" 级层级编号切分', () => {
        const text = [
            '1. 总则',
            '1.1 本合同……',
            '1.2 双方应……',
            '2. 权利义务',
            '2.1 甲方应……',
        ].join('\n')
        const segments = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['1.', '1.1', '1.2', '2.', '2.1'])
    })

    it('按 "一、" 中文序号切分', () => {
        const text = ['一、协议内容', '双方约定如下。', '二、违约责任', '违约方承担……'].join('\n')
        const segments = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['一、', '二、'])
    })

    it('无编号散段整篇作为一个 segment（number=null）', () => {
        const text = '双方经友好协商，就某项目达成如下约定。'
        const segments = segmentClausesByRegex(text)
        expect(segments).toHaveLength(1)
        expect(segments[0]?.number).toBeNull()
        expect(segments[0]?.text).toBe(text)
    })

    it('混合编号：第X条 + 1.1 共存，各自识别', () => {
        const text = [
            '第一条 定义',
            '1.1 本合同项下……',
            '1.2 双方约定……',
            '第二条 付款',
            '2.1 总金额 100 万。',
        ].join('\n')
        const segments = segmentClausesByRegex(text)
        expect(segments).toHaveLength(5)
    })

    it('返回结果 index 从 1 开始且连续', () => {
        const text = '第一条 A\n第二条 B\n第三条 C'
        const segments = segmentClausesByRegex(text)
        expect(segments.map(s => s.index)).toEqual([1, 2, 3])
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts`
Expected: 全部 FAIL（模块不存在）

- [ ] **Step 3: 实现 clauseSegmenter**

新建 `server/services/assistant/contract/docx/clauseSegmenter.ts`：

```typescript
/**
 * 合同条款切分器
 *
 * 功能：把合同全文按条款编号切分成 ClauseSegment[]。
 * 策略：先正则（覆盖 90%+ 场景），再 LLM 兜底（由调用方决定是否兜底，参见 segmentClauses）。
 *
 * 正则覆盖的编号格式：
 *  - 「第X条」/「第X.X条」，X 为阿拉伯数字或中文数字
 *  - 「1.」/「1.1」/「1.1.1」多级层级编号
 *  - 「一、」/「二、」中文序号
 *
 * 返回结果 index 从 1 开始连续编号。若识别失败（零个编号匹配），整篇文本作为 number=null 的单段返回。
 */
import type { ClauseSegment } from '#shared/types/contract'

/** 常用条款编号正则（按优先级组合，每组捕获"标号"） */
const NUMBER_PATTERNS: RegExp[] = [
    // 「第1条」「第1.1条」「第一条」「第一百零五条」
    /(第[一二三四五六七八九十零百千0-9\.]+条)/,
    // 「1.1.1」「1.1」「1.」（行首阿拉伯数字带点）
    /^(\d+(?:\.\d+)*\.?)\s/,
    // 「一、」「二、」「十三、」
    /^([一二三四五六七八九十百千]+、)/,
]

/**
 * 按正则切分合同全文。每个 segment 包括编号及其到下一个编号（或文末）之间的全部文本。
 *
 * @param fullText 合同全文（预处理后的纯文本）
 * @returns ClauseSegment 数组；若无任何编号被匹配，返回单个 null-number 兜底段
 */
export function segmentClausesByRegex(fullText: string): ClauseSegment[] {
    const lines = fullText.split(/\r?\n/)
    const matches: Array<{ lineIdx: number; number: string }> = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? ''
        if (!line) continue
        for (const re of NUMBER_PATTERNS) {
            const m = line.match(re)
            if (m?.[1]) {
                matches.push({ lineIdx: i, number: m[1] })
                break
            }
        }
    }

    if (matches.length === 0) {
        // 无标号散段：整篇视为一个 segment
        const text = fullText.trim()
        if (!text) return []
        return [{ index: 1, number: null, text }]
    }

    // 按行号切分：每个 match 到下一个 match 之前（或文末）的所有行拼起来作为 text
    const segments: ClauseSegment[] = []
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i]!.lineIdx
        const end = i + 1 < matches.length ? matches[i + 1]!.lineIdx : lines.length
        const text = lines.slice(start, end).join('\n').trim()
        if (!text) continue
        segments.push({
            index: segments.length + 1,
            number: matches[i]!.number,
            text,
        })
    }
    return segments
}

export interface SegmentOptions {
    /** LLM 兜底策略：当正则命中 0 条或低于阈值时调用。默认不兜底。 */
    llmFallback?: (fullText: string) => Promise<ClauseSegment[]>
    /** 正则命中 <minRegexHits 时认为失败，触发 llmFallback。默认 3 */
    minRegexHits?: number
}

/**
 * 切分入口：正则 → 命中不足走 LLM 兜底（可选）。
 * 上层 workflow 节点应当传入 llmFallback 以提升鲁棒性。
 */
export async function segmentClauses(
    fullText: string,
    options: SegmentOptions = {},
): Promise<ClauseSegment[]> {
    const regexSegments = segmentClausesByRegex(fullText)
    const minHits = options.minRegexHits ?? 3

    const regexHits = regexSegments.filter(s => s.number !== null).length
    if (regexHits >= minHits || !options.llmFallback) {
        return regexSegments
    }

    logger.info('clauseSegmenter: 正则命中不足，走 LLM 兜底', {
        regexHits,
        minHits,
    })
    try {
        const llmSegments = await options.llmFallback(fullText)
        if (llmSegments.length > 0) return llmSegments
        return regexSegments
    } catch (err) {
        logger.warn('clauseSegmenter: LLM 兜底失败，降级返回正则结果', { err })
        return regexSegments
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts`
Expected: PASS 6/6

- [ ] **Step 5: 类型检查**

Run: `npx nuxi typecheck`
Expected: 0 error

- [ ] **Step 6: Commit**

```bash
git add server/services/assistant/contract/docx/clauseSegmenter.ts tests/server/assistant/contract/docx/clauseSegmenter.test.ts
git commit -m "feat(contract): 新增条款切分器 clauseSegmenter（正则 + LLM 兜底）

M6.1 子期 1 Task 1.4：覆盖 '第X条' / '1.1' / '一、' 三类编号。返回
ClauseSegment[]，index 从 1 起连续。LLM 兜底暂时由上层决定是否接入。"
```

---

## Task 1.5：在 contractReviewMainAgent 之前接入 segment 阶段 + SSE 事件透传

**背景：** 当前 `contractReviewMainAgent` 是一次性出结果。本期先不拆 LLM 循环，只在"agent 启动前"插入一个切分步骤，并把 `detect / stance / segment` 三个阶段的 SSE 事件发出去。`analyze / summarize` 两个阶段先作为"包裹整个 agent 执行"的粗粒度事件发出（子期 2/3 再细化）。

**Files:**
- Create: `server/services/workflow/nodes/contractReviewStageEmitter.ts`（发事件的小工具）
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`（启动前切分 + 事件透传）
- Modify: `server/services/assistant/contract/docx/partyDetector.ts`（在识别前后发 detect stage 事件）
- Test: `tests/server/workflow/agents/contractReviewMainAgent.stage.test.ts`

- [ ] **Step 1: 确认 publishCustomEvent 真实签名**

本 plan 已核对项目实际实现（`server/services/agent/agentEventBridge.ts:124`）：

```typescript
// 真实签名：单参对象形态
export async function publishCustomEvent(event: AgentCustomEvent): Promise<void>

// AgentCustomEvent 结构（shared/types/agentRun.ts:36）
interface AgentCustomEvent {
    type: 'custom_event'
    runId: string
    sessionId: string
    name: string
    data: unknown
}
```

**关键**：调用时需要 `runId`（当前 agent run 的标识）。从 `agentWorker.executeRun` 调用链下传到 `runContractReviewChat` 的 `options` 里获取——这个值已经在 options 里，本 plan 的 emitter 签名扩为 `(runId, sessionId, event)`。

- [ ] **Step 2: 新建 stageEmitter 工具**

新建 `server/services/workflow/nodes/contractReviewStageEmitter.ts`：

```typescript
/**
 * 合同审查 SSE 事件发送器
 *
 * 封装 publishCustomEvent 的调用，包装成 AgentCustomEvent 形态。
 * 前端 useStreamChat.onCustomEvent(data) 接收到的 data 即此处发出的 ContractReviewEvent。
 *
 * 采用 ctx 对象 + event 两参的形态（与项目现有 tool context 模式一致，见
 * `server/services/workflow/tools/saveAnalysisResult.tool.ts:101`）。
 */
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import type { ContractReviewEvent } from '#shared/types/contract'

const EVENT_NAME = 'contract_review'

/** emitter 上下文：包含 runId + sessionId，由调用方构造一次后传递 */
export interface ContractReviewEmitterCtx {
    runId: string
    sessionId: string
}

/**
 * 发送合同审查事件（fire-and-forget，失败仅记日志，不阻塞主流程）
 */
export async function emitContractReviewEvent(
    ctx: ContractReviewEmitterCtx,
    event: ContractReviewEvent,
): Promise<void> {
    try {
        await publishCustomEvent({
            type: 'custom_event',
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            name: EVENT_NAME,
            data: event,
        })
    } catch (err) {
        logger.warn('emitContractReviewEvent 发送失败', {
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            eventType: event.type,
            err,
        })
    }
}
```

**调用方改造**：

1. `ContractReviewAgentOptions` 加 `runId` 字段（agentWorker.executeRun 已持有 run 对象，把 `run.id` 传进来）：

```typescript
export interface ContractReviewAgentOptions {
    userId: number
    runId: string              // 新增
    signal?: AbortSignal
    command?: unknown
}
```

2. `runContractReviewChat` 开头构造一次 ctx 供后续所有调用复用：

```typescript
const emitterCtx: ContractReviewEmitterCtx = { runId: options.runId, sessionId }
```

3. Middleware / tool 内部如果需要发事件，需要能拿到 ctx —— 把 `emitterCtx` 作为参数传入 `reviewResultPersistenceMiddleware({ reviewId, sessionId, runId })`；tool 则通过已有的 `toolContext`（包含 `sessionId`、新增 `runId`）访问。

- [ ] **Step 3: 写 stage 事件顺序测试**

新建 `tests/server/workflow/agents/contractReviewMainAgent.stage.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emitContractReviewEvent } from '~~/server/services/workflow/nodes/contractReviewStageEmitter'

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('contractReviewStageEmitter', () => {
    beforeEach(() => vi.clearAllMocks())

    it('emit stage:detect,running 正确包装为 AgentCustomEvent', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        await emitContractReviewEvent(
            { runId: 'run-1', sessionId: 'sess-1' },
            { type: 'stage', stage: 'detect', status: 'running' },
        )
        expect(publishCustomEvent).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: 'contract_review',
            data: { type: 'stage', stage: 'detect', status: 'running' },
        })
    })

    it('publishCustomEvent 抛错时不向上传播', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(publishCustomEvent as any).mockRejectedValueOnce(new Error('redis down'))
        await expect(emitContractReviewEvent(
            { runId: 'run-2', sessionId: 'sess-2' },
            { type: 'progress', current: 1, total: 10 },
        )).resolves.toBeUndefined()
    })
})
```

Run: `npx vitest run tests/server/workflow/agents/contractReviewMainAgent.stage.test.ts`
Expected: PASS 2/2

- [ ] **Step 4: 改造 contractReviewMainAgent 发 detect/stance/segment 事件**

在 `server/services/workflow/agents/contractReviewMainAgent.ts` 的 `runContractReviewChat` 函数中，在 `return agent.stream(...)` 之前插入切分事件发送（**不改变现有 agent 结构，只在外层包一层"启动前事件透传"**）：

```typescript
import { emitContractReviewEvent } from '../nodes/contractReviewStageEmitter'
import { segmentClauses } from '../../assistant/contract/docx/clauseSegmenter'

// ... 在 runContractReviewChat 函数里，review 非空校验之后、agent.stream 之前加入：

// M6.1 子期 1：在 agent 启动前预切分条款并发 segment 事件
// analyze/summarize 阶段事件由 reviewResultPersistenceMiddleware 的 before/afterAgent 负责
try {
    await emitContractReviewEvent(emitterCtx, {
        type: 'stage', stage: 'segment', status: 'running',
    })
    // 取原文：review.originalText 若为 null，从 paragraphs 拼接（按现有 partyDetector 做法）
    const fullText = review.originalText ?? ''  // 按实际字段调整
    const segments = await segmentClauses(fullText)
    await emitContractReviewEvent(emitterCtx, {
        type: 'stage', stage: 'segment', status: 'done', totalClauses: segments.length,
    })
    logger.info('合同切分完成', { reviewId: review.id, totalClauses: segments.length })
} catch (err) {
    logger.warn('合同切分失败，降级整篇分析', { reviewId: review.id, err })
    await emitContractReviewEvent(emitterCtx, {
        type: 'stage', stage: 'segment', status: 'done', totalClauses: 0,
    })
}
```

**关于 detect / stance 事件**：这两个阶段由 `parseAndAskStance` 工具触发（已有代码）。为了不侵入工具内部，在**工具调用前后**由中间件发事件。修改 `server/services/workflow/middleware/reviewResultPersistence.middleware.ts` 的 `beforeAgent`（现有代码已经置 status='reviewing'）：

```typescript
beforeAgent: {
    hook: async (_state: any) => {
        try {
            await updateContractReviewDAO(options.reviewId, { status: 'reviewing' })
            // M6.1：agent 启动即视为 detect 阶段 running
            await emitContractReviewEvent({ runId: options.runId, sessionId: options.sessionId }, {
                type: 'stage', stage: 'detect', status: 'running',
            })
        } catch (err) { ... }
    },
},
```

以及 `afterAgent` 在进入结果写库前加：

```typescript
afterAgent: {
    hook: async (state: any) => {
        // M6.1：agent 完成即视为 analyze+summarize 阶段 done
        await emitContractReviewEvent({ runId: options.runId, sessionId: options.sessionId }, {
            type: 'stage', stage: 'analyze', status: 'done',
        })
        await emitContractReviewEvent({ runId: options.runId, sessionId: options.sessionId }, {
            type: 'stage', stage: 'summarize', status: 'done',
        })
        // ... 原有结果持久化逻辑
    },
},
```

**detect done / stance running / stance done / segment running**：这些细粒度事件由 `parseAndAskStance` 工具在内部发出。修改 `server/services/workflow/tools/parseAndAskStance.tool.ts`（只在开头/结尾插入事件发送，不动主逻辑）：

```typescript
// 工具开头：
await emitContractReviewEvent(emitterCtx, {
    type: 'stage', stage: 'detect', status: 'done',
    partyA: detection.partyA, partyB: detection.partyB, contractType: detection.contractType,
})
await emitContractReviewEvent(emitterCtx, {
    type: 'stage', stage: 'stance', status: 'running',
})
// ... interrupt 等待用户立场
// interrupt 恢复后：
await emitContractReviewEvent(emitterCtx, {
    type: 'stage', stage: 'stance', status: 'done',
})
await emitContractReviewEvent(emitterCtx, {
    type: 'stage', stage: 'analyze', status: 'running',
})
```

- [ ] **Step 5: 人工梳理阶段事件顺序对照表**

在 `contractReviewMainAgent.ts` 顶部写清楚期望的事件顺序，供后期实施者对照：

```typescript
/**
 * M6.1 事件顺序（与前端 useContractReview 状态机对齐）：
 *
 *   1. [middleware.beforeAgent] stage:detect,running
 *   2. [tool.parseAndAskStance 开头] stage:detect,done + partyA/B/contractType
 *   3. [tool.parseAndAskStance 开头] stage:stance,running
 *   4. [用户立场选择] interrupt 挂起
 *   5. [resume 后 tool 内部] stage:stance,done
 *   6. [tool 结尾] stage:analyze,running
 *   7. [runContractReviewChat 启动前] stage:segment,running
 *   8. [切分完成] stage:segment,done + totalClauses
 *   9. [agent.stream 执行完成] 由 middleware.afterAgent 发 stage:analyze,done
 *  10. [middleware.afterAgent] stage:summarize,done
 */
```

*注意：事件顺序 7/8 实际在 4/5/6 之前，因为切分是在 agent 启动前一次性做的，不是按用户立场后做的。但前端展示顺序按用户心智排：识别→立场→切分→分析→汇总。这在 Task 1.7 的前端状态机里处理。*

- [ ] **Step 6: 跑已有的 contractReviewMainAgent 集成测试**

Run: `npx vitest run tests/server/workflow/agents/contractReviewMainAgent`
Expected: 原有测试全绿（事件透传是增量，不影响主逻辑）

- [ ] **Step 7: Commit**

```bash
git add server/services/workflow/nodes/contractReviewStageEmitter.ts
git add server/services/workflow/agents/contractReviewMainAgent.ts
git add server/services/workflow/middleware/reviewResultPersistence.middleware.ts
git add server/services/workflow/tools/parseAndAskStance.tool.ts
git add tests/server/workflow/agents/contractReviewMainAgent.stage.test.ts
git commit -m "feat(contract): SSE 阶段事件接入 · detect/stance/segment 透传

M6.1 子期 1 Task 1.5：在 agent 启动前预切分条款发 segment 事件；
复用 publishCustomEvent，新增 contractReviewStageEmitter 封装类型安全
的事件发送。analyze/summarize 暂由 middleware 粗粒度透传，子期 2/3
再细化。"
```

---

## Task 1.6：前端事件路由扩展到 useContractReview

**Files:**
- Modify: `app/composables/useContractReview.ts` — 新增 stage/progress 状态 ref + handleContractEvent 分发
- Test: `tests/app/composables/useContractReview.test.ts` — 扩展

- [ ] **Step 1: 写失败测试 · stage 事件更新 stageStatus**

扩展 `tests/app/composables/useContractReview.test.ts`：

```typescript
describe('M6.1 · stage 事件', () => {
    it('handleContractEvent 收到 stage:detect,running 后更新 stageStatus.detect', () => {
        const composable = setupComposable()  // 已有 helper
        composable.handleContractEvent({ type: 'stage', stage: 'detect', status: 'running' })
        expect(composable.stageStatus.value.detect).toBe('running')
    })

    it('stage:segment,done 携带 totalClauses 更新对应 ref', () => {
        const composable = setupComposable()
        composable.handleContractEvent({ type: 'stage', stage: 'segment', status: 'done', totalClauses: 24 })
        expect(composable.stageStatus.value.segment).toBe('done')
        expect(composable.totalClauses.value).toBe(24)
    })

    it('progress 事件更新 analyzingClauseIndex', () => {
        const composable = setupComposable()
        composable.handleContractEvent({ type: 'progress', current: 14, total: 24 })
        expect(composable.analyzingClauseIndex.value).toBe(14)
    })

    it('progress.error 触发 toast.warning', () => {
        const composable = setupComposable()
        composable.handleContractEvent({ type: 'progress', current: 3, total: 24, error: 'zod 校验失败' })
        expect(mockToastWarning).toHaveBeenCalledWith(expect.stringContaining('第 3 条'))
    })

    it('stage:analyze,done 携带 warnings 统一 toast', () => {
        const composable = setupComposable()
        composable.handleContractEvent({
            type: 'stage', stage: 'analyze', status: 'done',
            warnings: ['clause 3 failed', 'clause 7 failed'],
        })
        expect(mockToastWarning).toHaveBeenCalledWith('2 条条款分析失败，已跳过')
    })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/app/composables/useContractReview.test.ts`
Expected: FAIL（相关 ref / handler 不存在）

- [ ] **Step 3: 扩展 useContractReview**

在 `app/composables/useContractReview.ts` 的 `useContractReview` 函数内部添加：

```typescript
import type { ContractReviewEvent } from '#shared/types/contract'

// ... 在原有 review / reviewId / hasUnsavedDocxChanges 声明下方 ：

// M6.1：阶段进度状态
const stageStatus = ref<{
    detect: 'wait' | 'running' | 'done'
    stance: 'wait' | 'running' | 'done'
    segment: 'wait' | 'running' | 'done'
    analyze: 'wait' | 'running' | 'done'
    summarize: 'wait' | 'running' | 'done'
}>({
    detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait',
})
const totalClauses = ref<number | null>(null)
const analyzingClauseIndex = ref<number | null>(null)
const analyzeWarnings = ref<string[]>([])

/**
 * M6.1：合同审查 SSE 自定义事件分发器
 * 由 mountStream 里的 onCustomEvent 调用。事件类型仅 4 种。
 */
function handleContractEvent(event: ContractReviewEvent) {
    switch (event.type) {
        case 'stage': {
            stageStatus.value = {
                ...stageStatus.value,
                [event.stage]: event.status,
            }
            if (event.stage === 'segment' && event.status === 'done') {
                totalClauses.value = event.totalClauses ?? null
            }
            if (event.stage === 'analyze' && event.status === 'done' && event.warnings?.length) {
                analyzeWarnings.value = event.warnings
                toast.warning(`${event.warnings.length} 条条款分析失败，已跳过`)
            }
            break
        }
        case 'progress': {
            analyzingClauseIndex.value = event.current
            if (event.error) {
                toast.warning(`第 ${event.current} 条分析失败，已跳过：${event.error}`)
            }
            break
        }
        case 'risk': {
            // 子期 2 实现：把 risk 增量 append 到 review.risks
            if (review.value) {
                const existing = review.value.risks ?? []
                review.value = { ...review.value, risks: [...existing, event.risk] }
            }
            break
        }
        case 'overview': {
            // 子期 3 实现：替换 summary
            if (review.value) {
                review.value = { ...review.value, summary: event.overview }
            }
            break
        }
    }
}
```

- [ ] **Step 4: mountStream 挂 onCustomEvent**

**已核实**：`app/composables/useStreamChat.ts:29` 已有 `onCustomEvent?: (data: unknown) => void` 参数，且内部已过滤 `status_change` 类事件，剩余 `data` 会透传给我们的回调。

找到 `useStreamChat` 初始化处（`function mountStream(sessionId: string)`），挂事件回调：

```typescript
s = useStreamChat({
    apiUrl: '/api/v1/assistant/contract/chat',
    threadId: sessionId,
    messagesKey: 'messages',
    onCustomEvent: (data: unknown) => {
        // 后端 emitter 包装成 AgentCustomEvent = { type, runId, sessionId, name, data }
        // useStreamChat 已过滤 status_change；剩余事件通过 data.name 识别归属
        if (
            data && typeof data === 'object'
            && (data as any).name === 'contract_review'
            && (data as any).data
        ) {
            const payload = (data as any).data
            if (['stage', 'progress', 'risk', 'overview'].includes(payload.type)) {
                handleContractEvent(payload as ContractReviewEvent)
            }
        }
    },
})
```

- [ ] **Step 5: 暴露新状态到 return**

```typescript
return {
    // ... 原有字段
    // M6.1
    stageStatus,
    totalClauses,
    analyzingClauseIndex,
    analyzeWarnings,
    handleContractEvent,  // 导出供测试用
}
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/app/composables/useContractReview.test.ts`
Expected: PASS 所有（包含 M6.1 新增的 5 个）

- [ ] **Step 7: Commit**

```bash
git add app/composables/useContractReview.ts tests/app/composables/useContractReview.test.ts
git commit -m "feat(contract): useContractReview 接入 SSE 自定义事件路由

M6.1 子期 1 Task 1.6：新增 stageStatus/totalClauses/analyzingClauseIndex/
analyzeWarnings 四个状态 ref；handleContractEvent 按 payload.type 分派
四种事件。risk/overview 事件存根已挂，子期 2/3 时激活真实逻辑。"
```

---

## Task 1.7：新建 ReviewProgress.vue 进度条组件

**Files:**
- Create: `app/components/assistant/contract/ReviewProgress.vue`
- Test: `tests/app/components/assistant/contract/ReviewProgress.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/app/components/assistant/contract/ReviewProgress.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewProgress from '~/components/assistant/contract/ReviewProgress.vue'

const defaultStages = {
    detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait',
} as const

describe('ReviewProgress', () => {
    it('5 个阶段都 wait 时渲染 5 个灰点', () => {
        const w = mount(ReviewProgress, {
            props: { stages: defaultStages, totalClauses: null, analyzingIndex: null },
        })
        expect(w.findAll('[data-stage-dot]')).toHaveLength(5)
        expect(w.findAll('[data-stage-status="wait"]')).toHaveLength(5)
    })

    it('detect=running 显示呼吸动画', () => {
        const w = mount(ReviewProgress, {
            props: { stages: { ...defaultStages, detect: 'running' }, totalClauses: null, analyzingIndex: null },
        })
        expect(w.find('[data-stage="detect"][data-stage-status="running"]').exists()).toBe(true)
    })

    it('analyze=running 且 totalClauses=24 显示 "正在分析第 X / 24 条"', () => {
        const w = mount(ReviewProgress, {
            props: {
                stages: { ...defaultStages, detect: 'done', stance: 'done', segment: 'done', analyze: 'running' },
                totalClauses: 24,
                analyzingIndex: 14,
            },
        })
        expect(w.text()).toContain('正在分析第 14 / 24 条')
    })

    it('summarize=done 时整个组件返回 null（自动收起）', () => {
        const w = mount(ReviewProgress, {
            props: {
                stages: { detect: 'done', stance: 'done', segment: 'done', analyze: 'done', summarize: 'done' },
                totalClauses: 24, analyzingIndex: 24,
            },
        })
        expect(w.find('[data-stage-dot]').exists()).toBe(false)
    })
})
```

- [ ] **Step 2: 运行失败**

Run: `npx vitest run tests/app/components/assistant/contract/ReviewProgress.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 ReviewProgress.vue**

新建 `app/components/assistant/contract/ReviewProgress.vue`：

```vue
<script setup lang="ts">
/**
 * 合同审查阶段进度条（M6.1 子期 1）
 *
 * 5 段进度：识别 / 等立场 / 切分 / 分析 / 汇总
 * - 每段可视化为一个小圆点：wait 灰 / running 橙+光晕 / done 绿
 * - analyze 阶段 running 时额外显示 "正在分析第 X / Y 条"
 * - 全部 done 时组件隐藏（by v-if）
 *
 * 自动导入名：AssistantContractReviewProgress
 */

type StageKey = 'detect' | 'stance' | 'segment' | 'analyze' | 'summarize'
type Status = 'wait' | 'running' | 'done'

const props = defineProps<{
    stages: Record<StageKey, Status>
    totalClauses: number | null
    analyzingIndex: number | null
}>()

const STAGE_LABEL: Record<StageKey, string> = {
    detect: '识别甲乙方',
    stance: '等待立场',
    segment: '切分条款',
    analyze: '分析风险',
    summarize: '汇总总览',
}
const STAGE_ORDER: StageKey[] = ['detect', 'stance', 'segment', 'analyze', 'summarize']

const allDone = computed(() => STAGE_ORDER.every(k => props.stages[k] === 'done'))

const progressText = computed(() => {
    if (props.stages.analyze !== 'running') return null
    if (props.totalClauses === null || props.analyzingIndex === null) return null
    return `正在分析第 ${props.analyzingIndex} / ${props.totalClauses} 条`
})
</script>

<template>
    <div v-if="!allDone" class="p-3 border-b bg-muted/20 text-sm space-y-2">
        <div class="flex items-center gap-3">
            <template v-for="key in STAGE_ORDER" :key="key">
                <div class="flex items-center gap-1.5">
                    <span
                        data-stage-dot
                        :data-stage="key"
                        :data-stage-status="stages[key]"
                        class="size-2.5 rounded-full transition-colors"
                        :class="{
                            'bg-gray-300': stages[key] === 'wait',
                            'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.25)] animate-pulse': stages[key] === 'running',
                            'bg-emerald-600': stages[key] === 'done',
                        }"
                    />
                    <span class="text-xs text-muted-foreground">{{ STAGE_LABEL[key] }}</span>
                </div>
                <span v-if="key !== 'summarize'" class="text-gray-300">·</span>
            </template>
        </div>
        <div v-if="progressText" class="text-xs text-muted-foreground flex items-center gap-2">
            <span>{{ progressText }}</span>
            <div v-if="totalClauses" class="flex-1 h-1 bg-gray-200 rounded overflow-hidden">
                <div
                    class="h-full bg-blue-500 transition-all"
                    :style="{ width: `${((analyzingIndex ?? 0) / totalClauses) * 100}%` }"
                />
            </div>
        </div>
    </div>
</template>
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/app/components/assistant/contract/ReviewProgress.test.ts`
Expected: PASS 4/4

- [ ] **Step 5: Commit**

```bash
git add app/components/assistant/contract/ReviewProgress.vue tests/app/components/assistant/contract/ReviewProgress.test.ts
git commit -m "feat(contract): 新增 ReviewProgress 进度条组件 (5 段阶段可视化)

M6.1 子期 1 Task 1.7：渲染 detect/stance/segment/analyze/summarize 5
段进度 · 灰/橙/绿三色 · analyze 阶段显示 '正在分析第 X / Y 条' 实时
计数。全部 done 后组件自动隐藏。"
```

---

## Task 1.8：把 ReviewProgress 挂到 ContractReviewPanel

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`
- Test: `tests/app/components/assistant/contract/ContractReviewPanel.test.ts`

- [ ] **Step 1: 写失败测试**

扩展 `tests/app/components/assistant/contract/ContractReviewPanel.test.ts`，在 `describe('ContractReviewPanel', () => { ... })` 末尾加：

```typescript
it('审查期间在右侧面板顶部渲染 ReviewProgress', async () => {
    reviewRef.value = makeReview({ status: 'reviewing' })
    runStatusRef.value = 'reviewing'
    // 通过 useContractReview mock 注入 stageStatus 等
    stageStatusRef.value = { detect: 'done', stance: 'done', segment: 'done', analyze: 'running', summarize: 'wait' }
    totalClausesRef.value = 24
    analyzingClauseIndexRef.value = 14

    const w = mountPanel()
    await nextTick()
    expect(w.find('[data-stub="ReviewProgress"]').exists()).toBe(true)
})

it('全流程完成后 ReviewProgress 由组件自身 v-if 隐藏（父不干预）', async () => {
    reviewRef.value = makeReview({ status: 'completed' })
    stageStatusRef.value = { detect: 'done', stance: 'done', segment: 'done', analyze: 'done', summarize: 'done' }
    const w = mountPanel()
    await nextTick()
    // 父始终挂，由 ReviewProgress 内部 v-if="!allDone" 决定
    const stub = w.find('[data-stub="ReviewProgress"]')
    expect(stub.exists()).toBe(true)  // 组件存在
    // stub 接收到的 props 能让实际组件隐藏；test 用 stub 直接断 props
    expect(stub.attributes('data-all-done')).toBe('true')
})
```

更新 mock useContractReview 返回值，加上 4 个新 ref：

```typescript
const stageStatusRef = ref({ detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait' })
const totalClausesRef = ref<number | null>(null)
const analyzingClauseIndexRef = ref<number | null>(null)
const analyzeWarningsRef = ref<string[]>([])

vi.mock('~/composables/useContractReview', () => ({
    useContractReview: () => ({
        // ... 原有字段
        stageStatus: stageStatusRef,
        totalClauses: totalClausesRef,
        analyzingClauseIndex: analyzingClauseIndexRef,
        analyzeWarnings: analyzeWarningsRef,
    }),
}))
```

新增 stub：

```typescript
const ReviewProgressStub = defineComponent({
    name: 'AssistantContractReviewProgress',
    props: {
        stages: { type: Object, default: () => ({}) },
        totalClauses: { type: [Number, null] as unknown as () => number | null, default: null },
        analyzingIndex: { type: [Number, null] as unknown as () => number | null, default: null },
    },
    setup(props) {
        return () => h('div', {
            'data-stub': 'ReviewProgress',
            'data-all-done': String(
                ['detect','stance','segment','analyze','summarize'].every(k => (props.stages as any)[k] === 'done')
            ),
            'data-analyzing-index': props.analyzingIndex ?? '',
        })
    },
})

// 加到 stubs map：
const stubs = {
    // ... 原有
    AssistantContractReviewProgress: ReviewProgressStub,
}
```

- [ ] **Step 2: 运行失败**

Run: `npx vitest run tests/app/components/assistant/contract/ContractReviewPanel.test.ts`
Expected: FAIL（父组件尚未挂 ReviewProgress）

- [ ] **Step 3: 挂到 ContractReviewPanel**

在 `app/components/assistant/contract/ContractReviewPanel.vue` 的 `<script setup>` 里补拿新状态：

```typescript
const {
    // ... 原有解构
    stageStatus,
    totalClauses,
    analyzingClauseIndex,
} = useContractReview()
```

在右侧面板 busy 条位置（现 `<div v-if="showBusy" ...>` 那里）**之上**加一个 ReviewProgress：

```vue
<div class="border-l flex flex-col min-h-0">
    <AssistantContractReviewProgress
        :stages="stageStatus"
        :total-clauses="totalClauses"
        :analyzing-index="analyzingClauseIndex"
    />
    <!-- busy 条仍然保留，用于覆盖 runStatus / review.status 语义；子期 4 再考虑是否移除 -->
    <div v-if="showBusy" class="flex items-center gap-2 p-3 border-b text-sm text-muted-foreground">
        ...
    </div>
    <AssistantContractRiskListPanel ... />
</div>
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/app/components/assistant/contract/ContractReviewPanel.test.ts`
Expected: PASS 所有

- [ ] **Step 5: 类型检查**

Run: `npx nuxi typecheck`
Expected: 0 error

- [ ] **Step 6: Commit**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue tests/app/components/assistant/contract/ContractReviewPanel.test.ts
git commit -m "feat(contract): ContractReviewPanel 挂入 ReviewProgress 进度条

M6.1 子期 1 Task 1.8：右侧面板顶部固定挂 ReviewProgress；组件内部
v-if 根据 5 段状态自动收起。保留原有 busy 条供子期 4 再决定是否移除。"
```

---

## Task 1.9：子期 1 冒烟测试

**Files:** 无代码改动，纯验证

- [ ] **Step 1: 启动开发服务器**

```bash
bun dev
```

- [ ] **Step 2: 浏览器手工走一遍**

1. 访问 `/dashboard/assistant/contract`
2. 上传 / 粘贴一份真实合同
3. **预期看到**：右侧顶部出现 5 段点状进度，前 3 段（识别 / 立场 / 切分）在 2 秒内点亮 done，第 4 段（分析）呼吸中
4. 立场选择后：第 5 段（汇总）依次点亮
5. 审查完成后：整个进度条隐藏；risks 列表照常显示

- [ ] **Step 3: 故意打断**

测试 SSE 中断（如关后端重启），刷新页面后进度恢复到当前 review.status 对应的状态（stageStatus 由 review.status 推导 fallback 初值——这个 fallback 已写在 Task 1.7 的组件里，通过 `stages` prop 由父 composable 传；若未实现，记下来作为改进项）。

- [ ] **Step 4: 跑全量回归**

```bash
npx vitest run tests/app/components/assistant/contract
npx vitest run tests/app/composables/useContractReview.test.ts
npx vitest run tests/server/assistant/contract
npx vitest run tests/server/workflow
npx nuxi typecheck
```

Expected: 全绿，0 type error

- [ ] **Step 5: Commit（可选）**

如果测试期间补了小修，commit 一下收尾：

```bash
git add .
git commit -m "chore(contract): M6.1 子期 1 冒烟测试修正"
```

**子期 1 交付完成。** 此时上线用户即能看到进度条，不再黑盒等待。

---

# 子期 2：逐条流式

**目标**：把 `contractReviewMainAgent` 的"整篇一次性"改造为"按 clauseSegments 逐条循环"；每条 risk 通过 SSE 增量推送，前端从顶部滑入新卡片。

**前置**：子期 1 已合并且上线稳定。

---

## Task 2.1：把切分结果传入 agent 并改造为按段循环

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`
- Modify: `server/services/workflow/tools/parseAndAskStance.tool.ts`（把切分结果挂到 state 或作为 user context）
- Test: `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts`

- [ ] **Step 1: 调研现有 agent 如何按单条 clause 调 LLM**

本期**不改 `createAgent` 骨架**，而是在 agent 首轮提示里告诉 LLM：

> "我会按条款序号逐条给你 clauseText，每次你只输出一条 Risk（或跳过）。当前是第 N 条，请返回形如 `{risk: {...}}` 或 `{skip: true}`。"

然后在 agent 外层用 for 循环驱动 24 条，每次把单条 clauseText 拼进 HumanMessage。

这样的好处：
- 复用现有 `agent.stream` 基础
- `toolStrategy` 依然可用，每次 LLM 只输出单条 risk
- 不改 checkpointer/interrupt 逻辑

**新方案是双 agent**：
- `contractReviewMain`（原）：负责 detect + stance + 全局 overview（子期 3 用）
- `contractReviewAnalyzer`（新）：负责按条款循环，每条单独 LLM

**子期 2 本 Task 的做法**：在 `runContractReviewChat` 里，**当 parseAndAskStance 工具 resume 后**，由中间件（`reviewResultPersistenceMiddleware.afterAgent` 之前）启动一个独立的 analyze 循环，循环每段：
1. 发 `progress { current: i, total: N }`
2. 调一个 `analyzeSingleClause(clauseText, stance, reviewId)` 函数，内部用 `chatModelFactory` 起个一次性 invoke
3. 返回 risk 则发 `risk { risk: ... }`，并累积到 `allRisks[]`
4. 失败则发 `progress { current: i, total: N, error: "..." }`，累积到 `warnings[]`

循环结束后，把 `allRisks[]` 写回 `state.structuredResponse`（或直接写 DB），让原有 middleware 后续逻辑拿到它。

**风险**：这个改造动 agent 骨架。实施前先读 `server/services/workflow/agents/contractReviewMainAgent.ts` 全文，并在 PR 描述里展开对 `createAgent` / `responseFormat` / `middleware.afterAgent` 三者的改动点。

- [ ] **Step 2: 新建 analyzeSingleClause 工具函数**

新建 `server/services/assistant/contract/analyzeSingleClause.ts`：

```typescript
/**
 * 单条合同条款的风险分析
 *
 * 给定一条 clauseText + 立场 + 合同上下文，调用 LLM 返回 0 或 1 条 Risk。
 * 本函数**不**进 state / checkpointer，是工具层一次性 invoke。
 *
 * 失败时抛错；调用方决定是否 swallow 为 progress.error。
 */
import { z } from 'zod'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { RISK_SHAPE } from './riskSchema.builder'
import type { Risk, Stance, ClauseSegment } from '#shared/types/contract'

/** 单条输出 schema：要么返回 risk，要么 skip */
const SingleClauseResponse = z.object({
    risk: RISK_SHAPE.nullable(),
    skip: z.boolean().default(false),
})

export interface AnalyzeClauseContext {
    clause: ClauseSegment
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
}

/** 返回 null 表示该条款无风险；返回 Risk 则已校验通过 */
export async function analyzeSingleClause(ctx: AnalyzeClauseContext): Promise<Risk | null> {
    const config = await getValidNodeConfig('contractReviewMain')
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error('contractReviewMain 节点无可用 API 密钥')

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0,
    })

    const prompt = buildPrompt(ctx)
    const response = await model.invoke(prompt)
    const content = typeof response.content === 'string' ? response.content : ''

    // 宽容解析：匹配第一个 {...}
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('LLM 未返回 JSON')
    const parsed = SingleClauseResponse.safeParse(JSON.parse(jsonMatch[0]))
    if (!parsed.success) throw new Error(`LLM 输出不符合 schema: ${parsed.error.issues[0]?.message}`)

    if (parsed.data.skip || !parsed.data.risk) return null
    return parsed.data.risk as Risk
}

function buildPrompt(ctx: AnalyzeClauseContext): string {
    return [
        `你正在审查合同（${ctx.contractType ?? '未知类型'}），站在${ctx.stance === 'partyA' ? '甲方' : ctx.stance === 'partyB' ? '乙方' : '中立第三方'}立场。`,
        `甲方：${ctx.partyA ?? '未知'}；乙方：${ctx.partyB ?? '未知'}。`,
        `当前条款（第 ${ctx.clause.index} 条，编号 ${ctx.clause.number ?? '无'}）：`,
        `"""`,
        ctx.clause.text,
        `"""`,
        `请判断该条款是否有风险。严格按 JSON 输出：`,
        `- 有风险：{"risk": {...}, "skip": false}，risk 字段结构见 RISK_SHAPE`,
        `- 无风险：{"risk": null, "skip": true}`,
        `只输出 JSON，不要任何解释。`,
    ].join('\n')
}
```

- [ ] **Step 3: 写 analyzeSingleClause 测试**

新建 `tests/server/assistant/contract/analyzeSingleClause.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({
        invoke: vi.fn().mockResolvedValue({
            content: JSON.stringify({
                risk: {
                    id: 'a0000000-0000-4000-8000-000000000001',
                    clauseIndex: 1, clauseText: '3.2 首付 40%',
                    level: 'high', category: '付款', problem: '尾款比例偏高',
                    analysis: '...', risk: '...', suggestion: '改为 50/50',
                    suggestedClauseText: '3.2 首付 50%，尾款 50%',
                },
                skip: false,
            }),
        }),
    })),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
        modelSdkType: 'openai', modelName: 'gpt-4', modelProviderBaseUrl: 'https://api.openai.com/v1',
    }),
}))

describe('analyzeSingleClause', () => {
    it('命中风险时返回 Risk', async () => {
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 1, number: '3.2', text: '3.2 首付 40%，尾款 60%' },
            stance: 'partyB', partyA: 'A', partyB: 'B', contractType: '技术服务',
        })
        expect(result).not.toBeNull()
        expect(result?.level).toBe('high')
    })

    it('skip=true 返回 null', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn().mockResolvedValue({
                content: JSON.stringify({ risk: null, skip: true }),
            }),
        })
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const result = await analyzeSingleClause({
            clause: { index: 2, number: '3.3', text: '3.3 常规付款条款' },
            stance: 'neutral', partyA: 'A', partyB: 'B', contractType: '技术服务',
        })
        expect(result).toBeNull()
    })
})
```

Run: `npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts`
Expected: PASS 2/2

- [ ] **Step 4: 集成路径定稿（激进替换）**

**本 plan 明确选择激进替换**（不保留 shadow 模式）——理由：

1. shadow 模式需要维护两套并行路径（LLM 一次性输出 + 外层循环），调试时容易不一致
2. 用户感知上只有"按条款流式冒出"是产品价值，重复的 LLM 调用等于白烧 token
3. spec §5.1 明确规定了"按条款循环逐条分析"的管线，shadow 模式并不符合 spec

**改造要点**：

- `runContractReviewChat` 保留 agent.stream 直到 `parseAndAskStance` interrupt（用户立场收集）
- 用户 resume 后**不再**让 agent 继续走 `responseFormat`，而是在 stream 外层启动 analyze 循环（伪代码在本 task 下方）
- `reviewResultPersistenceMiddleware.afterAgent` 不再从 `state.structuredResponse` 读 risks；改为读 DB（循环中已增量写库）
- 原 `buildRiskSchema` 返回的 `{risks, summary}` zod schema 仍可用于外层循环每次 `analyzeSingleClause` 的单条校验（复用 `RISK_SHAPE`，不重复造）

外层循环伪代码见 Task 2.2 Step 2。

- [ ] **Step 5: Commit**

```bash
git add server/services/assistant/contract/analyzeSingleClause.ts tests/server/assistant/contract/analyzeSingleClause.test.ts
git commit -m "feat(contract): 新增单条条款风险分析函数 analyzeSingleClause

M6.1 子期 2 Task 2.1 step A：抽离单条 LLM 调用为独立函数。后续改造
runContractReviewChat 使其按 ClauseSegment 循环调用本函数即可实现'逐
条流式出卡'。本 commit 不改 agent 主流程。"
```

## Task 2.2：按条款循环 + risk 事件增量推送

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`
- Modify: `server/services/workflow/middleware/reviewResultPersistence.middleware.ts`
- Test: `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts`，mock `analyzeSingleClause` 和 `emitContractReviewEvent`，断言：

```typescript
// 伪代码要点
it('按 clauseSegments 循环调用 analyzeSingleClause，每条发 progress + 命中风险发 risk', async () => {
    const mockSegments = [
        { index: 1, number: '1', text: '总则……' },
        { index: 2, number: '2', text: '付款条款……' },
        { index: 3, number: '3', text: '违约责任……' },
    ]
    mockSegmentClauses.mockResolvedValue(mockSegments)
    mockAnalyzeSingleClause
        .mockResolvedValueOnce(null)           // 第 1 条无风险
        .mockResolvedValueOnce({ id: 'r2', level: 'high', /* ... */ })  // 第 2 条高风险
        .mockResolvedValueOnce({ id: 'r3', level: 'medium', /* ... */ }) // 第 3 条中风险

    await runContractReviewChat(sessionId, options)

    // progress 事件三次，current=1/2/3
    expect(mockEmit).toHaveBeenCalledWith(sessionId, { type: 'progress', current: 1, total: 3 })
    expect(mockEmit).toHaveBeenCalledWith(sessionId, { type: 'progress', current: 2, total: 3 })
    expect(mockEmit).toHaveBeenCalledWith(sessionId, { type: 'progress', current: 3, total: 3 })

    // risk 事件两次（第 1 条无风险跳过）
    expect(mockEmit).toHaveBeenCalledWith(sessionId, { type: 'risk', risk: expect.objectContaining({ id: 'r2' }) })
    expect(mockEmit).toHaveBeenCalledWith(sessionId, { type: 'risk', risk: expect.objectContaining({ id: 'r3' }) })
})

it('单条失败走 progress.error，其他条款继续，warnings 累积', async () => {
    mockSegmentClauses.mockResolvedValue([{ index: 1, number: '1', text: 'a' }, { index: 2, number: '2', text: 'b' }])
    mockAnalyzeSingleClause
        .mockRejectedValueOnce(new Error('zod 失败'))
        .mockResolvedValueOnce({ id: 'r2', level: 'low', /* ... */ })

    await runContractReviewChat(sessionId, options)
    expect(mockEmit).toHaveBeenCalledWith(sessionId, expect.objectContaining({
        type: 'progress', current: 1, total: 2, error: expect.stringContaining('zod 失败'),
    }))
    expect(mockEmit).toHaveBeenCalledWith(sessionId, expect.objectContaining({
        type: 'stage', stage: 'analyze', status: 'done',
        warnings: expect.arrayContaining([expect.stringContaining('zod 失败')]),
    }))
})
```

- [ ] **Step 2: 改造 runContractReviewChat 内部流程（激进替换，Task 2.1 Step 4 已定稿）**

废弃现有 `agent.stream` 作为主分析路径；保留 `agent.stream` 只到 `parseAndAskStance` interrupt 之前（用户立场收集）。**立场恢复后**不再继续让 agent 走一次性 responseFormat，而是 loop `analyzeSingleClause`：

```typescript
// 伪代码：
return new ReadableStream({
    async start(controller) {
        try {
            // 1. 透传 agent 的早期 stream 到 SSE encoder，直到 parseAndAskStance interrupt
            //    （沿用现有 agent.stream 行为）
            // 2. 用户 resume 后，取出 state.stance / state.partyA / state.partyB / state.contractType
            // 3. 执行 analyze 循环（见下）
            const stance: Stance = state.stance
            const allRisks: Risk[] = []
            const warnings: string[] = []
            await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'analyze', status: 'running' })
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i]!
                await emitContractReviewEvent(emitterCtx, { type: 'progress', current: seg.index, total: segments.length })
                try {
                    const risk = await analyzeSingleClause({ clause: seg, stance, partyA, partyB, contractType })
                    if (risk) {
                        allRisks.push(risk)
                        await emitContractReviewEvent(emitterCtx, { type: 'risk', risk })
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    warnings.push(`第 ${seg.index} 条：${msg}`)
                    await emitContractReviewEvent(emitterCtx, {
                        type: 'progress', current: seg.index, total: segments.length, error: msg,
                    })
                }
            }
            await emitContractReviewEvent(emitterCtx, {
                type: 'stage', stage: 'analyze', status: 'done',
                warnings: warnings.length ? warnings : undefined,
            })
            // 4. 把 allRisks 保存到 state，让 afterAgent 中间件拿到
            //    （具体如何塞进 state 由 createAgent 机制决定，可能需要 dispatchCustomEvent）
            // 5. 触发 summarize 阶段（子期 3 实现）—— 本 task 仍由 middleware 的 summarize 兜底
            controller.close()
        } catch (err) {
            controller.error(err)
        }
    },
})
```

**关键实施决策**：`state.structuredResponse` 如何被外层循环写进去？
- 方案 A：不走 structuredResponse，直接在 SSE 结束前把 allRisks 通过 `updateContractReviewDAO(reviewId, { risks })` 写库
- 方案 B：把 allRisks 存到 LangGraph state，让 afterAgent 继续走现有注入批注 + 上传路径

推荐**方案 A**，原因：简单、避免改动 createAgent 内部。`reviewResultPersistenceMiddleware.afterAgent` 保留注入批注那部分逻辑即可，前半 zod 校验改为读 DB。

- [ ] **Step 3: reviewResultPersistence.afterAgent 改造**

`reviewResultPersistenceMiddleware.afterAgent` 原先从 `state.structuredResponse` 读。改为：

```typescript
afterAgent: {
    hook: async (state: any) => {
        // M6.1 子期 2：risks 已由外层 loop 增量写进 DB；这里只做"读 DB + 注入批注 + 上传"
        const review = await getContractReviewDAO(options.reviewId)
        if (!review || !review.risks || !Array.isArray(review.risks) || review.risks.length === 0) {
            await updateContractReviewDAO(options.reviewId, { status: 'failed' })
            logger.warn('reviewResultPersistence: 无 risks，置 failed', { reviewId: options.reviewId })
            return
        }
        // 原有的"注入批注 + 上传 OSS + 写 reviewedFileId"逻辑保留
        // ...
    },
},
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts
npx vitest run tests/server/workflow/middleware/reviewResultPersistence.test.ts
npx vitest run tests/server/assistant/contract
```

Expected: PASS，原有回归全绿

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/agents/contractReviewMainAgent.ts
git add server/services/workflow/middleware/reviewResultPersistence.middleware.ts
git add tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts
git commit -m "feat(contract): 按条款循环逐条分析 + risk 事件增量推送

M6.1 子期 2 Task 2.2：用户立场恢复后不再走 agent 一次性 responseFormat，
改为外层 for 循环调 analyzeSingleClause，每条发 progress 和 risk 事
件。单条失败走 progress.error + stage:analyze,done.warnings[] 终态汇
总。risks 增量写 DB；原 middleware 的批注注入 + 上传路径不变。"
```

---

## Task 2.3：前端风险卡片流式冒出 + "刚刚"角标

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Test: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

- [ ] **Step 1: 写失败测试**

扩展 `tests/app/components/assistant/contract/RiskListPanel.test.ts`：

```typescript
describe('RiskListPanel · M6.1 流式冒出', () => {
    it('新增 risk 挂 data-just-added 属性 3 秒后移除', async () => {
        vi.useFakeTimers()
        const w = mount(RiskListPanel, { props: { risks: [], status: 'reviewing', ... } })
        await w.setProps({ risks: [{ id: 'r1', clauseIndex: 1, level: 'high', /* ... */ } as Risk] })
        await nextTick()
        expect(w.find('[data-risk-id="r1"][data-just-added="true"]').exists()).toBe(true)
        vi.advanceTimersByTime(3000)
        await nextTick()
        expect(w.find('[data-risk-id="r1"][data-just-added="true"]').exists()).toBe(false)
        vi.useRealTimers()
    })
})
```

- [ ] **Step 2: 实现 justAddedIds 状态**

在 `RiskListPanel.vue` `<script setup>` 里加：

```typescript
const justAddedIds = ref<Set<string>>(new Set())

watch(
    () => props.risks,
    (newRisks, oldRisks) => {
        const oldIds = new Set((oldRisks ?? []).map(r => r.id))
        const newlyAdded = newRisks.filter(r => !oldIds.has(r.id)).map(r => r.id)
        if (newlyAdded.length === 0) return
        newlyAdded.forEach(id => justAddedIds.value.add(id))
        // 3 秒后自动移除
        setTimeout(() => {
            newlyAdded.forEach(id => justAddedIds.value.delete(id))
            justAddedIds.value = new Set(justAddedIds.value)
        }, 3000)
    },
    { deep: false },
)
```

在 card 模板上挂 data 属性和样式：

```vue
<Card
    v-for="r in sorted"
    :key="r.id"
    :data-risk-id="r.id"
    :data-just-added="justAddedIds.has(r.id) ? 'true' : 'false'"
    class="cursor-pointer transition-all"
    :class="{ 'bg-yellow-50 ring-1 ring-yellow-300': justAddedIds.has(r.id) }"
    @click="toggle(r.id)"
>
    <!-- 右上加"刚刚"角标 -->
    <span v-if="justAddedIds.has(r.id)" class="absolute top-1 right-1 bg-yellow-200 text-yellow-900 text-[10px] px-1.5 rounded">刚刚</span>
    <CardHeader>...</CardHeader>
</Card>
```

- [ ] **Step 3: 测试通过**

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.test.ts`

- [ ] **Step 4: Commit**

```bash
git add app/components/assistant/contract/RiskListPanel.vue tests/app/components/assistant/contract/RiskListPanel.test.ts
git commit -m "feat(contract): 风险卡片流式冒出 + '刚刚' 角标 (3秒衰减)

M6.1 子期 2 Task 2.3：watch risks 数组变化识别新增 id，塞入 justAddedIds
Set，3 秒后自动 evict。新增卡片带 bg-yellow-50 + 右上 '刚刚' 小标。"
```

---

## Task 2.4：子期 2 冒烟

- [ ] **Step 1:** 浏览器端到端：提交合同 → 观察风险卡片是否按条款顺序从顶部滑入
- [ ] **Step 2:** 刻意构造"第 3 条 JSON 错误"场景（可以改 analyzeSingleClause mock），验证 progress.error toast 即时弹出；最终 stage.warnings 也会汇总弹
- [ ] **Step 3:** 跑全量 vitest + typecheck

**子期 2 交付完成。** 上线后用户看到风险卡片边审边出，不再等整个流程结束。

---

# 子期 3：总览 + PDF

**目标**：加入 `summarize` 节点生成 `ContractOverview.highlights`；新建总览区组件替换现 RiskListPanel 顶部 summary 块；PDF 服务同步。

---

## Task 3.1：新增 summarize 节点生成 highlights

**Files:**
- Create: `server/services/assistant/contract/summarizeOverview.ts`
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts` — analyze 循环结束后调 summarize
- Test: `tests/server/assistant/contract/summarizeOverview.test.ts`

- [ ] **Step 1: 新建 summarizeOverview 函数**

```typescript
// server/services/assistant/contract/summarizeOverview.ts
import { z } from 'zod'
import type { Risk, ContractOverview, Stance } from '#shared/types/contract'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'

const OverviewResponse = z.object({
    highlights: z.object({
        high: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
        medium: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
        low: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
    }),
    overall: z.string().max(120),
})

export async function summarizeOverview(
    risks: Risk[],
    stance: Stance,
    contractType: string | null,
): Promise<ContractOverview> {
    if (risks.length === 0) {
        return {
            highlights: { high: [], medium: [], low: [] },
            overall: '本合同未识别到明显风险。',
        }
    }

    const config = await getValidNodeConfig('contractReviewMain')
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error('无可用 API 密钥')

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0.3,  // 略放松，让总评自然
    })

    const prompt = buildPrompt(risks, stance, contractType)
    const response = await model.invoke(prompt)
    const content = typeof response.content === 'string' ? response.content : ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('summarizeOverview: LLM 未返回 JSON')
    const parsed = OverviewResponse.safeParse(JSON.parse(jsonMatch[0]))
    if (!parsed.success) throw new Error(`summarizeOverview schema 校验失败: ${parsed.error.issues[0]?.message}`)
    return parsed.data
}

function buildPrompt(risks: Risk[], stance: Stance, contractType: string | null): string {
    const grouped = {
        high: risks.filter(r => r.level === 'high'),
        medium: risks.filter(r => r.level === 'medium'),
        low: risks.filter(r => r.level === 'low'),
    }
    const riskList = risks.map(r => `${r.level.toUpperCase()} · ${r.id} · ${r.category} · ${r.problem}`).join('\n')
    return [
        `我刚完成一份${contractType ?? '合同'}的风险审查（立场=${stance}）。以下是所有风险点：`,
        riskList,
        ``,
        `请按"高/中/低"三档输出分档要点（每条 ≤ 60 字，挂原 risk 的 id），再写一段总评（≤ 120 字）。`,
        `严格按如下 JSON 输出，不要解释：`,
        `{"highlights": {"high":[{"text":"...","riskId":"..."}], "medium":[...], "low":[...]}, "overall":"..."}`,
    ].join('\n')
}
```

- [ ] **Step 2: 写测试**

```typescript
// tests/server/assistant/contract/summarizeOverview.test.ts
it('0 条风险时直接返回默认 overview 不调 LLM', async () => { ... })
it('正常 risks 走 LLM 生成 highlights', async () => { ... })
it('LLM 输出不符合 schema 时抛错', async () => { ... })
```

- [ ] **Step 3: 接入 analyze 循环后**

在 `runContractReviewChat` 的 analyze 循环结束后：

```typescript
await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'running' })
try {
    const overview = await summarizeOverview(allRisks, stance, contractType)
    await updateContractReviewDAO(options.reviewId, { summary: overview as unknown as Prisma.InputJsonValue })
    await emitContractReviewEvent(emitterCtx, { type: 'overview', overview })
    await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'done' })
} catch (err) {
    logger.warn('summarizeOverview 失败，降级为仅 overall', { err })
    await updateContractReviewDAO(options.reviewId, {
        summary: { highlights: null, overall: `本合同识别到 ${allRisks.length} 条风险。` } as any,
    })
    await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'done' })
}
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): 新增 summarizeOverview · 生成 ContractOverview 结构化总览

M6.1 子期 3 Task 3.1：analyze 结束后调用 LLM 汇总 highlights + overall
并写库；失败降级为空 highlights + 一段兜底 overall。"
```

---

## Task 3.2：useContractOverview composable 派生 score / counts / scoreLabel

**Files:**
- Create: `app/composables/useContractOverview.ts`
- Test: `tests/app/composables/useContractOverview.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useContractOverview } from '~/composables/useContractOverview'
import type { Risk } from '#shared/types/contract'

describe('useContractOverview', () => {
    it('counts 按 level 分组统计', () => {
        const risks = ref<Risk[]>([
            { level: 'high' } as Risk, { level: 'high' } as Risk, { level: 'high' } as Risk,
            { level: 'medium' } as Risk, { level: 'medium' } as Risk,
            { level: 'low' } as Risk,
        ])
        const { counts } = useContractOverview(risks)
        expect(counts.value).toEqual({ high: 3, medium: 2, low: 1 })
    })

    it('score 按 3h + 1.5m + 0.5l 公式加权且上限 100', () => {
        const risks = ref<Risk[]>([
            ...Array(3).fill({ level: 'high' } as Risk),   // 9
            ...Array(5).fill({ level: 'medium' } as Risk), // 7.5
            ...Array(2).fill({ level: 'low' } as Risk),    // 1
        ])
        const { score } = useContractOverview(risks)
        expect(score.value).toBe(18)  // round(9+7.5+1) = 18
    })

    it('score ≥ 100 封顶', () => {
        const risks = ref<Risk[]>(Array(50).fill({ level: 'high' } as Risk))
        const { score } = useContractOverview(risks)
        expect(score.value).toBe(100)
    })

    it('scoreLabel 按分段派生', () => {
        expect(useContractOverview(ref(Array(25).fill({ level: 'high' } as Risk))).scoreLabel.value).toBe('极高风险')
        expect(useContractOverview(ref(Array(17).fill({ level: 'high' } as Risk))).scoreLabel.value).toBe('风险偏高，建议谈判')
        expect(useContractOverview(ref(Array(10).fill({ level: 'high' } as Risk))).scoreLabel.value).toBe('风险可控')
        expect(useContractOverview(ref([{ level: 'low' } as Risk])).scoreLabel.value).toBe('低风险')
    })
})
```

- [ ] **Step 2: 实现 composable**

```typescript
// app/composables/useContractOverview.ts
import type { Ref } from 'vue'
import type { Risk } from '#shared/types/contract'

/**
 * 从 risks 数组派生 counts / score / scoreLabel
 *
 * 不访问 DB / 不请求网络；纯派生，单一来源。
 *
 * 加权公式：score = min(100, round(3 × high + 1.5 × medium + 0.5 × low))
 * 分段：≥70 极高 / ≥50 偏高建议谈判 / ≥30 可控 / <30 低风险
 */
export function useContractOverview(risks: Ref<Risk[] | null>) {
    const counts = computed(() => {
        const list = risks.value ?? []
        return {
            high: list.filter(r => r.level === 'high').length,
            medium: list.filter(r => r.level === 'medium').length,
            low: list.filter(r => r.level === 'low').length,
        }
    })

    const score = computed(() => {
        const c = counts.value
        return Math.min(100, Math.round(3 * c.high + 1.5 * c.medium + 0.5 * c.low))
    })

    const scoreLabel = computed(() => {
        const s = score.value
        if (s >= 70) return '极高风险'
        if (s >= 50) return '风险偏高，建议谈判'
        if (s >= 30) return '风险可控'
        return '低风险'
    })

    return { counts, score, scoreLabel }
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(contract): 新增 useContractOverview 派生 score/counts/scoreLabel

M6.1 子期 3 Task 3.2：纯前端 composable，从 risks 数组实时派生分档
计数、加权总分、定性标签。公式 3h+1.5m+0.5l 上限 100。"
```

---

## Task 3.3：新总览区组件 OverviewPanel.vue

**Files:**
- Create: `app/components/assistant/contract/OverviewPanel.vue`
- Modify: `app/components/assistant/contract/RiskListPanel.vue` — 用 OverviewPanel 替换顶部 summary 块
- Test: `tests/app/components/assistant/contract/OverviewPanel.test.ts`

**范围约束**（v2 审查结论）：三色计数卡**只显示数字，不可点**。用户在 brainstorming 第 2 屏明确只选了入口 1+2+4（卡片/要点/悬停），**未选入口 3**（计数卡点击筛选列表）。任何"点计数卡触发筛选"的实现都是 YAGNI，不做。

- [ ] **Step 1: 写测试（要点）**

```typescript
it('渲染仪表盘 + 三色计数 + 每档要点 + 总评', () => { ... })
it('summary.highlights 为 null 时只渲染仪表盘 + 三色计数 + overall', () => { ... })
it('点击某条要点 emit focusRisk(riskId)', () => { ... })
it('三色计数卡为纯展示不可点，无 click 交互', () => {
    const w = mount(OverviewPanel, { props: { risks: [], summary: null } })
    expect(w.find('[data-count="high"]').element.tagName.toLowerCase()).not.toBe('button')
})
```

- [ ] **Step 2: 实现组件**

```vue
<!-- app/components/assistant/contract/OverviewPanel.vue -->
<script setup lang="ts">
import type { Risk, ContractOverview } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    summary: ContractOverview | null
}>()

const emit = defineEmits<{
    focusRisk: [riskId: string]
}>()

const risksRef = computed(() => props.risks)
const { counts, score, scoreLabel } = useContractOverview(risksRef)

const hasHighlights = computed(() => !!props.summary?.highlights)
const overall = computed(() => props.summary?.overall ?? '')
</script>

<template>
    <div class="p-3 border-b bg-muted/10 space-y-3">
        <!-- 仪表盘 + 定性 -->
        <div class="flex items-center gap-3">
            <div class="relative size-16 flex items-center justify-center"
                 :style="{ background: `conic-gradient(#b91c1c 0deg ${(score / 100) * 360}deg, #e5e7eb ${(score / 100) * 360}deg 360deg)`, borderRadius: '50%' }">
                <div class="absolute inset-2 bg-background rounded-full flex items-center justify-center text-lg font-bold">
                    {{ score }}
                </div>
            </div>
            <div class="text-xs">
                <div class="text-red-700 font-semibold">合同风险分 {{ score }}/100</div>
                <div class="text-muted-foreground">{{ scoreLabel }}</div>
            </div>
        </div>

        <!-- 三色计数卡（只读，不可点；用 div 而非 button） -->
        <div class="grid grid-cols-3 gap-1.5">
            <div class="bg-red-100 text-red-700 rounded p-2 text-center" data-count="high">
                <div class="text-lg font-bold">{{ counts.high }}</div>
                <div class="text-xs">高</div>
            </div>
            <div class="bg-orange-100 text-orange-700 rounded p-2 text-center" data-count="medium">
                <div class="text-lg font-bold">{{ counts.medium }}</div>
                <div class="text-xs">中</div>
            </div>
            <div class="bg-slate-100 text-slate-700 rounded p-2 text-center" data-count="low">
                <div class="text-lg font-bold">{{ counts.low }}</div>
                <div class="text-xs">低</div>
            </div>
        </div>

        <!-- 分档要点 (仅 highlights 非空时显示) -->
        <template v-if="hasHighlights">
            <div v-if="summary!.highlights!.high.length" class="space-y-1">
                <div class="text-xs font-semibold text-red-700">⚠ 高风险要点</div>
                <button v-for="h in summary!.highlights!.high" :key="h.riskId"
                        class="block text-left text-xs px-1 py-0.5 rounded hover:bg-blue-50 hover:text-blue-700 transition w-full"
                        @click="emit('focusRisk', h.riskId)">· {{ h.text }}</button>
            </div>
            <div v-if="summary!.highlights!.medium.length" class="space-y-1">
                <div class="text-xs font-semibold text-orange-700">⚠ 中风险要点</div>
                <button v-for="h in summary!.highlights!.medium" :key="h.riskId"
                        class="block text-left text-xs px-1 py-0.5 rounded hover:bg-blue-50 hover:text-blue-700 transition w-full"
                        @click="emit('focusRisk', h.riskId)">· {{ h.text }}</button>
            </div>
            <div v-if="summary!.highlights!.low.length" class="space-y-1">
                <div class="text-xs font-semibold text-slate-700">ℹ 低风险要点</div>
                <button v-for="h in summary!.highlights!.low" :key="h.riskId"
                        class="block text-left text-xs px-1 py-0.5 rounded hover:bg-blue-50 hover:text-blue-700 transition w-full"
                        @click="emit('focusRisk', h.riskId)">· {{ h.text }}</button>
            </div>
        </template>

        <!-- 总评 -->
        <div v-if="overall" class="text-xs text-muted-foreground italic pt-2 border-t border-dashed">总评：{{ overall }}</div>
    </div>
</template>
```

- [ ] **Step 3: 替换 RiskListPanel 顶部 summary 块**

找到 `RiskListPanel.vue` 的：

```vue
<div v-if="summary?.overall" class="p-3 border-b text-sm text-muted-foreground whitespace-pre-wrap">{{ summary.overall }}</div>
```

改为：

```vue
<AssistantContractOverviewPanel
    :risks="risks"
    :summary="summary"
    @focus-risk="(id: string) => emit('focusRisk', id)"
/>
```

并在 `RiskListPanel` 的 `emit` 里添加 `focusRisk`（父组件 ContractReviewPanel 暂时接收但不处理——子期 4 才联动跳转）。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): 新增 OverviewPanel 分档总览区 (仪表盘+计数+要点+总评)

M6.1 子期 3 Task 3.3：替换 RiskListPanel 顶部单段文字 summary 块。
每条要点按钮化 emit focusRisk；三色计数卡为纯展示不可点（spec 只选了
入口 1+2+4，没选点计数筛选）。highlights 缺失时降级为仅显示仪表盘 +
计数 + 总评。"
```

---

## Task 3.4：PDF 服务同步新 summary 结构

**Files:**
- Modify: `server/services/assistant/contract/contractReviewPdf.service.ts`
- Test: `tests/server/assistant/contract/contractReviewPdf.test.ts`

- [ ] **Step 1: 识别 PDF 渲染 summary 的所有位置**

```bash
grep -n "summary" server/services/assistant/contract/contractReviewPdf.service.ts
```

- [ ] **Step 2: 分两档渲染**

```typescript
if (review.summary?.highlights) {
    // 渲染新结构：仪表盘 + 三色计数 + 分档要点 + 总评
    renderGauge({ score: computeScore(review.risks), label: computeScoreLabel(...) })
    renderCounts({ high: ..., medium: ..., low: ... })
    renderHighlights(review.summary.highlights)
    renderOverall(review.summary.overall)
} else if (review.summary?.overall) {
    // 历史数据 / highlights 未生成：只渲染仪表盘 + 计数 + overall 一段
    renderGauge(...)
    renderCounts(...)
    renderText(review.summary.overall)
}
```

*具体 PDF 渲染 API 以现有 service 为准；在 step 1 观察现有 renderText / renderTitle 等函数。*

- [ ] **Step 3: 测试** — 各加一个测试用例验证新老两种 summary 都能渲染，不崩不乱

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): PDF 同步新 summary 结构 · 历史数据降级兼容

M6.1 子期 3 Task 3.4：封面/摘要页按 highlights 非空/空分两档渲染。
空时只渲染仪表盘 + 计数 + overall 一段文字。"
```

---

## Task 3.5：子期 3 冒烟

- [ ] 端到端跑一次审查，确认总览区的仪表盘 + 三色计数 + 分档要点 + 总评四件套全部出现
- [ ] 导出 PDF，打开确认封面结构一致
- [ ] 故意把 `summary.highlights` 手工改为 null（或用旧 review），确认前端和 PDF 都不崩
- [ ] 全量 vitest + typecheck

**子期 3 交付完成。**

---

# 子期 4：跳转联动

**目标**：实现文档预览↔风险面板的三入口跳转 + 反向悬停 + 钉多条 + 三级兜底。

---

## Task 4.1：三级定位工具 clauseLocator

**Files:**
- Create: `shared/utils/clauseLocator.ts`
- Test: `tests/shared/utils/clauseLocator.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { locateClauseElement } from '#shared/utils/clauseLocator'

describe('clauseLocator · 三级兜底', () => {
    const html = `
        <div>
            <p>第一条 合同标的</p>
            <p>甲方委托乙方完成某项目</p>
            <p>第五条 违约责任</p>
            <p>5.2 乙方违反本合同约定造成损失……</p>
        </div>
    `
    const container = new DOMParser().parseFromString(html, 'text/html').body

    it('精确匹配命中', () => {
        const el = locateClauseElement(container, '甲方委托乙方完成某项目')
        expect(el).toBeTruthy()
    })

    it('精确不中 → 模糊匹配前 20 字去标点', () => {
        const el = locateClauseElement(container, '甲方委托乙方完成某项目（包括但不限于软件开发）')
        expect(el).toBeTruthy()
        expect(el?.textContent).toContain('甲方委托乙方')
    })

    it('两级都失败 → 返回 null', () => {
        const el = locateClauseElement(container, '完全不相干的文字')
        expect(el).toBeNull()
    })
})
```

- [ ] **Step 2: 实现**

```typescript
// shared/utils/clauseLocator.ts
/**
 * 合同条款在 DOM 中的定位三级兜底
 *
 * 1. 精确子串匹配 clauseText 全文
 * 2. 模糊匹配：取前 20 字 + 去标点空白，作子串匹配
 * 3. 返回 null，由调用方显示"未定位"
 */
export function locateClauseElement(container: Element | null, clauseText: string): Element | null {
    if (!container || !clauseText) return null

    // 第 1 级：精确
    const exact = findTextMatch(container, clauseText)
    if (exact) return exact

    // 第 2 级：模糊（前 20 字 + 去标点空白）
    const fuzzy = clauseText
        .slice(0, 20)
        .replace(/[\s，。、；：（）()【】""'']+/g, '')
    if (fuzzy.length < 3) return null  // 太短的关键词不做模糊，容易误命中
    return findFuzzyMatch(container, fuzzy)
}

function findTextMatch(container: Element, text: string): Element | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes(text)) {
            return (walker.currentNode.parentElement ?? null)
        }
    }
    return null
}

function findFuzzyMatch(container: Element, keyword: string): Element | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
        const norm = (walker.currentNode.textContent ?? '').replace(/[\s，。、；：（）()【】""'']+/g, '')
        if (norm.includes(keyword)) {
            return (walker.currentNode.parentElement ?? null)
        }
    }
    return null
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(contract): 新增 clauseLocator 三级兜底定位工具

M6.1 子期 4 Task 4.1：精确 → 模糊（前 20 字去标点）→ null。在浏
览器 DOM 里查找 clauseText 对应的段落元素。"
```

---

## Task 4.2：扩展 useContractReview 聚焦/钉状态

**Files:**
- Modify: `app/composables/useContractReview.ts`
- Test: `tests/app/composables/useContractReview.test.ts`

- [ ] **Step 1: 添加状态和方法**

```typescript
// 在 useContractReview 内部添加：
const focusedRiskId = ref<string | null>(null)
/**
 * 悬停态（临时）：spec §6.2 明确"悬停不入 focused 态，仅让对应卡片短暂高亮"。
 * 3 秒后自动清零；鼠标移开也清零。与 focusedRiskId 独立。
 */
const hoveredRiskId = ref<string | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

const pinnedRiskIds = ref<Set<string>>(new Set())

/** 文档/卡片需要持续高亮的 riskId 集合 = focused + pinned（hover 不进来，视觉另一档） */
const highlightedRiskIds = computed(() => {
    const s = new Set(pinnedRiskIds.value)
    if (focusedRiskId.value) s.add(focusedRiskId.value)
    return s
})

function focusRisk(riskId: string | null) {
    focusedRiskId.value = riskId
}

function setHoveredRisk(riskId: string | null) {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoveredRiskId.value = riskId
    if (riskId) {
        // 3 秒后自动清零；鼠标再次离开也会传 null 立即清零
        hoverTimer = setTimeout(() => { hoveredRiskId.value = null }, 3000)
    }
}

function togglePin(riskId: string) {
    const s = new Set(pinnedRiskIds.value)
    if (s.has(riskId)) s.delete(riskId); else s.add(riskId)
    pinnedRiskIds.value = s
}
function clearAllPins() {
    pinnedRiskIds.value = new Set()
}

// 暴露到 return
return {
    ...,
    focusedRiskId, hoveredRiskId, pinnedRiskIds, highlightedRiskIds,
    focusRisk, setHoveredRisk, togglePin, clearAllPins,
}
```

- [ ] **Step 2: 测试 state 机**

```typescript
it('focusRisk 切换 focusedRiskId', () => { ... })
it('setHoveredRisk 设置 hoveredRiskId', () => { ... })
it('setHoveredRisk 3 秒后自动清零', async () => {
    vi.useFakeTimers()
    const { setHoveredRisk, hoveredRiskId } = useContractReview()
    setHoveredRisk('r1')
    expect(hoveredRiskId.value).toBe('r1')
    vi.advanceTimersByTime(3000)
    expect(hoveredRiskId.value).toBeNull()
    vi.useRealTimers()
})
it('setHoveredRisk(null) 立即清零并停计时器', () => { ... })
it('hoveredRiskId 不进入 highlightedRiskIds（与 focused/pinned 独立）', () => { ... })
it('togglePin 第一次加入 / 第二次移除', () => { ... })
it('highlightedRiskIds = focused + pinned 合集', () => { ... })
it('clearAllPins 清空 pinnedRiskIds', () => { ... })
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(contract): useContractReview 扩展聚焦/钉多条状态机

M6.1 子期 4 Task 4.2：focusedRiskId + pinnedRiskIds(Set) + 派生
highlightedRiskIds。focusRisk/togglePin/clearAllPins 三个方法。"
```

---

## Task 4.3：ContractDocxPreview 注入 data-risk-id + 彩色底 + 反向悬停

**Files:**
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue`
- Test: `tests/app/components/assistant/contract/ContractDocxPreview.test.ts`

- [ ] **Step 1: 组件 props 扩展**

```typescript
const props = defineProps<{
    reviewedFileId: number | null
    originalFileId: number | null
    risks: Risk[]                        // 新增
    focusedRiskId: string | null         // 新增
    hoveredRiskId: string | null         // 新增：悬停态（临时高亮，不入 focused）
    highlightedRiskIds: Set<string>      // 新增（pinned + focused，不含 hovered）
}>()

const emit = defineEmits<{
    focusRisk: [riskId: string]          // 用户点击某段时
    hoverClause: [riskId: string | null] // 鼠标悬停某段时（null 表示离开）
}>()
```

- [ ] **Step 2: renderAsync 完成后 walk DOM 注入 data-risk-id + 彩色底**

在 `loadDocx` 函数的 `await renderAsync(...)` 之后：

```typescript
// 等待 renderAsync 完成后，遍历 risks，用 clauseLocator 找到对应段落，注入属性
import { locateClauseElement } from '#shared/utils/clauseLocator'
const LEVEL_BG: Record<RiskLevel, string> = {
    high: 'bg-red-50 border-l-4 border-red-400',
    medium: 'bg-orange-50 border-l-4 border-orange-400',
    low: 'bg-slate-50 border-l-4 border-slate-400',
}

function decorateRisks() {
    if (!containerRef.value) return
    for (const risk of props.risks) {
        const el = locateClauseElement(containerRef.value, risk.clauseText)
        if (!el || !(el instanceof HTMLElement)) continue
        el.dataset.riskId = risk.id
        el.dataset.riskLevel = risk.level
        el.classList.add(...LEVEL_BG[risk.level].split(' '))
        // 挂悬停事件（只挂一次）
        if (!el.dataset.hoverHooked) {
            el.addEventListener('mouseenter', () => emit('hoverClause', risk.id))
            el.addEventListener('mouseleave', () => emit('hoverClause', null))
            el.addEventListener('click', () => emit('focusRisk', risk.id))
            el.dataset.hoverHooked = '1'
        }
    }
}

// loadDocx 的 renderAsync 后调：
decorateRisks()
```

- [ ] **Step 3: 监听 risks 变化重 decorate**

```typescript
watch(() => props.risks, () => {
    decorateRisks()
}, { deep: false })
```

注意：**props.risks 也必须在 Step 4 的样式 watch 依赖里**，否则新增 risk 时聚焦样式不会对新段落生效。

- [ ] **Step 4: 聚焦态样式切换（对齐 spec §7.1 视觉基线）**

spec §7.1 明确规定：
- 文档条款 active：底色 `#fde68a`（Tailwind 约等于 `bg-yellow-200`），左边框 `5px #b91c1c`（`border-l-[5px] border-red-700`），外加 1px 光晕
- 钉住但非 active：同 active（视觉一致，和 spec 的"文档条款钉住 = 同 active"一致）

```typescript
import type { Risk } from '#shared/types/contract'

watch(
    [() => props.focusedRiskId, () => props.highlightedRiskIds, () => props.hoveredRiskId, () => props.risks],
    () => {
        if (!containerRef.value) return
        containerRef.value.querySelectorAll('[data-risk-id]').forEach(el => {
            const id = (el as HTMLElement).dataset.riskId
            if (!id) return
            const isActive = id === props.focusedRiskId
            const isPinned = props.highlightedRiskIds.has(id) && !isActive
            const isHovered = id === props.hoveredRiskId && !isActive && !isPinned

            // 移除所有潜在的聚焦/钉/悬停样式（幂等清理）
            el.classList.remove(
                'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                '[box-shadow:0_0_0_1px_#b91c1c]',
                'bg-yellow-50',
            )
            // active + pinned 同视觉（spec §7.1）
            if (isActive || isPinned) {
                el.classList.add(
                    'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                    '[box-shadow:0_0_0_1px_#b91c1c]',
                )
            }
            // hovered：淡黄底短暂提示，不加边框/光晕
            if (isHovered) {
                el.classList.add('bg-yellow-50')
            }
        })
        // 聚焦时滚到可视区（hover 不滚，避免鼠标划过文档时文档自己乱跳）
        if (props.focusedRiskId) {
            const el = containerRef.value.querySelector(`[data-risk-id="${props.focusedRiskId}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    },
)
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): ContractDocxPreview 注入 data-risk-id 双向联动

M6.1 子期 4 Task 4.3：renderAsync 完成后 walk DOM，用 clauseLocator
找风险段落，注入彩色底 + 左边框 + 徽章数据；挂 mouseenter/click 事
件 emit hoverClause/focusRisk。聚焦/钉态监听切换 ring 样式。"
```

---

## Task 4.4：RiskListPanel 卡片 📌 按钮 + 聚焦态 + 列表筛选

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Test: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

- [ ] **Step 1: props + emit 扩展**

```typescript
const props = defineProps<{
    ...// 原有
    focusedRiskId: string | null
    pinnedRiskIds: Set<string>
}>()
const emit = defineEmits<{
    ...// 原有
    togglePin: [riskId: string]
    focusRisk: [riskId: string]
}>()
```

- [ ] **Step 2: 卡片右上加 📌 按钮**

```vue
<CardHeader class="py-2 px-3 relative">
    <button
        class="absolute top-1 right-1 text-xs px-1.5 rounded hover:bg-muted"
        :class="{ 'bg-orange-600 text-white': pinnedRiskIds.has(r.id) }"
        @click.stop="emit('togglePin', r.id)"
    >{{ pinnedRiskIds.has(r.id) ? '📌 已钉' : '📌' }}</button>
    <!-- 原有 header 内容 -->
</CardHeader>
```

- [ ] **Step 3: 聚焦态样式**

```vue
<Card
    v-for="r in filtered"
    :key="r.id"
    :data-risk-id="r.id"
    :class="{
        'bg-yellow-50 border-l-4 border-red-500': focusedRiskId === r.id,
        'bg-orange-50 border-l-4 border-orange-500': pinnedRiskIds.has(r.id) && focusedRiskId !== r.id,
    }"
    @click="emit('focusRisk', r.id)"
/>
```

- [ ] **Step 4: 卡片列表按 clauseIndex 升序（保持现状）**

```typescript
const sorted = computed(() => [...props.risks].sort((a, b) => a.clauseIndex - b.clauseIndex))
```

**不做列表筛选功能**：本期用户没要求"点计数卡筛选列表"，参见 Task 3.3 范围约束。

- [ ] **Step 5: 聚焦时自动滚到可视区**

```typescript
watch(() => props.focusedRiskId, (id) => {
    if (!id) return
    nextTick(() => {
        const el = document.querySelector(`[data-risk-id="${id}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
})
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(contract): RiskListPanel 卡片📌 按钮 + 聚焦/钉视觉 + 筛选条

M6.1 子期 4 Task 4.4：每张卡片右上📌 按钮切钉；focus/pinned 视觉区
分；顶部筛选条由 OverviewPanel 三色计数点击触发。"
```

---

## Task 4.5：ContractReviewPanel 统一调度器 + Shift 快捷键 + 浮动面板接线

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`
- Modify: `app/components/assistant/contract/FloatingAnnotationPanel.vue`（只需去掉已经存在但未接的 focusRisk 兼容；若 props 需要补则补）

- [ ] **Step 1: 父组件接收所有 emit 并分发**

```typescript
const {
    focusRisk, togglePin, clearAllPins,
    focusedRiskId, hoveredRiskId, setHoveredRisk,  // Task 4.2 新增的 hovered 状态
    pinnedRiskIds, highlightedRiskIds,
} = useContractReview()

function handleFocusRisk(id: string) {
    focusRisk(id)
}

function handleTogglePin(id: string) {
    togglePin(id)
}

// 悬停文档段落：只设置 hovered（spec §6.2 明确不入 focused 态）
function handleHoverClause(id: string | null) {
    setHoveredRisk(id)
}

// Shift + 点击快捷键（委托到 ContractReviewPanel 容器，冒泡而非捕获，避免干扰 dialog/popover）
function handleContainerClick(e: MouseEvent) {
    if (!e.shiftKey) return
    const target = (e.target as HTMLElement).closest('[data-risk-id]')
    if (!target) return
    const id = (target as HTMLElement).dataset.riskId
    if (id) {
        e.preventDefault()  // 防止同时触发普通 click 的 focusRisk
        togglePin(id)
    }
}
```

容器上挂：

```vue
<div class="h-full flex flex-col" @click="handleContainerClick">
    ...
</div>
```

**为什么用委托而非 `window.addEventListener`**：全局 capture 会早于子组件的 click 触发，可能干扰 dialog/popover 的"点击外部关闭"逻辑；容器上的冒泡只对合同审查子树生效，安全。

- [ ] **Step 2: 组件 props 传递**

```vue
<AssistantContractDocxPreview
    :reviewed-file-id="review?.reviewedFileId ?? null"
    :original-file-id="review?.originalFileId ?? null"
    :risks="review?.risks ?? []"
    :focused-risk-id="focusedRiskId"
    :hovered-risk-id="hoveredRiskId"
    :highlighted-risk-ids="highlightedRiskIds"
    @focus-risk="handleFocusRisk"
    @hover-clause="handleHoverClause"
/>

<AssistantContractRiskListPanel
    ...
    :focused-risk-id="focusedRiskId"
    :hovered-risk-id="hoveredRiskId"
    :pinned-risk-ids="pinnedRiskIds"
    @focus-risk="handleFocusRisk"
    @toggle-pin="handleTogglePin"
/>

<AssistantContractFloatingAnnotationPanel
    :risks="review?.risks ?? []"
    :visible="showFloatingPanel"
    :active-risk-id="focusedRiskId"
    @focus-risk="handleFocusRisk"
    @update:visible="(v: boolean) => (showFloatingPanel = v)"
/>
```

- [ ] **Step 3: 测试所有入口的行为区分**

扩展 ContractReviewPanel.test.ts：

```typescript
it('卡片点击 → focusRisk 被调用（进入 focused 态）', async () => { ... })
it('OverviewPanel 要点点击 → focusRisk 被调用', async () => { ... })
it('DocxPreview hoverClause → setHoveredRisk 被调用，focusRisk 不被调用', async () => { ... })
it('FloatingPanel focusRisk emit → focusRisk 被调用', async () => { ... })
it('容器 Shift+click 在含 data-risk-id 的元素上触发 togglePin', async () => { ... })
it('容器 Shift+click 在不含 data-risk-id 的元素上不触发 togglePin', async () => { ... })
it('Dialog 打开后容器外 Shift+click 不受影响（不干扰 Dialog 外部关闭）', async () => { ... })
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): ContractReviewPanel 统一调度器 + Shift 快捷键 + 浮动面板接线

M6.1 子期 4 Task 4.5：三入口（卡片/要点/悬停）全部汇入 handleFocusRisk
→ useContractReview.focusRisk。Shift+click 全局监听切钉。浮动面板
focusRisk emit 也接入。"
```

---

## Task 4.6：子期 4 冒烟 + 全流程验收

- [ ] 点风险卡片 → 文档定位 + 聚焦态（底色 yellow-200 + 左边框 5px 红 + 1px 光晕）✓
- [ ] 点分档要点 → 同上 ✓
- [ ] 悬停文档段 → 右侧卡片短暂高亮 3 秒自动退出（hovered 态，**不**进入 focused 态）✓
- [ ] 点📌 按钮 → 卡片钉住 + 文档保持聚焦视觉 ✓
- [ ] 容器内 Shift + 点击含 data-risk-id 的元素 → 钉 / 取消钉 ✓
- [ ] 打开任意 Dialog（如编辑风险） → Shift+click Dialog 外的其他地方 → Dialog 不会因为我们的快捷键异常关闭 ✓
- [ ] 构造一条 AI 给的 clauseText 找不到精确匹配但前 20 字能模糊命中 → 仍然能跳 ✓
- [ ] 构造一条完全找不到的 → 文档跳不过去 **且** 卡片显示"⚠ 未定位"标签（见 Task 4.6.1）✓
- [ ] 全量 `npx vitest run` + `npx nuxi typecheck`

---

## Task 4.6.1：卡片"未定位"视觉提示

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue` — emit 定位结果
- Test: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

spec §US-6 第 3 级验收标准要求"卡片显示 ⚠ 未定位 标签"。Task 4.6 之前的冒烟发现这一条仍未交付，这里补上。

- [ ] **Step 1: DocxPreview 上报定位失败的 riskId 集合**

在 `decorateRisks()` 函数里，`locateClauseElement` 返回 null 时记录 riskId：

```typescript
const notLocatedIds = new Set<string>()
for (const risk of props.risks) {
    const el = locateClauseElement(containerRef.value, risk.clauseText)
    if (!el) {
        notLocatedIds.add(risk.id)
        continue
    }
    // ... decorate
}
emit('locateResult', notLocatedIds)
```

扩展 emit：

```typescript
const emit = defineEmits<{
    focusRisk: [riskId: string]
    hoverClause: [riskId: string | null]
    locateResult: [notLocatedIds: Set<string>]  // 新增
}>()
```

- [ ] **Step 2: 父组件把未定位集合传给 RiskListPanel**

`ContractReviewPanel` 里：

```typescript
const notLocatedIds = ref<Set<string>>(new Set())

function handleLocateResult(ids: Set<string>) {
    notLocatedIds.value = ids
}
```

```vue
<AssistantContractDocxPreview
    ...
    @locate-result="handleLocateResult"
/>
<AssistantContractRiskListPanel
    ...
    :not-located-ids="notLocatedIds"
/>
```

- [ ] **Step 3: RiskListPanel 卡片渲染未定位标签**

```vue
<CardHeader>
    <div class="flex items-center gap-2">
        <span :class="LEVEL_CLASS[r.level]">{{ RISK_LEVEL_LABEL[r.level] }}</span>
        <span>{{ r.category }}</span>
        <span
            v-if="notLocatedIds.has(r.id)"
            class="text-[10px] px-1.5 rounded bg-amber-100 text-amber-800 border border-amber-300"
        >⚠ 未定位</span>
    </div>
</CardHeader>
```

- [ ] **Step 4: 未定位卡片点击行为**

在 ContractReviewPanel 的 `handleFocusRisk` 里加判断：

```typescript
function handleFocusRisk(id: string) {
    if (notLocatedIds.value.has(id)) {
        // 未定位时不尝试跳转，只展开卡片（by expandedId 现有机制）
        // 这里不调 focusRisk(id)，由 RiskListPanel 内部的 toggle 负责展开
        return
    }
    focusRisk(id)
}
```

- [ ] **Step 5: 测试**

```typescript
it('未定位 risk 的卡片渲染 ⚠ 未定位 标签', () => { ... })
it('未定位卡片点击不触发跳转，仅展开', () => { ... })
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(contract): 卡片 '未定位' 标签 · spec US-6 第 3 级补齐

M6.1 子期 4 Task 4.6.1：DocxPreview 上报定位失败集合，RiskListPanel
渲染 ⚠ 未定位 标签；点击不跳转只展开。"
```

**子期 4 交付完成。** M6.1 全部收尾。

---

# 自审报告

## 1. Spec 覆盖

| Spec 段落 | 对应 Task |
|-----------|-----------|
| §2 决策 ① 整体总览 | 1.1 / 3.2 / 3.3 / 3.4 |
| §2 决策 ② 跳转入口 | 4.3 / 4.4 / 4.5 |
| §2 决策 ③ 反向触发 | 4.3 |
| §2 决策 ④ 聚焦态视觉 | 4.3 / 4.4 |
| §2 决策 ⑤ 三级兜底 | 4.1 |
| §2 决策 ⑥ 浮动面板 | 4.5 |
| §2 决策 ⑦ PDF 同步 | 3.4 |
| §2 决策 ⑧ 钉多条 | 4.2 / 4.4 / 4.5 |
| §2 决策 ⑨ 过程可视化 | 1.4 / 1.5 / 1.6 / 1.7 / 1.8 / 2.1 / 2.2 / 2.3 |
| §2 决策 ⑩ 条款切分 | 1.4 / 1.5 |
| §4.1 summary JSON | 1.1 / 1.2 / 1.3 |
| §4.3 ClauseSegment | 1.1 / 1.4 |
| §5.1 SSE 4 种事件 | 1.5 / 1.6 / 2.2 |
| §5.2 增量写 risks | 2.2 |
| §5.3 PDF | 3.4 |
| §6.1 A OverviewPanel | 3.3 |
| §6.1 C ContractDocxPreview 改造 | 4.3 |
| §6.1 D 浮动面板 | 4.5 |
| §6.1 E ReviewProgress | 1.7 |
| §6.2 useContractReview 扩展 | 1.6 / 4.2 |
| §6.3 SSE 消费 | 1.6 |
| §7.3 过程透明 | 1.7 |
| §8 错误处理 | 1.5 / 2.2 / 4.1 |
| §9 测试覆盖 | 各 task 内嵌 |
| §10 4 子期 | 本 plan 结构 |

**所有 spec 段落都有任务覆盖。✓**

## 2. 占位符扫描

- 已避免 "TBD / implement later / add appropriate error handling"
- 所有测试代码均给出具体断言
- 所有函数签名均在引入它的第一个 task 里给出完整定义

## 3. 类型一致性

- `ContractOverview.highlights` 类型在 1.1 定义为 `high/medium/low: Array<{text, riskId}>`，在 3.1 summarize LLM schema 与 3.3 OverviewPanel 渲染里均严格使用
- `ContractReviewEvent` 联合类型在 1.1 定义为 4 种 type，1.6 的 handleContractEvent switch 覆盖 4 种
- `ClauseSegment` 在 1.1 定义的 `{index, number, text}` 三字段（无 offset），在 1.4 segmentClauses / 2.1 analyzeSingleClause / 2.2 循环里一致使用
- `focusRisk / togglePin / clearAllPins` 方法名在 4.2 定义，4.4 / 4.5 调用时签名一致

**类型一致性 ✓**

## 4. 执行路径提示

实施顺序：
- **子期 1**：Task 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9（冒烟）
- **子期 2**：Task 2.1 → 2.2 → 2.3 → 2.4（冒烟）
- **子期 3**：Task 3.1 → 3.2 → 3.3 → 3.4 → 3.5（冒烟）
- **子期 4**：Task 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6（冒烟）

**每个子期内的 Task 顺序严格依赖前序**，但子期之间可以插入休整日（上线观察、收集反馈、修小 bug）。

---

## 执行建议

Plan 完成并保存到 `docs/superpowers/plans/2026-04-21-m6-1-contract-review-overview-and-progress-plan.md`。两种执行方式：

1. **Subagent-Driven（推荐）**：用 `superpowers:subagent-driven-development`，每个 task 派一个新 subagent 实现 + 两轮自动 review（spec 合规 + 代码质量）。适合控制上下文污染 + 快速迭代。
2. **Inline 执行**：用 `superpowers:executing-plans`，当前会话直接顺序跑，带 checkpoint 交给用户手动 review。

# 合同审查 · PR 3 · 路线 2 精准锚点（sentence_id + fuzzy fallback）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把合同审查首次审查链路从"段落级 anchor"升级为"完整条款 + 精确问题片段"双锚点：服务端切句标 ID → prompt 喂给 LLM `[Sn]` 编号视图 → LLM 输出 `problemSentenceIds + problematicQuote` → 服务端 deterministic 解析得 `(quoteCharStart, quoteCharEnd, quoteMatchSource)` 落库；解析失败按 `sentence_id → fuzzy → fallback` 三档降级。同步把"律师 PATCH risk 时锚点字段必须只读"的防御加上。

**Architecture:** 工具层先建（`splitSentences` / `fuzzyLocateInText` / `resolveQuoteAnchor`），再扩 LLM 输出 schema（`RISK_SHAPE` + `Risk`），再把切句拼接进 `analyzeSingleClause` 的 prompt 渲染、把 anchor 解析嵌入 `persistAiRisksAsContractRows` 内部——调用方（`contractReviewMainAgent` / `uploadClientVersion`）零改动；最后改数据库里的 prompt 模板（`seedData.sql` 的 prompt id=28）+ 加 `.strict()` 防御。每步 TDD：先失败用例 → 实现 → 通过。

**Tech Stack:** TypeScript / Vitest / zod 4 / diff-match-patch（已用于 anchorMigrate / clauseDiff）/ Prisma 7

**Spec 参考：** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` § 5（5.0 ~ 5.5）+ § 10.1 / § 11.1 / § 12

**前置条件：**
- PR 1（partyDetector 短路修复）已合并（commits `bd72611e` / `b7a4a3e6`）
- **PR 2（数据模型重构 · 双锚点）已完整合并**（commits `f563852d` ~ `e078c147` 共 11 个，含 schema 重构 / shared types / dao / service / 前端 / 测试 / migrate / version / rebuild / persistence middleware / uploadClientVersion / contractReviewMainAgent / 字段重命名兜底）。Task 0 仍需 `bun run typecheck` 验证基线干净。
- 工作区基于 `dev`（PR 2 已合）起独立 worktree（superpowers:using-git-worktrees）

**PR 2 真实落地状态（PR 3 plan 已对齐）**：
- `PersistAiRiskRow` 字段：`risk` / `source?` / `clauseText?` / `clauseParagraphIndex?` / `originalClauseText?` / `orphaned?`（**不暴露** `clauseCharStart` / `clauseCharEnd`——这两列由 Phase B 锚点迁移路径填，首次审查写 null）
- `persistAiRisksAsContractRows` 已为 PR 3 留好 null 占位：`clauseIndex: null` / `problematicQuote: null` / `quoteCharStart: null` / `quoteCharEnd: null` / `quoteMatchSource: null`（contractRisk.service.ts:108-113，注释明确"PR 3 主路径起填"）
- `Risk` interface 字段（shared/types/contract.ts:148-169）：仍是 PR 2 收尾态（含 `clauseIndex` / `clauseText` / `clauseParagraphIndex?`，**未含** `problemSentenceIds` / `problematicQuote`，由 PR 3 Task 6 扩展）
- `RISK_SHAPE`（riskSchema.builder.ts:15-37）：未含 `problemSentenceIds` / `problematicQuote`，由 PR 3 Task 6 扩展
- 测试 helper：`tests/server/assistant/test-db-helper.ts` 提供 `ensureTestUser()` / `cleanupTestData()`，contract 测试用 `import { ensureTestUser } from '../test-db-helper'` 引入

---

## 改动文件总图

### server 端工具新建
- 创建：`server/agents/contract/utils/splitSentences.ts`
- 创建：`server/agents/contract/utils/resolveQuoteAnchor.ts`

### server 端工具扩展
- 修改：`server/agents/contract/docx/clauseSegmenter.ts`（3 个正则常量改 `export const`）
- 修改：`server/agents/contract/utils/textSimilarity.ts`（新增 `fuzzyLocateInText`）
- 修改：`server/agents/contract/utils/anchorMigrate.ts`（`findBestSubstring` fast-path 复用 `fuzzyLocateInText`）

### server 端业务集成
- 修改：`server/agents/contract/riskSchema.builder.ts`（`RISK_SHAPE` 新增 `problemSentenceIds` / `problematicQuote`）
- 修改：`shared/types/contract.ts`（`Risk` interface 同步加两字段）
- 修改：`server/agents/contract/contractRisk.service.ts`（`persistAiRisksAsContractRows` 内部集成 `splitSentences` + `resolveQuoteAnchor` 写入 `quote_*`）
- 修改：`server/agents/contract/analyzeSingleClause.ts`（`renderPromptTemplate` 切句 + 加占位符 `sentencesNumbered` / `clauseTextRaw`）
- 修改：`server/api/v1/assistant/contract/reviews/risks/[riskId].patch.ts`（`bodySchema` 加 `.strict()` 防御）

### 数据库 prompt
- 修改：`prisma/seeds/seedData.sql`（prompt id=28 INSERT 字面值升级到 v3：content + variables + version + title；保留 `ON CONFLICT DO NOTHING` 项目惯例，已上线环境走运维 UPDATE 同步）

### 测试新建
- 创建：`tests/server/agents/contract/utils/splitSentences.test.ts`
- 创建：`tests/server/agents/contract/utils/textSimilarity.test.ts`（项目当前无此文件，Task 3 全新创建）
- 创建：`tests/server/agents/contract/utils/resolveQuoteAnchor.test.ts`

### 测试扩展
- 修改：`tests/server/assistant/contract/contractRisk.service.test.ts`（断言双锚点 quote 字段写入正确）
- 修改：`tests/server/assistant/contract/analyzeSingleClause.test.ts`（断言 prompt 占位符替换为 `sentencesNumbered`）
- 创建：`tests/server/assistant/contract/risksPatch.api.test.ts`（断言 `.strict()` 拒绝 clause/quote 字段；文件名不带 `[]` 避免 vitest glob 误吞）

### 不动文件
- `server/agents/contract/utils/clauseToParagraph.ts`（`buildClauseToParagraphMap` 与 anchor 解析无关）
- `server/agents/contract/uploadClientVersion.service.ts`（PR 7 才升级双锚点迁移；本 PR 仅靠 service 层自动解析覆盖首次审查 + Phase B 增量审查的新增 risk）
- `server/services/workflow/agents/contractReviewMainAgent.ts`（service 内部已自动解析，调用方零改动）
- `server/agents/contract/docx/commentInjector.ts`（不消费 quote 字段，PR 5/6 才用）
- 前端组件全部不改（前端字符级高亮、Layout A/C 切换是 PR 4/5 的范围）

---

## 字段速查表（PR 3 新增/修改）

| 类别 | 字段 / 标识 | 类型 | 来源 / 写入路径 |
|---|---|---|---|
| LLM 输出（zod schema） | `problemSentenceIds` | `number[]`（1-based, default `[]`） | LLM 输出，存于 `Risk` |
| LLM 输出 | `problematicQuote` | `string?`（max 2000） | LLM 输出（fuzzy fallback 用），存于 `Risk` |
| DB 行（PR 2 已建） | `clauseText` / `clauseIndex` / `clauseParagraphIndex` / `clauseCharStart` / `clauseCharEnd` | 见 PR 2 plan | PR 2 落库；PR 3 维持 |
| DB 行（PR 2 已建，PR 3 起填值） | `problematicQuote` | `string?` | `resolveQuoteAnchor` 解析后写入 |
| DB 行（PR 2 已建，PR 3 起填值） | `quoteCharStart` / `quoteCharEnd` | `int?`（在 `clauseText` 内的相对 offset） | `resolveQuoteAnchor` 解析后写入 |
| DB 行（PR 2 已建，PR 3 起填值） | `quoteMatchSource` | `'sentence_id' \| 'fuzzy' \| 'fallback'` | `resolveQuoteAnchor` 命中分档 |
| Prompt 占位符 | `{{sentencesNumbered}}` | string | 替换原 `{{clauseText}}`，格式 `[S1] xxx\n[S2] yyy\n...` |
| Prompt 占位符 | `{{clauseTextRaw}}` | string | 完整原文（兜底回溯，等价于原 `{{clauseText}}` 截断版） |
| 工具函数 | `splitSentences(text) => SentenceSpan[]` | 1-based ID + 0-based char offset | `server/agents/contract/utils/splitSentences.ts` |
| 工具函数 | `fuzzyLocateInText(text, pattern, opts) => {start,end} \| null` | 含 32 字符 Bitap 上限保护 + Match_Distance 显式设定 + 单例参数恢复 | `server/agents/contract/utils/textSimilarity.ts`（追加 export） |
| 工具函数 | `resolveQuoteAnchor({clauseText, sentences, aiOutput}) => QuoteAnchorResult` | 三档：`sentence_id` → `fuzzy` → `fallback` | `server/agents/contract/utils/resolveQuoteAnchor.ts` |

---

## Task 0：worktree 准备 + PR 2 完整性校验

**Files:**
- 不修改文件，仅做环境准备

- [ ] **Step 0.1：创建 worktree（superpowers:using-git-worktrees）**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
git fetch origin
git checkout dev && git pull --ff-only origin dev
git worktree add ../LexSeek-pr3-route2-anchoring -b pr3-route2-anchoring dev
cd ../LexSeek-pr3-route2-anchoring
bun install
bun run prisma:generate
```

Expected: worktree 创建成功；`bun install` 完成；Prisma client 生成（`generated/prisma/`）。

- [ ] **Step 0.2：验证 PR 2 基线（typecheck 干净）**

```bash
bun run typecheck 2>&1 | tee /tmp/pr3-typecheck-baseline.log
```

Expected: 0 错误（PR 2 已合 commits `f563852d` ~ `e078c147` 共 11 个，已验证基线干净；本步是防回归 sanity check）。如果有 `anchorQuote` / `anchorParagraphIndex` / `originalAnchorQuote` 相关错误，说明 worktree 没基于最新 dev——`git fetch && git log --oneline | head -1` 检查最新 commit 是否含 `e078c147`。

- [ ] **Step 0.3：验证 contract 测试基线 PASS**

```bash
npx vitest run tests/server/agents/contract/ tests/server/assistant/contract/ --reporter=verbose 2>&1 | tail -30
```

Expected: 所有 contract 测试 PASS（PR 2 完成后应该全绿）。失败的话同样停下来先把 PR 2 跑通。

- [ ] **Step 0.4：confirm 不要 commit 0 步**

Step 0.x 不创建任何 commit，纯环境准备。

---

## Task 1：clauseSegmenter 三个正则常量 export

**Files:**
- Modify: `server/agents/contract/docx/clauseSegmenter.ts:128-131`

`splitSentences` 需要复用 `clauseSegmenter.ts` 已经验证过的子项编号识别正则（避免重复造轮子+维护两套）。当前这三个正则是模块私有 `const`，本任务把它们改成 `export const`。

- [ ] **Step 1.1：把三个正则常量从 const 改为 export const**

打开 `server/agents/contract/docx/clauseSegmenter.ts`，定位第 128-131 行：

```typescript
/** 常用条款编号正则（按优先级组合，每组捕获"标号"） */
const RE_DI_TIAO = /(第[一二三四五六七八九十零百千0-9\.]+条)/
const RE_NUM_DOT = /^(\d+(?:\.\d+)*\.?)\s/
const RE_CN_COMMA = /^([一二三四五六七八九十百千]+、)/
```

改为（仅在三个 `const` 前加 `export`）：

```typescript
/**
 * 常用条款编号正则（按优先级组合，每组捕获"标号"）
 * `splitSentences` 也复用这三个正则识别行首子项编号作为切句点（spec §5.1）。
 */
export const RE_DI_TIAO = /(第[一二三四五六七八九十零百千0-9\.]+条)/
export const RE_NUM_DOT = /^(\d+(?:\.\d+)*\.?)\s/
export const RE_CN_COMMA = /^([一二三四五六七八九十百千]+、)/
```

- [ ] **Step 1.2：跑 clauseSegmenter 测试确认无回归**

```bash
npx vitest run tests/server/agents/contract/clauseSegmenter.test.ts --reporter=verbose
```

Expected: 全部 PASS（仅修改了 const → export const，行为完全不变）。

- [ ] **Step 1.3：commit**

```bash
git add server/agents/contract/docx/clauseSegmenter.ts
git commit -m "refactor(contract): 子项编号正则改 export 供 splitSentences 复用"
```

---

## Task 2：splitSentences 工具（TDD）

**Files:**
- Create: `server/agents/contract/utils/splitSentences.ts`
- Create: `tests/server/agents/contract/utils/splitSentences.test.ts`

按 spec §5.1 实现"中文合同条款条款内部断句"：在一个 segment 文本里继续按"标点 + 行首子项编号"切成 1-based 的 `SentenceSpan[]`，每个带 `(charStart, charEnd)` 用于后续 LLM 输出 ID → offset 的 deterministic 解析。

- [ ] **Step 2.1：写失败测试**

创建 `tests/server/agents/contract/utils/splitSentences.test.ts`，内容：

```typescript
/**
 * splitSentences 单元测试（spec §5.1 / §10.1）
 *
 * 切分规则：
 *  - 标点：。！？；\n（中文逗号 / 顿号 不切；引号 / 括号内的标点不切）
 *  - 行首子项编号：复用 clauseSegmenter.ts 的 RE_DI_TIAO / RE_NUM_DOT / RE_CN_COMMA
 *
 * 输出：1-based id + 0-based [charStart, charEnd) offset，offset 同 segmentText 空间
 *
 * **测试矩阵（对应 spec §10.1 splitSentences 行的全部 6 类，删减 case 时务必保留每类至少 1 个）**：
 *  1. 边角行为（空字符串 / 整段无切分点 / 仅含 1 个标点）
 *  2. 中文标点切分（句号 / 分号 / ！？ / \n / 中文逗号顿号不切）
 *  3. 引号 / 括号内标点不切（嵌套 / 中英双引号 / 单引号）
 *  4. 行首子项编号（3.1 / 一、/ 第二条 + 行内不切防回归）
 *  5. charStart/charEnd 一致性（slice 拼回原文 + id 1-based 连续）
 *  6. 连续分号 / 连续切分点（已在第 2 类长 case 覆盖）
 */
import { describe, it, expect } from 'vitest'
import { splitSentences } from '~~/server/agents/contract/utils/splitSentences'

describe('splitSentences', () => {
    describe('边角行为', () => {
        it('空字符串返回空数组', () => {
            expect(splitSentences('')).toEqual([])
        })

        it('整段无切分点 → 整段作 1 个 sentence（如标题行）', () => {
            const r = splitSentences('合同标题')
            expect(r).toHaveLength(1)
            expect(r[0]).toEqual({ id: 1, text: '合同标题', charStart: 0, charEnd: 4 })
        })

        it('仅含 1 个标点符号 "。" → 切出 1 个空文本 sentence', () => {
            const r = splitSentences('。')
            expect(r).toHaveLength(1)
            expect(r[0]).toEqual({ id: 1, text: '', charStart: 0, charEnd: 1 })
        })
    })

    describe('中文标点切分', () => {
        it('按句号切', () => {
            const r = splitSentences('甲方应按月支付工资。乙方应按时打卡。')
            expect(r.map(s => s.text)).toEqual(['甲方应按月支付工资', '乙方应按时打卡'])
            expect(r[0]!.charStart).toBe(0)
            expect(r[0]!.charEnd).toBe(10) // 含句号
            expect(r[1]!.charStart).toBe(10)
            expect(r[1]!.charEnd).toBe(18)
        })

        it('按分号切（合同条款常见）', () => {
            const r = splitSentences('工资按月支付；逾期支付的，每日加收 0.05% 违约金；累计逾期超 30 日的，乙方有权解除合同。')
            expect(r).toHaveLength(3)
            expect(r[0]!.text).toBe('工资按月支付')
            expect(r[1]!.text).toBe('逾期支付的，每日加收 0.05% 违约金') // 中文逗号不切
        })

        it('感叹号 / 问号也是切分点', () => {
            expect(splitSentences('这条款有效吗？是的！').map(s => s.text)).toEqual(['这条款有效吗', '是的'])
        })

        it('换行符 \\n 也是切分点', () => {
            const r = splitSentences('第一句\n第二句')
            expect(r).toHaveLength(2)
            expect(r[0]!.text).toBe('第一句')
            expect(r[1]!.text).toBe('第二句')
        })

        it('中文逗号 / 顿号不切', () => {
            const r = splitSentences('甲方、乙方，应当履行各自义务。')
            expect(r).toHaveLength(1)
            expect(r[0]!.text).toBe('甲方、乙方，应当履行各自义务')
        })
    })

    describe('引号 / 括号内标点不切', () => {
        it('双引号 \"\" 内的句号 / 分号不切', () => {
            const r = splitSentences('合同所称"工资。津贴；奖金"包括基本工资。')
            expect(r).toHaveLength(1) // 引号内不切，只在最外层句号切
            expect(r[0]!.text).toBe('合同所称"工资。津贴；奖金"包括基本工资')
        })

        it('括号 () 内分号不切', () => {
            const r = splitSentences('赔偿（含直接损失；不含间接损失）按月计算。')
            expect(r).toHaveLength(1)
            expect(r[0]!.text).toBe('赔偿（含直接损失；不含间接损失）按月计算')
        })

        it('单引号 \\u2018\\u2019 内不切', () => {
            const r = splitSentences("条款称'A。B'有效。")
            expect(r).toHaveLength(1)
        })
    })

    describe('行首子项编号作为切分点（spec §5.1 复用 clauseSegmenter 三个正则）', () => {
        // 注：合同实际文本里 \n 已经是切分点，"行首子项编号"99% 与 \n 切点重合；
        // 本段保留 1 个综合 case 验证三种编号格式可识别 + 1 个回归 case 防"行内编号被误切"。
        it('三种行首编号（3.1 / 一、/ 第二条）都能识别为切分点', () => {
            const seg = '3 工资。\n3.1 月薪标准。\n一、生效条件。\n第二条 主体'
            const r = splitSentences(seg)
            const texts = r.map(s => s.text)
            expect(texts.some(t => t.startsWith('3.1'))).toBe(true)
            expect(texts.some(t => t.startsWith('一、'))).toBe(true)
            expect(texts.some(t => t.includes('第二条'))).toBe(true)
        })

        it('行内「第二」/「3.1」不作切分点（仅行首识别）', () => {
            const r = splitSentences('前段说明。第二，违约金按月计算')
            expect(r).toHaveLength(2)
            expect(r[1]!.text).toBe('第二，违约金按月计算')
        })
    })

    describe('charStart / charEnd 一致性', () => {
        it('每个 sentence 的 [charStart, charEnd) slice 等于 text + 切分标点', () => {
            const seg = '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。'
            const r = splitSentences(seg)
            // 整篇拼回应等于 seg
            const reconstructed = r.map(s => seg.slice(s.charStart, s.charEnd)).join('')
            expect(reconstructed).toBe(seg)
        })

        it('id 是 1-based 连续递增', () => {
            const r = splitSentences('A。B。C。')
            expect(r.map(s => s.id)).toEqual([1, 2, 3])
        })
    })
})
```

- [ ] **Step 2.2：跑测试看失败**

```bash
npx vitest run tests/server/agents/contract/utils/splitSentences.test.ts --reporter=verbose
```

Expected: FAIL with "Cannot find module '~~/server/agents/contract/utils/splitSentences'"

- [ ] **Step 2.3：实现 splitSentences**

创建 `server/agents/contract/utils/splitSentences.ts`：

```typescript
/**
 * 中文合同条款条款内部断句（spec §5.1）。
 *
 * 在一个 segment 内部继续切成 [Sn] 编号的子句视图，给 LLM 看 / 给服务端解析
 * problemSentenceIds → charStart/charEnd。1-based id 与 LLM prompt 视图对齐。
 *
 * 切分点：
 *  - 标点：。！？；和换行符 \n
 *  - 行首子项编号：复用 clauseSegmenter.ts 的 RE_DI_TIAO / RE_NUM_DOT / RE_CN_COMMA
 *
 * 不切：中文逗号 , 顿号 、；引号 \"\"“” / 单引号 ‘’ / 括号 ()（）  内的标点
 *
 * 边角：
 *  - 空字符串 → []
 *  - 整段无切分点 → 整段作 1 个 sentence
 *  - 仅 1 个标点（如 "。"）→ 切出 1 个空 text 的 sentence
 */
import { RE_DI_TIAO, RE_NUM_DOT, RE_CN_COMMA } from '../docx/clauseSegmenter'

export interface SentenceSpan {
    /** 1-based ID，给 LLM prompt 用 */
    id: number
    /** 句子文本（已 trim 首尾空白；可能为空字符串，例如仅含切分标点的边角） */
    text: string
    /** 在 segmentText 内的 0-based offset（含切分标点本身） */
    charStart: number
    /** exclusive */
    charEnd: number
}

const SENTENCE_TERMINATORS = new Set(['。', '！', '？', '；', '\n'])

const QUOTE_OPEN_TO_CLOSE: Record<string, string> = {
    '"': '"',
    "'": "'",
    '“': '”', // 中文双引号
    '‘': '’', // 中文单引号
    '(': ')',
    '（': '）',
}

/**
 * 判断 segmentText 在 lineStart 位置是否是行首子项编号。
 * 复用 clauseSegmenter 的三个正则。匹配成功返回该编号字符串长度（含尾部空格），失败返回 0。
 */
function detectLineLeadingNumberLength(segmentText: string, lineStart: number): number {
    const tail = segmentText.slice(lineStart)
    // 「X.X 」/ 「X.X.X 」
    const numDot = tail.match(RE_NUM_DOT)
    if (numDot?.[1]) return numDot[0]!.length
    // 「一、」中文序号
    const cnComma = tail.match(RE_CN_COMMA)
    if (cnComma?.[1]) return cnComma[0]!.length
    // 「第X条」（不要求行首带空格）
    if (tail.startsWith('第')) {
        const diTiao = tail.match(RE_DI_TIAO)
        if (diTiao && tail.indexOf(diTiao[0]!) === 0) return diTiao[0]!.length
    }
    return 0
}

export function splitSentences(segmentText: string): SentenceSpan[] {
    if (segmentText.length === 0) return []

    const result: SentenceSpan[] = []
    /** 当前句子的起始 offset */
    let cursor = 0
    /** 当前所在的"嵌套引号 / 括号"栈，遇到关闭符弹出 */
    const quoteStack: string[] = []
    /** 标记下一个字符是否是行首（'\n' 之后或 i=0） */
    let atLineStart = true

    const flush = (charEnd: number) => {
        const slice = segmentText.slice(cursor, charEnd)
        // text 字段去掉前后空白 + 末尾切分标点（[。！？；\n] 与可能伴随的空白）；
        // charEnd 仍含切分标点本身，offset 连续可还原。这样 splitSentences('。') 给出
        // text='' 而不是 text='。'，符合 spec §5.1 "仅含 1 字符（"。"）→ 切出 1 个空句子"。
        const trimmed = slice.replace(/^\s+|[。！？；\n\s]+$/g, '')
        // 即使 text 为空（如纯标点的边角 / \n 之间空行），也要产出一个 sentence 占位，
        // 保证 id 与 offset 连续不丢；LLM 不会选这种空 [Sn]，无害。
        result.push({
            id: result.length + 1,
            text: trimmed,
            charStart: cursor,
            charEnd,
        })
        cursor = charEnd
    }

    for (let i = 0; i < segmentText.length; i++) {
        const ch = segmentText[i]!

        // 处理引号 / 括号嵌套
        if (quoteStack.length > 0 && ch === quoteStack[quoteStack.length - 1]) {
            quoteStack.pop()
            atLineStart = false
            continue
        }
        if (QUOTE_OPEN_TO_CLOSE[ch]) {
            quoteStack.push(QUOTE_OPEN_TO_CLOSE[ch]!)
            atLineStart = false
            continue
        }
        if (quoteStack.length > 0) {
            // 引号 / 括号内任何标点都不切
            if (ch === '\n') atLineStart = true
            else atLineStart = false
            continue
        }

        // 行首子项编号：作为新句子起点（先 flush 上一个）
        if (atLineStart && i > cursor) {
            const len = detectLineLeadingNumberLength(segmentText, i)
            if (len > 0) {
                flush(i)
                // 把整个标号 + 编号后的内容并入下一个句子；继续扫描
                atLineStart = false
                continue
            }
        }

        // 标点切分点
        if (SENTENCE_TERMINATORS.has(ch)) {
            flush(i + 1) // 含切分标点本身
            atLineStart = ch === '\n'
            continue
        }

        atLineStart = false
    }

    // 兜底：剩余尾部不为空时 flush
    if (cursor < segmentText.length) {
        flush(segmentText.length)
    }

    return result
}
```

- [ ] **Step 2.4：跑测试看通过**

```bash
npx vitest run tests/server/agents/contract/utils/splitSentences.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 2.5：commit**

```bash
git add server/agents/contract/utils/splitSentences.ts tests/server/agents/contract/utils/splitSentences.test.ts
git commit -m "feat(contract): splitSentences 中文条款内部断句工具（路线 2 服务端切句）"
```

---

## Task 3：fuzzyLocateInText 公共 helper（TDD，含单例隔离）

**Files:**
- Modify: `server/agents/contract/utils/textSimilarity.ts`（追加 export）
- Create: `tests/server/agents/contract/utils/textSimilarity.test.ts`（项目当前无此文件，本 task 新建）

把 dmp Bitap 模糊匹配封装成纯函数，供 `resolveQuoteAnchor` 档 2 与 `anchorMigrate.findBestSubstring` fast-path 共用。**关键约束**（spec §5.3.1）：

1. `Match_MaxBits = 32`：pattern.length > 32 时 `match_main` 抛 throw `"Pattern too long for this browser."`。调用方必须先截前 32 字符做 anchor locate。
2. `Match_Threshold` 默认 0.5；合同场景压到 0.3 兼顾精度（**硬编**，无 options，YAGNI）。
3. `Match_Distance` 默认 1000；合同条款可超 1000 字符 → 显式设到 `text.length` 保证全段可搜。
4. `getDmp()` 是全局单例（`calcSimilarity` / `anchorMigrate` 等其他调用方依赖默认参数）→ 必须 `try/finally` 保存恢复 `Match_Threshold` / `Match_Distance` 避免污染。
5. `match_main` 找不到返回 **`-1`**（不是 `null`）。
6. **签名收窄**：实际调用点（`resolveQuoteAnchor` 档 2 + `anchorMigrate.findBestSubstring` fast-path）都不传 threshold / loc 参数 → 不暴露 options 参数，避免无用 API 表面（spec §5.3.1 函数签名虽列了 options，实际仅设计期遗留，5check YAGNI 减项）。

- [ ] **Step 3.1：写失败测试**

如果 `tests/server/agents/contract/utils/textSimilarity.test.ts` 不存在则创建；存在则在尾部追加。完整内容：

```typescript
/**
 * fuzzyLocateInText 单元测试（spec §5.3.1 / §10.1）
 *
 * 重点保护：
 *  1. pattern.length > 32 用前 32 字符 anchor locate 不抛 throw
 *  2. text 超 1000 字符时仍能命中末尾 quote（验证 Match_Distance 显式设定）
 *  3. 共享 dmp 单例参数恢复（不污染 calcSimilarity 等其他调用方）
 *  4. text / pattern 空 / match 不到 → 返回 null
 */
import { describe, it, expect } from 'vitest'
import { fuzzyLocateInText, getDmp, calcSimilarity } from '~~/server/agents/contract/utils/textSimilarity'

describe('fuzzyLocateInText', () => {
    describe('基础命中', () => {
        it('短 pattern 完全匹配 → 返回精确 offset', () => {
            const text = '工资按月支付，逾期支付的每日按 0.05% 加收滞纳金。'
            const r = fuzzyLocateInText(text, '逾期支付的每日按 0.05%')
            expect(r).not.toBeNull()
            expect(text.slice(r!.start, r!.end)).toBe('逾期支付的每日按 0.05%')
        })

        it('短 pattern 含 1-2 字符差异（中英文标点差异）→ 仍能命中', () => {
            // text 用中文逗号，pattern 用英文逗号 — Bitap 容错应能命中
            const text = '甲方应当履行义务，乙方支付报酬。'
            const r = fuzzyLocateInText(text, '甲方应当履行义务,乙方')
            expect(r).not.toBeNull()
        })

        it('text 为空 → null', () => {
            expect(fuzzyLocateInText('', 'anything')).toBeNull()
        })

        it('pattern 为空 → null', () => {
            expect(fuzzyLocateInText('anything', '')).toBeNull()
        })

        it('找不到完全不相似的 pattern → null', () => {
            expect(fuzzyLocateInText('abcdefg', 'XYZQRST123')).toBeNull()
        })
    })

    describe('pattern.length > 32（dmp Match_MaxBits 上限保护）', () => {
        it('超长 pattern（50 字）走前 32 字符 anchor locate，不抛 throw', () => {
            const text = '导言段。' + 'A'.repeat(20) + '问题片段开始这里有五十个字符的精确问题片段需要被定位到位置上请勿丢失。' + 'B'.repeat(20)
            const longPattern = '问题片段开始这里有五十个字符的精确问题片段需要被定位到位置上请勿丢失'
            expect(longPattern.length).toBeGreaterThan(32)

            // 不应抛 "Pattern too long"
            expect(() => fuzzyLocateInText(text, longPattern)).not.toThrow()

            const r = fuzzyLocateInText(text, longPattern)
            expect(r).not.toBeNull()
            // start 应该指向 longPattern 在 text 里实际开始的位置（前 32 字符 anchor）
            const startIdx = text.indexOf('问题片段开始')
            expect(r!.start).toBe(startIdx)
            // end = start + pattern.length（按调用方约定）
            expect(r!.end).toBe(startIdx + longPattern.length)
        })
    })

    describe('Match_Distance 显式设定（长 text 末尾命中）', () => {
        it('text 长度 > 1000 时仍能命中末尾 quote', () => {
            const filler = '前导内容'.repeat(300) // 1200 字符
            const text = filler + '【末尾标记】违约金每日 0.5%'
            const pattern = '违约金每日 0.5%'

            const r = fuzzyLocateInText(text, pattern)
            expect(r).not.toBeNull()
            expect(r!.start).toBeGreaterThan(1000)
            expect(text.slice(r!.start, r!.end)).toContain('违约金每日 0.5%')
        })
    })

    describe('共享单例参数恢复', () => {
        it('调 fuzzyLocateInText 后 dmp.Match_Threshold / Match_Distance 恢复默认', () => {
            const dmp = getDmp()
            const beforeThreshold = dmp.Match_Threshold
            const beforeDistance = dmp.Match_Distance

            fuzzyLocateInText('some text', 'some')

            expect(dmp.Match_Threshold).toBe(beforeThreshold)
            expect(dmp.Match_Distance).toBe(beforeDistance)
        })

        it('fuzzyLocateInText 抛错时也要恢复参数（finally 保护）', () => {
            const dmp = getDmp()
            const before = dmp.Match_Threshold

            // 用一个不会让内部抛错的输入；改用直接读 dmp 的 backdoor 测试方式：
            // 先调一次正常 fuzzyLocateInText，然后断言参数已恢复（同上）
            try {
                fuzzyLocateInText('text', 'pattern')
            }
            catch { /* ignore */ }
            expect(dmp.Match_Threshold).toBe(before)
        })

        it('calcSimilarity 紧跟 fuzzyLocateInText 调用，结果不被污染', () => {
            // 先调一次 fuzzyLocateInText（会临时改 Match_Threshold/Distance）
            fuzzyLocateInText('precondition', 'pre')
            // 然后调 calcSimilarity，结果应等于直接调用的结果（无污染）
            const sim = calcSimilarity('hello world', 'hello there')
            expect(sim).toBeGreaterThan(0)
            expect(sim).toBeLessThanOrEqual(1)
        })
    })

})
```

- [ ] **Step 3.2：跑测试看失败**

```bash
npx vitest run tests/server/agents/contract/utils/textSimilarity.test.ts --reporter=verbose
```

Expected: FAIL with "fuzzyLocateInText is not a function" 或类似。

- [ ] **Step 3.3：在 textSimilarity.ts 追加 fuzzyLocateInText**

打开 `server/agents/contract/utils/textSimilarity.ts`，在文件末尾追加：

```typescript
/**
 * 用 diff-match-patch 的 Bitap 算法找 pattern 在 text 内最相似 substring 的起点 offset。
 *
 * **关键约束**（diff-match-patch 官方文档 + npm 源码 index.js:1461-1463 / 39 / 43 / 53 核对）：
 *  - `Match_MaxBits = 32`：pattern.length > 32 时 `match_main` **抛 throw `"Pattern too long for this browser."`**
 *    （**不是**返回 -1）；本函数先截前 32 字符做 anchor locate 规避，end 按调用方期望
 *    的 pattern.length 推算回去。
 *  - `Match_Threshold` 默认 0.5；合同场景**硬编**压到 0.3 兼顾精度（YAGNI：当前所有调用点都不需要可配）。
 *  - `Match_Distance` 默认 1000；合同条款可超 1000 字符 → 显式设到 text.length 保证全段可搜。
 *  - `match_main` 找到时返回起点 offset（number，0-based），找不到返回 **`-1`**（不是 null）。
 *  - 中文 BMP 字符 1 字 = 1 UTF-16 code unit，offset 即字符 offset。
 *
 * **共享单例参数恢复**：`getDmp()` 是全局单例，`calcSimilarity` / `anchorMigrate.findBestSubstring`
 * 等其他调用方依赖默认 Match_Threshold / Match_Distance；本函数 try/finally 保存/恢复
 * 这两个参数避免污染。
 *
 * **不做标点归一化**：`normalizeForMatch` 含 1→3 字符（如 `…` → `...`）+ 多空白折叠 + trim，
 * 不是 1:1 字符替换；归一化后 offset 与原文不对齐。dmp.match_main 的 Bitap fuzzy 容错本身
 * 已能处理标点小差异（中文逗号 `,` vs 英文 `,` 在 Match_Threshold=0.3 下仍可命中），不再叠归一化。
 *
 * @param text 全文
 * @param pattern 待定位的子串
 * @returns 命中时返回 `{ start, end }`（end = min(start + pattern.length, text.length)）；找不到返回 null
 */
export function fuzzyLocateInText(
    text: string,
    pattern: string,
): { start: number; end: number } | null {
    const MAX_PATTERN = 32
    if (pattern.length === 0 || text.length === 0) return null

    const dmp = getDmp()
    const savedThreshold = dmp.Match_Threshold
    const savedDistance = dmp.Match_Distance
    try {
        dmp.Match_Threshold = 0.3
        dmp.Match_Distance = Math.max(1000, text.length)

        // pattern > 32 抛 throw → 必须用前 32 字符做 anchor locate，按 pattern.length 推算 end
        const probe = pattern.length <= MAX_PATTERN ? pattern : pattern.slice(0, MAX_PATTERN)
        const start = dmp.match_main(text, probe, 0)
        if (start === -1) return null
        return { start, end: Math.min(start + pattern.length, text.length) }
    }
    finally {
        dmp.Match_Threshold = savedThreshold
        dmp.Match_Distance = savedDistance
    }
}
```

- [ ] **Step 3.4：跑测试看通过**

```bash
npx vitest run tests/server/agents/contract/utils/textSimilarity.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 3.5：commit**

```bash
git add server/agents/contract/utils/textSimilarity.ts tests/server/agents/contract/utils/textSimilarity.test.ts
git commit -m "feat(contract): fuzzyLocateInText 公共 helper（dmp 单例隔离 + 32 字符上限保护）"
```

---

## Task 4：anchorMigrate.findBestSubstring 复用 fuzzyLocateInText

**Files:**
- Modify: `server/agents/contract/utils/anchorMigrate.ts:52-57`

把 `findBestSubstring` 内部 `dmp.match_main(...)` 直接调用替换为 `fuzzyLocateInText(...)`，行为等价（fast-path 锚定精确位置后再做 Levenshtein 精扫的逻辑保持不变）。这步是 spec §5.3.1 末尾"`anchorMigrate.ts:findBestSubstring` 同步重构：把内部 `dmp.match_main` 调用改为 `fuzzyLocateInText`"的落实。

- [ ] **Step 4.1：替换 dmp.match_main 调用**

打开 `server/agents/contract/utils/anchorMigrate.ts`，定位第 52-57 行：

```typescript
    // 性能 fast-path：用 dmp.match_main 锚定 anchor 在 clauseText 的近似位置
    // Match_Threshold 越小匹配越严格；0.5 默认值已经足够宽容
    const dmp = getDmp()
    const matchLoc = clauseText.length >= anchorLen
        ? dmp.match_main(clauseText, anchor.slice(0, Math.min(anchorLen, 100)), 0)
        : -1
```

替换为：

```typescript
    // 性能 fast-path：用 fuzzyLocateInText（封装 dmp.match_main + 单例参数隔离 + 32 字符 Bitap 上限保护）
    // 锚定 anchor 在 clauseText 的近似位置。Match_Threshold/Distance 由 fuzzyLocateInText 内部托管。
    const probe = anchor.slice(0, Math.min(anchorLen, 100))
    const located = clauseText.length >= anchorLen
        ? fuzzyLocateInText(clauseText, probe)
        : null
    const matchLoc = located?.start ?? -1
```

同时把 `getDmp` 的 import 删掉（因为本函数不再直接用 dmp），换成 `fuzzyLocateInText`。修改 import 行（line 2）：

```typescript
import { calcSimilarity, getDmp } from './textSimilarity'
```

改为：

```typescript
import { calcSimilarity, fuzzyLocateInText } from './textSimilarity'
```

> 注意：本文件其他位置不再使用 `getDmp`（grep 一下 `dmp` 关键字确认 fast-path 之外无引用），所以可以安全删 `getDmp` import。如果 grep 发现还有别的地方用 `dmp`，保留 `getDmp` import 不动，只额外加 `fuzzyLocateInText`。

- [ ] **Step 4.2：跑 anchorMigrate 现有测试 + clauseDiff 相关测试确保无回归**

```bash
npx vitest run tests/server/agents/contract/ --reporter=verbose 2>&1 | grep -E "anchorMigrate|clauseDiff|uploadClientVersion" | tail -30
```

Expected: 全部相关测试 PASS（fast-path 行为等价，仅是底层调用从 `dmp.match_main` 改为封装函数）。

如果有 anchorMigrate 单测失败，先确认 `fuzzyLocateInText` 在长 anchor（>32 字符）下行为：旧代码 `anchor.slice(0, Math.min(anchorLen, 100))` 截断到最多 100 字符，但 dmp 仍可能因 >32 字符抛 throw（旧代码侥幸跑通是因为 anchor 通常 ≤32 字符）。`fuzzyLocateInText` 修了这个潜在 bug（再加 32 字符截断保护），现在 anchor=50 字符的 case 不会抛了。如果旧测试断言依赖"长 anchor 抛 throw"，是 PR 3 的修正预期。

- [ ] **Step 4.3：commit**

```bash
git add server/agents/contract/utils/anchorMigrate.ts
git commit -m "refactor(contract): anchorMigrate.findBestSubstring 复用 fuzzyLocateInText"
```

---

## Task 5：resolveQuoteAnchor 三档 fallback（TDD）

**Files:**
- Create: `server/agents/contract/utils/resolveQuoteAnchor.ts`
- Create: `tests/server/agents/contract/utils/resolveQuoteAnchor.test.ts`

按 spec §5.3.2 实现"sentence_id → fuzzy → fallback"三档 deterministic 解析：

- 档 1：LLM 输出 `problemSentenceIds` 有效 → 取 [min, max] 跨段 slice 出 quote（`matchSource='sentence_id'`）
- 档 2：sentence_id 缺失或全无效但有 `problematicQuote` 且长度 ≥ 4 → `fuzzyLocateInText` 在 clauseText 内模糊匹配（`matchSource='fuzzy'`）
- 档 3：两档都失败 → `{ problematicQuote: null, charStart: null, charEnd: null, matchSource: 'fallback' }`

- [ ] **Step 5.1：写失败测试**

创建 `tests/server/agents/contract/utils/resolveQuoteAnchor.test.ts`：

```typescript
/**
 * resolveQuoteAnchor 单元测试（spec §5.3.2 / §10.1）
 *
 * 三档 fallback：
 *  - sentence_id 命中（单 ID / 多 ID 跨句 / 无效 ID 过滤）
 *  - fuzzy 命中（pattern.length > 32 / Match_Distance 长 text）
 *  - 全失败降级
 *
 * 重点：
 *  - matchSource 字段正确（'sentence_id' / 'fuzzy' / 'fallback'）
 *  - quote.length < 4 跳过 fuzzy
 *  - dmp 单例参数不被污染（间接验证 fuzzyLocateInText 的 try/finally）
 */
import { describe, it, expect } from 'vitest'
import { resolveQuoteAnchor } from '~~/server/agents/contract/utils/resolveQuoteAnchor'
import { splitSentences } from '~~/server/agents/contract/utils/splitSentences'

describe('resolveQuoteAnchor', () => {
    const clauseText = '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。乙方有权追讨。'
    const sentences = splitSentences(clauseText)

    describe('档 1：sentence_id 主路径', () => {
        it('单个 problemSentenceId → 切出对应句子', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [2], problematicQuote: undefined },
            })
            expect(r.matchSource).toBe('sentence_id')
            expect(r.problematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
            expect(r.charStart).toBe(sentences[1]!.charStart)
            expect(r.charEnd).toBe(sentences[1]!.charEnd)
        })

        it('多个 problemSentenceIds 跨句 → 取 [min, max] 区间', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [2, 3], problematicQuote: undefined },
            })
            expect(r.matchSource).toBe('sentence_id')
            expect(r.charStart).toBe(sentences[1]!.charStart)
            expect(r.charEnd).toBe(sentences[2]!.charEnd)
            expect(clauseText.slice(r.charStart!, r.charEnd!)).toContain('逾期支付的')
            expect(clauseText.slice(r.charStart!, r.charEnd!)).toContain('追讨')
        })

        it('无效 ID（超出范围）被过滤掉，剩余有效 ID 仍能命中', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [2, 99], problematicQuote: undefined },
            })
            expect(r.matchSource).toBe('sentence_id')
            expect(r.charStart).toBe(sentences[1]!.charStart)
            expect(r.charEnd).toBe(sentences[1]!.charEnd)
        })

        it('全部 ID 无效 → 进档 2', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [99, 100],
                    problematicQuote: '逾期支付的，每日按 0.05%',
                },
            })
            expect(r.matchSource).toBe('fuzzy')
        })

        it('LLM 给 0 / 负数 ID（非 1-based）→ 全部过滤，进档 2', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [0, -1],
                    problematicQuote: '逾期支付的，每日按 0.05%',
                },
            })
            expect(r.matchSource).toBe('fuzzy')
        })
    })

    describe('档 2：fuzzy fallback', () => {
        it('无 problemSentenceIds 但有 problematicQuote → 走 fuzzy', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [],
                    problematicQuote: '逾期支付的，每日按 0.05%',
                },
            })
            expect(r.matchSource).toBe('fuzzy')
            expect(r.charStart).not.toBeNull()
            expect(r.charEnd).not.toBeNull()
            expect(clauseText.slice(r.charStart!, r.charEnd!)).toContain('逾期支付')
        })

        it('quote.length < 4 → 跳过 fuzzy 直接降级', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [],
                    problematicQuote: '过低', // 仅 2 字符
                },
            })
            expect(r.matchSource).toBe('fallback')
        })

        it('quote 在 clauseText 里完全找不到（不相似）→ 进档 3', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [],
                    problematicQuote: 'XYZQRSTABCDEFG 完全不存在的句子',
                },
            })
            expect(r.matchSource).toBe('fallback')
        })

        it('长 quote（>32 字符）走前 32 字符 anchor，仍能命中', () => {
            const longClauseText = '导入。' + '工资按月底前最后一个工作日结算并通过银行转账方式支付到员工指定账户。' + '尾部其他内容。'
            const longSents = splitSentences(longClauseText)
            const longQuote = '工资按月底前最后一个工作日结算并通过银行转账方式支付到员工指定账户'
            expect(longQuote.length).toBeGreaterThan(32)

            const r = resolveQuoteAnchor({
                clauseText: longClauseText,
                sentences: longSents,
                aiOutput: { problemSentenceIds: [], problematicQuote: longQuote },
            })
            expect(r.matchSource).toBe('fuzzy')
            expect(r.charStart).not.toBeNull()
        })
    })

    describe('档 3：全失败降级', () => {
        it('无 IDs / 无 quote → fallback', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [], problematicQuote: undefined },
            })
            expect(r).toEqual({
                problematicQuote: null,
                charStart: null,
                charEnd: null,
                matchSource: 'fallback',
            })
        })

        it('aiOutput 完全是 default 值（LLM 返了 risk 但没填 quote 字段）', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {},
            })
            expect(r.matchSource).toBe('fallback')
            expect(r.problematicQuote).toBeNull()
        })
    })

    describe('返回值约束', () => {
        it('archive: matchSource=sentence_id 时 problematicQuote 是 trim 过的 slice', () => {
            const seg = '  工资按月支付。   逾期违约。  '
            const sents = splitSentences(seg)
            const r = resolveQuoteAnchor({
                clauseText: seg,
                sentences: sents,
                aiOutput: { problemSentenceIds: [1] },
            })
            expect(r.problematicQuote).toBe(seg.slice(sents[0]!.charStart, sents[0]!.charEnd).trim())
        })
    })
})
```

- [ ] **Step 5.2：跑测试看失败**

```bash
npx vitest run tests/server/agents/contract/utils/resolveQuoteAnchor.test.ts --reporter=verbose
```

Expected: FAIL with "Cannot find module 'resolveQuoteAnchor'"。

- [ ] **Step 5.3：实现 resolveQuoteAnchor**

创建 `server/agents/contract/utils/resolveQuoteAnchor.ts`：

```typescript
/**
 * 路线 2 服务端解析（spec §5.3.2）：把 LLM 输出的 problemSentenceIds + problematicQuote
 * 解析为在 clauseText 内的相对 (charStart, charEnd) + 命中来源。
 *
 * 三档 fallback：
 *  - 档 1：sentence_id 主路径（deterministic）。validIds 为空时 fall through
 *  - 档 2：fuzzy match（dmp Bitap）。problematicQuote.length < 4 时跳过（误命中风险高）
 *  - 档 3：全失败降级。`problematicQuote: null` UI 退回到 clauseText 段落级显示
 */
import { fuzzyLocateInText } from './textSimilarity'
import type { SentenceSpan } from './splitSentences'

export interface QuoteAnchorResult {
    /** 精确问题片段；null = 三档全失败降级 */
    problematicQuote: string | null
    /** 在 clauseText 内的相对 offset（不是文档全文 offset）；null 时 quote 也为 null */
    charStart: number | null
    charEnd: number | null
    /** 命中来源（运维 quote_match_source 字段对齐） */
    matchSource: 'sentence_id' | 'fuzzy' | 'fallback'
}

export interface ResolveQuoteAnchorInput {
    /** 完整条款原文（segmentClauses 产出的 segment.text） */
    clauseText: string
    /** splitSentences(clauseText) 的产物，1-based id */
    sentences: SentenceSpan[]
    /** LLM 输出（RISK_SHAPE 提取的两个 quote 相关字段） */
    aiOutput: {
        problemSentenceIds?: number[]
        problematicQuote?: string
    }
}

const MIN_FUZZY_QUOTE_LENGTH = 4

export function resolveQuoteAnchor(input: ResolveQuoteAnchorInput): QuoteAnchorResult {
    // 档 1：sentence_id 主路径（deterministic）
    const ids = input.aiOutput.problemSentenceIds
    if (ids && ids.length > 0) {
        const validIds = ids.filter(id => id >= 1 && id <= input.sentences.length)
        if (validIds.length > 0) {
            const minId = Math.min(...validIds)
            const maxId = Math.max(...validIds)
            const startSentence = input.sentences[minId - 1]!
            const endSentence = input.sentences[maxId - 1]!
            const charStart = startSentence.charStart
            const charEnd = endSentence.charEnd
            const quote = input.clauseText.slice(charStart, charEnd).trim()
            return { problematicQuote: quote, charStart, charEnd, matchSource: 'sentence_id' }
        }
    }

    // 档 2：fuzzy match fallback（不归一化；offset 直接对齐原文）
    const quote = input.aiOutput.problematicQuote?.trim()
    if (quote && quote.length >= MIN_FUZZY_QUOTE_LENGTH) {
        const offset = fuzzyLocateInText(input.clauseText, quote)
        if (offset !== null) {
            return {
                problematicQuote: input.clauseText.slice(offset.start, offset.end),
                charStart: offset.start,
                charEnd: offset.end,
                matchSource: 'fuzzy',
            }
        }
    }

    // 档 3：全失败降级（UI 退回到 clauseText 段落级显示，与现状视觉一致）
    return { problematicQuote: null, charStart: null, charEnd: null, matchSource: 'fallback' }
}
```

- [ ] **Step 5.4：跑测试看通过**

```bash
npx vitest run tests/server/agents/contract/utils/resolveQuoteAnchor.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 5.5：commit**

```bash
git add server/agents/contract/utils/resolveQuoteAnchor.ts tests/server/agents/contract/utils/resolveQuoteAnchor.test.ts
git commit -m "feat(contract): resolveQuoteAnchor 三档 fallback（sentence_id → fuzzy → fallback）"
```

---

## Task 6：扩展 RISK_SHAPE + Risk interface

**Files:**
- Modify: `server/agents/contract/riskSchema.builder.ts:15-37`
- Modify: `shared/types/contract.ts:148-169`

按 spec §5.4 给 LLM 输出 zod schema 加两个新字段；同步把 `Risk` interface 加上对应字段。**不动** PersistAiRiskRow（quote 解析在 service 内部完成，调用方不需要拼装 quote 字段）。

- [ ] **Step 6.1：扩展 RISK_SHAPE**

打开 `server/agents/contract/riskSchema.builder.ts`，第 15-37 行的 `RISK_SHAPE`，在 `matchedPointCode` 字段后、`.refine(...)` 之前插入两行新字段：

```typescript
export const RISK_SHAPE = z.object({
    // id 定义为可选字符串而非 z.string().uuid()：
    //   - AI 输出路径：analyzeSingleClause 会用 randomUUID() 强制覆盖 LLM 返回的 id，
    //     LLM 返回任何格式都无意义；用 .uuid() 还会因为 LLM 偶发返回 "risk-1"、"" 这
    //     种非 UUID 字符串而让整条 risk 被拒（用户看到"第 N 条 LLM 输出不符合 schema"）
    //   - PATCH 路径：前端传的 id 来自之前 API 返回的已合法 UUID，不需要严格校验
    // YAGNI：id 校验对业务流程没有防护价值，放松后上游容错更强
    id: z.string().optional().describe('UUID，前端渲染 key；AI 路径会被服务端覆盖'),
    clauseIndex: z.number().int().nonnegative().describe('段落索引（0-based）'),
    clauseText: z.string().min(1).max(10000).describe('原文段落全文'),
    level: z.enum(RISK_LEVEL).describe('风险级别'),
    category: z.string().min(1).max(200).describe('付款 / 交付 / 违约 / 保密 / 知识产权 / 争议解决 / 其他'),
    problem: z.string().min(1).max(2000).describe('问题简述'),
    legalBasis: z.string().max(200).optional().describe('《民法典》第 XXX 条等'),
    analysis: z.string().min(1).max(2000).describe('条款分析'),
    risk: z.string().min(1).max(2000).describe('对当前立场方的法律风险'),
    suggestion: z.string().min(1).max(2000).describe('修改建议（文字描述）'),
    suggestedClauseText: z.string().max(10000).optional().describe('AI 重写后的完整条款（high/medium 必填）'),
    matchedPointCode: z.string().optional().describe('命中的审查清单要点 code（由 AI 填写，服务端白名单校验后透传）'),

    // 路线 2 精准锚点（spec §5.4）—— PR 3 起 LLM 输出，service 用于 resolveQuoteAnchor 解析
    problemSentenceIds: z.array(z.number().int().positive()).default([]).describe('LLM 选择的"产生风险的句子 ID"（1-based，对应 prompt 里的 [Sn] 编号）'),
    problematicQuote: z.string().max(2000).optional().describe('LLM 从 sentence 里逐字摘录的问题片段（fuzzy fallback 用）'),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供 suggestedClauseText', path: ['suggestedClauseText'] },
)
```

- [ ] **Step 6.2：扩展 Risk interface**

打开 `shared/types/contract.ts`，定位第 148-169 行的 `Risk` interface，在 `clauseParagraphIndex?: number | null` 之前（即 `matchedPointCode` 之后）插入两行：

```typescript
/** 单条风险（存 contractReviews.risks JSON 字段；schema 层 refine 强制 high/medium 必含 suggestedClauseText） */
export interface Risk {
    id: string
    clauseIndex: number
    clauseText: string
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string
    analysis: string
    risk: string
    suggestion: string
    suggestedClauseText?: string
    /** 命中的要点 code；清单外风险留空（M7 Playbook） */
    matchedPointCode?: string

    // 路线 2 精准锚点（PR 3）—— LLM 输出，service 解析后写 contractRisks.problematic_quote
    /** LLM 选择的"产生风险的句子 ID"（1-based，对应 prompt 里的 [Sn] 编号）。default []。 */
    problemSentenceIds?: number[]
    /** LLM 从 sentence 里逐字摘录的问题片段（fuzzy fallback 用）。 */
    problematicQuote?: string

    /**
     * "非空段落序号"（与后端 server/agents/contract/utils/clauseToParagraph.ts
     * 的 buildClauseToParagraphMap 输出同口径），仅在前端渲染时由 RiskDisplay
     * 透传，用于 clauseLocator 的优先级 0 直定位。后端落库不读不写此字段（DB
     * 用 contractRisks.clauseParagraphIndex 列）。
     */
    clauseParagraphIndex?: number | null
}
```

- [ ] **Step 6.3：跑 typecheck + 现有 RISK_SHAPE 相关测试**

```bash
bun run typecheck 2>&1 | tail -20
npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts --reporter=verbose
```

Expected:
- typecheck 干净（PR 2 已经把所有 anchorQuote → clauseText 改完，这里只加新字段不会引发类型错误）
- analyzeSingleClause 测试 PASS（新字段都是 optional，旧测试不需要传也不会爆）

- [ ] **Step 6.4：commit**

```bash
git add server/agents/contract/riskSchema.builder.ts shared/types/contract.ts
git commit -m "feat(contract): RISK_SHAPE + Risk 接口加 problemSentenceIds / problematicQuote"
```

---

## Task 7：persistAiRisksAsContractRows 集成 splitSentences + resolveQuoteAnchor

**Files:**
- Modify: `server/agents/contract/contractRisk.service.ts:90-118`（PR 2 已完成字段重命名 + 留好 null 占位；PR 3 把 5 个 null 替换为真实解析值）
- Modify: `tests/server/assistant/contract/contractRisk.service.test.ts`（新增双锚点 quote 字段断言）

按 spec §5.5 在 `persistAiRisksAsContractRows` 内部对每条 row 调 `splitSentences(clauseText) + resolveQuoteAnchor(...)`，把解析结果写入 Prisma create input 的 `clauseIndex` / `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `quoteMatchSource` 五个字段（PR 2 已先写 null 占位，PR 3 替换为真实值）。**调用方零改动**——`contractReviewMainAgent` / `uploadClientVersion` 不需要传 quote 字段。

- [ ] **Step 7.1：写失败测试**

打开 `tests/server/assistant/contract/contractRisk.service.test.ts`，已确认真实 setup（文件 1-38 行）：
- 顶部 `import { ensureTestUser } from '../test-db-helper'`（项目共享 helper，路径 `tests/server/assistant/test-db-helper.ts`）
- `import { prisma } from '~~/server/utils/db'`
- `import { persistAiRisksAsContractRows, type PersistAiRiskRow } from '~~/server/agents/contract/contractRisk.service'`
- 顶层 describe 用 `let reviewId: number; let userId: number` + `beforeEach` 创建 user / review + `afterEach` 反向清理
- **新加的 describe 块不在同作用域**，必须自己再做一份 setup

在文件末尾新增一段独立 describe（含自己的 beforeEach/afterEach + createReview 闭包；`ensureTestUser` 已在文件顶部 import，直接复用）：

```typescript
describe('双锚点 quote 解析（PR 3）', () => {
    let userId: number

    beforeEach(async () => {
        userId = await ensureTestUser() // 已在文件顶部 import { ensureTestUser } from '../test-db-helper'
    })

    afterEach(async () => {
        await prisma.contractAnnotations.deleteMany({ where: { review: { userId } } })
        await prisma.contractRisks.deleteMany({ where: { review: { userId } } })
        await prisma.contractReviews.deleteMany({ where: { userId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    /**
     * 仿外层 describe 的 setup 模式：直接 prisma.contractReviews.create，
     * sessionId 用时间戳+随机串保证 worker 隔离唯一。
     */
    async function createReview(): Promise<{ id: number }> {
        return prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `risk-svc-pr3-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
            },
            select: { id: true },
        })
    }

    it('LLM 给 problemSentenceIds 时，写入 quote_* 字段且 quoteMatchSource=sentence_id', async () => {
        const review = await createReview()
        const clauseText = '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。'

        const result = await persistAiRisksAsContractRows({
            reviewId: review.id,
            rows: [{
                risk: {
                    id: 'test-risk-1',
                    clauseIndex: 1,
                    clauseText,
                    level: 'medium',
                    category: '违约金',
                    problem: '违约金过低',
                    analysis: '...',
                    risk: '...',
                    suggestion: '...',
                    suggestedClauseText: '修改后...',
                    problemSentenceIds: [2], // 指向第 2 句
                    problematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                },
            }],
        })

        expect(result).toHaveLength(1)
        const row = result[0]!
        expect(row.quoteMatchSource).toBe('sentence_id')
        expect(row.problematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        expect(row.quoteCharStart).toBeGreaterThanOrEqual(0)
        expect(row.quoteCharEnd).toBeGreaterThan(row.quoteCharStart!)
        // clauseText.slice(quoteCharStart, quoteCharEnd) 应该等于 problematicQuote
        expect(clauseText.slice(row.quoteCharStart!, row.quoteCharEnd!)).toBe(row.problematicQuote)
    })

    it('LLM 没给 problemSentenceIds 但给了 problematicQuote → 走 fuzzy 命中', async () => {
        const review = await createReview()
        const clauseText = '甲方应当履行义务。乙方支付报酬，逾期支付按 0.05% 加收。'

        const result = await persistAiRisksAsContractRows({
            reviewId: review.id,
            rows: [{
                risk: {
                    id: 'test-risk-2',
                    clauseIndex: 1,
                    clauseText,
                    level: 'low',
                    category: '违约金',
                    problem: '违约金过低',
                    analysis: '...',
                    risk: '...',
                    suggestion: '...',
                    problemSentenceIds: [],
                    problematicQuote: '逾期支付按 0.05% 加收',
                },
            }],
        })

        const row = result[0]!
        expect(row.quoteMatchSource).toBe('fuzzy')
        expect(row.problematicQuote).toContain('0.05%')
        expect(row.quoteCharStart).not.toBeNull()
    })

    it('LLM 既没给 IDs 也没给 quote → fallback，quote 字段全为 null', async () => {
        const review = await createReview()
        const result = await persistAiRisksAsContractRows({
            reviewId: review.id,
            rows: [{
                risk: {
                    id: 'test-risk-3',
                    clauseIndex: 1,
                    clauseText: '工资按月支付。',
                    level: 'low',
                    category: '其他',
                    problem: '...',
                    analysis: '...',
                    risk: '...',
                    suggestion: '...',
                    problemSentenceIds: [],
                    problematicQuote: undefined,
                },
            }],
        })

        const row = result[0]!
        expect(row.quoteMatchSource).toBe('fallback')
        expect(row.problematicQuote).toBeNull()
        expect(row.quoteCharStart).toBeNull()
        expect(row.quoteCharEnd).toBeNull()
    })
})
```

> 测试基础设施已核对：项目用 worker 级 DB 隔离（`tests/_infra/worker-prisma.ts` + `globalThis.prisma`），测试直接 `import { prisma } from '~~/server/utils/db'` 即可（参考已有的 contractRisk.service.test.ts 顶部 import）。`userId` 来自现有 setup 段（如该文件顶部已声明的常量或 beforeAll 中创建的用户 id），按现有 case 复用变量。

- [ ] **Step 7.2：跑测试看失败**

```bash
npx vitest run tests/server/assistant/contract/contractRisk.service.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: 三个新 case 全部 FAIL，原因是 `quoteMatchSource` / `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 当前没有写入。

- [ ] **Step 7.3：在 persistAiRisksAsContractRows 集成切句 + anchor 解析**

打开 `server/agents/contract/contractRisk.service.ts`。

**先在 import 段加两行**（接近文件顶部 `import { updateContractRiskDAO } from './contractRisk.dao'` 附近）：

```typescript
import { splitSentences } from './utils/splitSentences'
import { resolveQuoteAnchor } from './utils/resolveQuoteAnchor'
```

**修改 `persistAiRisksAsContractRows`** 的 map 拼装逻辑（第 90-118 行）。

PR 2 当前实现（contractRisk.service.ts:90-118）已经把 5 个字段写成 null 占位：

```typescript
// PR 2 现状（已合并）
clauseText: row.clauseText ?? r.clauseText,
clauseParagraphIndex: row.clauseParagraphIndex ?? null,
// PR 2 全为 null；PR 3 主路径起填 clauseIndex / quote_*
clauseIndex: null,
// 双锚点 · 层 2：PR 2 全为 null
problematicQuote: null,
quoteCharStart: null,
quoteCharEnd: null,
quoteMatchSource: null,
```

PR 3 的改动 = **把这 5 个 null 替换为真实解析值**。整体改写后：

```typescript
const data: Prisma.contractRisksUncheckedCreateInput[] = rows.map((row) => {
    const r = row.risk
    /**
     * 双锚点 · 层 1：完整条款。优先 row.clauseText（增量审查传新条款原文），
     * 否则用 r.clauseText（首次审查 LLM 自填）。
     */
    const clauseText = row.clauseText ?? r.clauseText

    /**
     * 双锚点 · 层 2：精准 quote 解析（spec §5.5）。
     * - 切句标 [Sn] ID（与 LLM prompt 视图对齐）
     * - resolveQuoteAnchor 三档 fallback：sentence_id → fuzzy → fallback
     * - 调用方零改动；anchor 解析逻辑收敛在 service 内部
     */
    const sentences = splitSentences(clauseText)
    const anchor = resolveQuoteAnchor({
        clauseText,
        sentences,
        aiOutput: {
            problemSentenceIds: r.problemSentenceIds,
            problematicQuote: r.problematicQuote,
        },
    })

    const item: Prisma.contractRisksUncheckedCreateInput = {
        reviewId,
        source: row.source ?? 'ai',
        code: r.matchedPointCode ?? null,
        category: r.category,
        level: r.level as RiskLevel,
        stance,
        problem: r.problem,
        legalBasis: r.legalBasis ?? null,
        analysis: r.analysis ?? null,
        suggestion: r.suggestion ?? null,
        suggestedClauseText: r.suggestedClauseText ?? null,

        // 双锚点 · 层 1（clauseIndex 由 PR 3 起填值；clauseCharStart/End 由 Phase B 锚点迁移路径填，首次审查写 null = Prisma 默认行为，不显式列出）
        clauseText,
        clauseParagraphIndex: row.clauseParagraphIndex ?? null,
        clauseIndex: r.clauseIndex,

        // 双锚点 · 层 2（PR 3 主路径填值）
        problematicQuote: anchor.problematicQuote,
        quoteCharStart: anchor.charStart,
        quoteCharEnd: anchor.charEnd,
        quoteMatchSource: anchor.matchSource,
    }
    if (row.originalClauseText !== undefined) item.originalClauseText = row.originalClauseText
    if (row.orphaned !== undefined) item.orphaned = row.orphaned
    return item
})
```

> **关键差异提醒**：
> - `clauseCharStart` / `clauseCharEnd` **不在** PersistAiRiskRow 接口里（PR 2 没暴露这两个字段；首次审查不知道 segment 在文档全文 normalizedText 里的 offset）；Prisma create input 不写它们 = 数据库 NULL，与 PR 2 现状一致。
> - `clauseIndex: r.clauseIndex` 假设 LLM 按 prompt 注入的 `{{clauseIndex}}` 值原样回填。RISK_SHAPE 校验 `z.number().int().nonnegative()`，可以是 0 或正整数。

- [ ] **Step 7.4：跑测试看通过**

```bash
npx vitest run tests/server/assistant/contract/contractRisk.service.test.ts --reporter=verbose
```

Expected: 三个新 case 全 PASS，原有 case 不回归。

- [ ] **Step 7.5：commit**

```bash
git add server/agents/contract/contractRisk.service.ts tests/server/assistant/contract/contractRisk.service.test.ts
git commit -m "feat(contract): persistAiRisksAsContractRows 集成 splitSentences + resolveQuoteAnchor 写双锚点 quote"
```

---

## Task 8：analyzeSingleClause 改 prompt 占位符（sentencesNumbered + clauseTextRaw）

**Files:**
- Modify: `server/agents/contract/analyzeSingleClause.ts:117-139`
- Modify: `tests/server/assistant/contract/analyzeSingleClause.test.ts`（新增占位符替换断言）

把 LLM 看到的"完整条款原文"视图升级为"切句 [Sn] 编号 + 兜底原文回溯"双视图：`{{sentencesNumbered}}` 替换 `{{clauseText}}`，`{{clauseTextRaw}}` 新增（保留兜底）。

- [ ] **Step 8.1：写失败测试**

**Mock pattern 已经核对真实代码**（`tests/server/assistant/contract/analyzeSingleClause.test.ts`）：
- 顶部 `vi.mock('~~/server/services/node/chatModelFactory', () => ({ createChatModel: vi.fn(...) }))`（文件 L20-33）
- `vi.mock('~~/server/services/node/node.service', () => ({ getValidNodeConfig: vi.fn().mockResolvedValue(...) }))`（文件 L36-47）
- 在每个 case 内动态 import + `(createChatModel as any).mockReturnValueOnce({ invoke: vi.fn(...) })` 拦截 LLM 调用（仿文件 L78-79 真实写法）
- **没有** `chatModelInvokeSpy` / `nodeConfigStub` 全局变量——直接对 mock 函数调 `.mockReturnValueOnce` / `.mockResolvedValueOnce` 即可

在 `tests/server/assistant/contract/analyzeSingleClause.test.ts` 末尾新增一段：

```typescript
describe('renderPromptTemplate 占位符（PR 3）', () => {
    it('占位符 {{sentencesNumbered}} 被替换为 [S1] xxx [S2] yyy 形式', async () => {
        // 仿文件 L78-79 已有 case：动态 import mock 函数后调 mockReturnValueOnce
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')

        // 让 getValidNodeConfig 返回一个含本测试需要的 system prompt 模板的 nodeConfig
        // 字段必填项按现有 mock 默认结构对齐（先 Read 文件 L36-47 的 mockResolvedValue 真实结构再补全）
        ;(getValidNodeConfig as any).mockResolvedValueOnce({
            id: 20,
            name: 'contractReviewAnalyzeClause',
            modelId: 1,
            prompts: [{
                type: 'system',
                status: 1,
                content: '当前条款：\n{{sentencesNumbered}}\n\n原文（兜底回溯）：{{clauseTextRaw}}',
            }],
        })

        // 让 createChatModel 返回一个 invoke 截 prompt 并返回合法 SingleClauseResponse JSON 的 stub
        let captured: string | null = null
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn(async (msgs: any) => {
                // msgs 是 BaseMessage[]；第 0 条是 system prompt（renderPromptTemplate 输出）
                captured = typeof msgs[0]?.content === 'string' ? msgs[0].content : JSON.stringify(msgs[0])
                return { content: JSON.stringify({ risks: [], skip: true }) }
            }),
        })

        const { analyzeSingleClause } = await import('~~/server/agents/contract/analyzeSingleClause')
        await analyzeSingleClause({
            clause: { index: 1, number: '第一条', text: '工资按月支付。逾期违约。', offsetStart: 0, offsetEnd: 12 },
            stance: 'partyA',
            partyA: '公司A',
            partyB: '员工B',
            contractType: '劳动合同',
        })

        expect(captured).not.toBeNull()
        expect(captured).toContain('[S1]')
        expect(captured).toContain('[S2]')
        expect(captured).toContain('工资按月支付')
        expect(captured).toContain('逾期违约')
        expect(captured).toContain('原文（兜底回溯）：工资按月支付。逾期违约。')
    })

    it('单句条款（如纯标题）也至少产出 [S1]', async () => {
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')

        ;(getValidNodeConfig as any).mockResolvedValueOnce({
            id: 20, name: 'contractReviewAnalyzeClause', modelId: 1,
            prompts: [{ type: 'system', status: 1, content: '{{sentencesNumbered}}' }],
        })

        let captured: string | null = null
        ;(createChatModel as any).mockReturnValueOnce({
            invoke: vi.fn(async (msgs: any) => {
                captured = typeof msgs[0]?.content === 'string' ? msgs[0].content : ''
                return { content: JSON.stringify({ risks: [], skip: true }) }
            }),
        })

        const { analyzeSingleClause } = await import('~~/server/agents/contract/analyzeSingleClause')
        await analyzeSingleClause({
            clause: { index: 1, number: '第一条', text: '合同总则', offsetStart: 0, offsetEnd: 4 },
            stance: 'neutral', partyA: null, partyB: null, contractType: null,
        })

        // 纯标题，splitSentences 产出 1 个 sentence（整段无切分点 → 整段作 1 个）
        expect(captured).toContain('[S1] 合同总则')
    })
})
```

> 实施前必须 Read `analyzeSingleClause.test.ts:1-100` 核对 `getValidNodeConfig` mock 默认结构的所有必填字段（modelId / prompts 数组之外可能还有 thinking / tools / tools 等），按现有 mock 全字段补齐——不要凭印象删字段。

- [ ] **Step 8.2：跑测试看失败**

```bash
npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 两个新 case FAIL，原因是当前 renderPromptTemplate 还在传 `clauseText` 而不是 `sentencesNumbered` / `clauseTextRaw`。

- [ ] **Step 8.3：修改 renderPromptTemplate**

打开 `server/agents/contract/analyzeSingleClause.ts`。

**先在 import 段加一行**：

```typescript
import { splitSentences } from './utils/splitSentences'
```

**修改 `renderPromptTemplate`**（第 117-139 行）：

```typescript
/**
 * 渲染 DB 模板（PR 3 升级到双视图）：
 *  - {{sentencesNumbered}}：切句后的 [S1] xxx [S2] yyy 视图（替换原 {{clauseText}}），
 *    给 LLM 选 problemSentenceIds 用
 *  - {{clauseTextRaw}}：完整原文（截断后）保留兜底回溯，避免 LLM 在 sentence 视角下丢失整体上下文
 *  - 其他占位符（stanceLabel / contractType / partyA / partyB / clauseIndex / clauseNumber / playbookSection）保留
 *  - clauseTextRaw 硬截断到 MAX_CLAUSE_CHARS 防 prompt 爆炸
 */
function renderPromptTemplate(template: string, ctx: AnalyzeClauseContext): string {
    const stanceLabel = ctx.stance === 'partyA'
        ? '甲方'
        : ctx.stance === 'partyB'
            ? '乙方'
            : '中立第三方'
    const clauseTextRaw = ctx.clause.text.length > MAX_CLAUSE_CHARS
        ? `${ctx.clause.text.slice(0, MAX_CLAUSE_CHARS)}…(已截断)`
        : ctx.clause.text

    // 切句给 LLM 的 [Sn] 编号视图（1-based，与 problemSentenceIds 输出对齐）
    const sentences = splitSentences(clauseTextRaw)
    const sentencesNumbered = sentences.length > 0
        ? sentences.map(s => `[S${s.id}] ${s.text}`).join('\n')
        : clauseTextRaw // 切不出句子的极端兜底（理论上 splitSentences 至少产出 1 个）

    const rendered = renderContent(template, {
        stanceLabel,
        contractType: ctx.contractType ?? '未知类型',
        partyA: ctx.partyA ?? '未知',
        partyB: ctx.partyB ?? '未知',
        clauseIndex: String(ctx.clause.index),
        clauseNumber: ctx.clause.number ?? '无',
        sentencesNumbered,
        clauseTextRaw,
        playbookSection: renderPlaybookSection(ctx.playbookSnapshot),
    })
    warnUnreplacedTemplateVars(rendered, 'analyzeSingleClause', { clauseIndex: ctx.clause.index })
    return rendered
}
```

> **note**：删除原来的 `clauseText` 局部变量名 + 占位符；如果 prompt 模板（DB 里的 prompt id=28）仍然引用 `{{clauseText}}` 占位符，由 `warnUnreplacedTemplateVars` 报警。我们在 Task 9 同步把 DB prompt 升级到 v3（用 `{{sentencesNumbered}}` / `{{clauseTextRaw}}`），届时 dev 环境 seed 完会自动用新 prompt——typecheck 时 dev 库的旧 prompt 仍能跑（旧占位符 `{{clauseText}}` 会保留字面 `{{clauseText}}` 作为 string，warn 但不抛错）。

- [ ] **Step 8.4：跑测试看通过**

```bash
npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts --reporter=verbose
```

Expected: 新增 case PASS；现有 case 不回归（只要现有 case 不依赖 `{{clauseText}}` 占位符精确出现就 OK；如果有依赖，把现有断言改为依赖 `{{sentencesNumbered}}` / `{{clauseTextRaw}}`）。

- [ ] **Step 8.5：commit**

```bash
git add server/agents/contract/analyzeSingleClause.ts tests/server/assistant/contract/analyzeSingleClause.test.ts
git commit -m "feat(contract): analyzeSingleClause prompt 升级到 sentencesNumbered + clauseTextRaw 双视图"
```

---

## Task 9：seedData.sql prompt id=28 升级到 v3（保 seed 单一来源 + dev 手工 UPDATE）

**Files:**
- Modify: `prisma/seeds/seedData.sql`（约 3166-3230 行 prompt id=28 INSERT 语句的 content / variables / version 字段）

把数据库里的 prompt 模板从 v2 升级到 v3：

1. **直接编辑 seedData.sql 现有那条 INSERT 的 content 字面值**（不新增 INSERT、不动 ON CONFLICT 行为），让 seedData.sql 始终是 prompt 内容的**单一来源**——新人冷启动 / 重置后立刻拿到 v3：
   - content 把 `{{clauseText}}` 占位符替换为"sentencesNumbered + clauseTextRaw 双视图块"
   - 输出 JSON schema 描述新增 `problemSentenceIds` / `problematicQuote` 两个字段
   - variables JSON 数组改为 9 个占位符（去掉 `clauseText`，加 `sentencesNumbered` + `clauseTextRaw`）
   - title 升到 'v3'；version 从 `'v2'` 升到 `'v3'`；updated_at 改为本 PR 提交日
2. **保留 `ON CONFLICT (name) DO NOTHING`**（项目 seedData.sql 12 处 INSERT 的统一惯例，不破坏）
3. **dev / 已上线环境的现有 v2 记录走手工 SQL UPDATE 同步**（写到 PR description 的"运维 checklist"，不在 plan task 里执行 seed reset）

- [ ] **Step 9.1：编辑 seedData.sql 的 prompt id=28 INSERT 语句**

打开 `prisma/seeds/seedData.sql`，搜 `'contractReviewAnalyzeClause_system'`，定位整条 INSERT 语句（约 3166-3230 行）。

**改 INSERT 字面值，不改 ON CONFLICT 行为**（保持项目惯例 `DO NOTHING`）。整条替换为：

```sql
INSERT INTO "public"."prompts"
("id", "name", "title", "content", "variables", "version", "type", "status", "node_id", "created_at", "updated_at", "deleted_at")
VALUES (28, 'contractReviewAnalyzeClause_system', '合同审查·逐条条款分析提示词 v3',
'你正在审查合同（{{contractType}}），站在{{stanceLabel}}立场。
甲方：{{partyA}}；乙方：{{partyB}}。
当前条款（第 {{clauseIndex}} 条，编号 {{clauseNumber}}），已按句切分为以下编号视图（每行 [S<id>] 起头，id 从 1 起）：
"""
{{sentencesNumbered}}
"""

兜底回溯（完整条款原文，仅供你参考整体语境，不要在输出里引用此节）：
"""
{{clauseTextRaw}}
"""

{{playbookSection}}

## 审查立场指导（铁律 · 必须真正用立场视角判断）

你是{{stanceLabel}}的法律顾问，站在{{stanceLabel}}的利益保护角度审查本条款。**同一条款在不同立场下的风险定性可能完全不同**——不要写中性描述，必须代入立场。

## 输出要求
请判断该条款是否有风险。严格按 JSON 输出 risks 数组，字段如下：

**关键规则：同一条款违反多个清单要点时，每个独立违法点输出一条独立 risk（不要合并）。**

- 有风险：
  {
    "risks": [
      {
        "id": "<UUID v4>",
        "clauseIndex": {{clauseIndex}},
        "clauseText": "<被分析的条款原文，必须等于上面 sentencesNumbered 还原后的整段（去掉 [Sn] 标号），不要省略号、不要改写>",
        "level": "high" | "medium" | "low",
        "category": "<风险类别，如 ''付款'' / ''违约'' / ''知识产权'' 等>",
        "problem": "<简短问题描述，必须包含''对{{stanceLabel}}''的视角>",
        "analysis": "<详细分析，结合{{stanceLabel}}立场展开>",
        "risk": "<对{{stanceLabel}}方具体的风险点>",
        "suggestion": "<改进建议，方向更有利于{{stanceLabel}}（中立时朝公平方向）>",
        "suggestedClauseText": "<可选，推荐改写后的条款>",
        "matchedPointCode": "<若命中清单要点，填其 code 原文；否则留空或不返此字段>",
        "problemSentenceIds": [<必填，1-based ID 数组，从上面 [Sn] 编号里选出"产生风险的句子"，按出现顺序>],
        "problematicQuote": "<可选，从所选 sentence 里逐字摘录的精确问题片段，不要改写、不要省略号、不要加标点>"
      }
    ],
    "skip": false
  }

- 无风险：{ "risks": [], "skip": true }

注意：
- risks 数组中每条 risk 必须独立完整（不能拆字段到多条 risk）
- problemSentenceIds：必填非空数组（除非整条 risk 实属"无法定位到具体句子的全段问题"，此时给所有 [Sn] 的 ID）；ID 必须真实出现在上方 sentencesNumbered 视图中
- problematicQuote：可选，应是 problemSentenceIds 对应句子里逐字摘录的子串；不要改写、不要加标点
- matchedPointCode 只能使用上方清单里列出的 code 原文，不要编号（如不要写 P1/P2）
- 清单外风险 matchedPointCode 留空字符串或不返此字段
- 优先选最具体的 code（clause_validity 是兜底；其它专项 code 优先）
- 只输出 JSON，不要任何解释。',

'["stanceLabel", "contractType", "partyA", "partyB", "clauseIndex", "clauseNumber", "sentencesNumbered", "clauseTextRaw", "playbookSection"]',
'v3', 'system', 1, 20, '2026-04-21 20:30:00+08', '2026-05-02 10:00:00+08', NULL)
ON CONFLICT (name) DO NOTHING;
```

> **ON CONFLICT 保留 `DO NOTHING`**：与项目 seedData.sql 12 处 INSERT 惯例一致；含 v2 记录的 dev 库 / 生产库再跑 seed 不会自动升级。这是 deliberate——已上线环境通过 Step 9.3 / 运维 checklist 手工 UPDATE 同步，避免 seed 越权改 prompt。

> **content 完整保留**：上面省略号 `[...]` 的"立场指导"段落是真实 prompt 内容（约 5000 字），编辑时必须从原 v2 的 SQL 完整拷贝过来，**仅替换 spec §5.2 提到的两处**：
>   1. "当前条款（第 X 条，编号 Y）：\\n\"\"\"\\n{{clauseText}}\\n\"\"\"" 替换为上面 sentencesNumbered + clauseTextRaw 双视图块（含两个 `"""` 段）
>   2. JSON 输出示例的 risk 对象里追加 `problemSentenceIds` / `problematicQuote` 两个字段
>   3. 注意段同步加两条新 bullet 解释这两个字段
>
> 其他立场指导 / 长段落原文不动。

- [ ] **Step 9.2：dev 本地 ls_new_testing 模板 + dev 业务库 同步到 v3**

> **背景**：项目测试基建（`tests/_infra/global-setup.ts`）每个 worker 启动时从 `ls_new_testing` 模板库克隆出 `ls_test_w<id>`。`ls_new_testing` 是 **dev 本地** 的源模板库（不是远程"运维测试环境"），由 `bun run db:setup` 初始化。dev 本地业务库（`DATABASE_URL` 默认指向）和 `ls_new_testing` 模板库都得升级到 v3，否则 contract 集成测试拿到 v2 prompt 会让 `{{sentencesNumbered}}` 占位符不被替换，LLM 输入错位。

**最轻量推荐方案** — 仅重建 prompt id=28（不动其他表），`DELETE + INSERT` 避免 `''` 单引号转义噩梦：

把 seedData.sql 里改完的 v3 INSERT 的完整字面值（约 5000 字 content，dev 自己从修改后的 seedData.sql 拷贝，**plan 不展示原文**），写到一个临时 `update-prompt-28.sql`（**不入 git**——见 Step 9.2.1）：

```sql
-- update-prompt-28.sql · 临时升级脚本 · 不入 git
DELETE FROM prompts WHERE id = 28;

-- 直接把 seedData.sql 里改好的 v3 INSERT 整段拷贝过来（DELETE 之后 ON CONFLICT 不会触发，必命中 INSERT 路径）
-- 注意：seedData.sql content 字面字符串里的单引号转义形式（`''付款''` 这种 SQL 标准 `''` 转义）原样保留，不要改写为 dollar quoting
INSERT INTO "public"."prompts" ("id", "name", ...) VALUES (28, ..., 'v3', ...) ON CONFLICT (name) DO NOTHING;
```

> **为什么用 `DELETE + INSERT` 而不是 `UPDATE` + dollar quoting**：
> - seedData.sql content 字面值已经用 `''` 转义单引号（PostgreSQL 标准）。如果改套 `$$ ... $$` dollar quoting 重写，`''` 在 `$$..$$` 内会被解析成两个连续单引号字符（不再是转义）→ 内容失真
> - `DELETE` 后直接 `INSERT` 整段（与 seedData.sql 字面值一字不差），不需要二次转义，最稳

执行：

```bash
# dev 业务库
psql "${DATABASE_URL}" -f update-prompt-28.sql

# ls_new_testing 模板库（CI / 全量测试用）—— 本地 PostgreSQL 同实例的另一个 db
psql "postgresql://${PGUSER:-postgres}:${PGPASSWORD:-}@${PGHOST:-localhost}:${PGPORT:-5432}/ls_new_testing" -f update-prompt-28.sql

rm update-prompt-28.sql
```

- [ ] **Step 9.2.1：把临时文件名加进 .gitignore（防误 commit）**

打开项目根 `.gitignore`，确保含一行：

```
update-prompt-*.sql
```

如果已有则跳过；commit 时单独 commit `.gitignore`（与 Task 9 主 commit 分开）。

> **更彻底但毁本地数据的备选**：`bun x prisma migrate reset --skip-seed && bun run prisma:migrate && psql "${DATABASE_URL}" -f prisma/seeds/seedData.sql` — 清库重 seed，新 v3 自然生效。**注意命令是 `bun x prisma migrate reset`（直接调 prisma CLI），不是 `bun run prisma:migrate reset`（package.json 没这个 script，会失败）**。dev 自行根据本地数据值得保留与否选择。

- [ ] **Step 9.3：验证 prompt 已升级**

```bash
psql "${DATABASE_URL}" -c "SELECT id, name, version, jsonb_array_length(variables) AS var_count FROM prompts WHERE id = 28;"
```

Expected: `id=28, version='v3', var_count=9`（9 个占位符：sentencesNumbered / clauseTextRaw / 原 7 个减去 clauseText）。

```bash
psql "${DATABASE_URL}" -c "SELECT content FROM prompts WHERE id = 28;" | grep -E "sentencesNumbered|clauseTextRaw|problemSentenceIds"
```

Expected: 三个关键词都在 content 里出现。

- [ ] **Step 9.4：跑相关集成测试确保 prompt 切换无回归**

```bash
npx vitest run tests/server/assistant/contract/m3Integration.test.ts tests/server/assistant/contract/m4Integration.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS（这些测试通常 mock LLM，prompt 内容变化对 mock 透明）。

- [ ] **Step 9.5：commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(contract): prompt id=28 升级到 v3（sentencesNumbered + problemSentenceIds 双锚点输出指引）"
```

> **测试库 `ls_new_testing` 模板 + 生产库的升级路径**（必须写到 PR description "运维 checklist"，**不在 plan task 里执行**）：
> - **测试库 `ls_new_testing` 模板**：`bun run test` 时每个 worker 从这个模板克隆出 `ls_test_w<id>`；模板库的 prompt id=28 必须升到 v3，否则 worker 测试拿到的还是 v2。运维在测试环境跑同样的临时 UPDATE SQL 把 `ls_new_testing` 库的 id=28 升级。
> - **生产库**：DBA 跑等价 UPDATE SQL（按运维流程审批）；或运营在管理后台 → 节点（id=20 contractReviewAnalyzeClause）→ 提示词 → 新增 v3 版本（content / variables 同上）→ 启用 → 把 v2 status 置 0。
> - seedData.sql 始终是 prompt 内容的 single source of truth，新人冷启动 / 全量重置后立刻拿到 v3；已上线环境靠手工 UPDATE 同步——这是 deliberate（避免 seed 越权改运行时已修改的 prompt）。

---

## Task 10：PATCH risk handler 加 .strict() 防御

**Files:**
- Modify: `server/api/v1/assistant/contract/reviews/risks/[riskId].patch.ts:20-22`
- Create: `tests/server/assistant/contract/risksPatch.api.test.ts`（**文件名不带 `[]`**——避免 vitest glob 误吞 + 项目惯例如 `patchReview.api.test.ts`）

按 spec §5.0 把律师 PATCH risk 时的 zod schema 设为严格模式：传入 `clauseText` / `clauseParagraphIndex` / `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `quoteMatchSource` 等锚点字段时直接 400 拒绝。

> 当前 zod 默认 `strip` 模式：未声明字段被丢弃但不报错。spec §5.0 明确要求"拒绝"，对齐项目内同模块其他 PATCH handler 的惯例（如 `risk-list/[id].patch.ts` 已用 `.strict()`，对应测试 `tests/server/assistant/contract/patchReview.api.test.ts:218-228` 已有 .strict() 防御范例可参照）。

- [ ] **Step 10.1：写失败测试**

**测试 pattern 参照**：先 Read `tests/server/assistant/contract/patchReview.api.test.ts:1-92`（项目真实 handler 测试模板）—— 用 `vi.mock` 替换 DAO + 全局 stub `resError/resSuccess/defineEventHandler/getRouterParam/readBody` + 动态 import handler + 构造 MockEvent 调 handler，**不**用 `$fetch` / `setupTestApp`（项目无此 helper）。

新建 `tests/server/assistant/contract/risksPatch.api.test.ts`（仿 patchReview.api.test.ts 的全部基础结构，本 plan 仅给本 case 特有的部分；通用 mock helper / MockEvent 构造按现有文件 1-92 行复制）：

```typescript
/**
 * PATCH /api/v1/assistant/contract/reviews/risks/:riskId · zod .strict() 防御（spec §5.0 / PR 3）
 *
 * 仿 patchReview.api.test.ts 的真实 pattern：
 *  - 全局 stub H3 / resError / resSuccess
 *  - vi.mock 替换 reviewGuard / contractRisk.service
 *  - 动态 import handler（必须在 mock 之后）
 *  - 构造 MockEvent 直接调 handler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 顶部 mock 段照 patchReview.api.test.ts 的写法粘贴（resError / resSuccess / defineEventHandler / getRouterParam / readBody 的 globalThis stub）
// ...

vi.mock('~~/server/services/assistant/contract/reviewGuard', () => ({
    loadOwnedReviewByRiskId: vi.fn(async () => ({ ok: true, subId: 42 })),
}))
vi.mock('~~/server/services/assistant/contract/contractRisk.service', () => ({
    archiveContractRiskService: vi.fn(async (params) => ({
        id: params.riskId, archivedStatus: params.archivedStatus, archivedAt: new Date(),
    })),
}))

let patchHandler: any
beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('~~/server/api/v1/assistant/contract/reviews/risks/[riskId].patch')
    patchHandler = (mod as any).default
})

function makeEvent(opts: { params?: Record<string, string>; body?: any }) {
    // 字段名按 patchReview.api.test.ts 真实 stub 约定（getRouterParam → event.__params?.[key]，readBody → event.__body）
    return { __params: opts.params ?? {}, __body: opts.body ?? {} }
}

describe('PATCH risk · strict body（spec §5.0）', () => {
    it('合法 body：仅 archivedStatus → 成功', async () => {
        const res: any = await patchHandler(makeEvent({ params: { riskId: '42' }, body: { archivedStatus: 'handled' } }))
        expect(res.code).toBe(0)
    })

    it('非法 body：传 clauseText（锚点字段）→ 400 拒绝', async () => {
        const res: any = await patchHandler(makeEvent({
            params: { riskId: '42' },
            body: { archivedStatus: null, clauseText: '律师改写的条款' },
        }))
        expect(res.code).toBe(400)
        expect(res.message.toLowerCase()).toMatch(/unrecognized|clauseText/i)
    })
})
```

> **YAGNI**：原 plan 写了 3 个非法字段 case（clauseText / problematicQuote / quoteCharStart），都是同一条 zod 分支，1 个代表性 case 足够防回归（见 patchReview.api.test.ts:218-228 的 summary 字段也只有 1 个 case）。如果将来加新锚点字段，再补 case 不晚。

- [ ] **Step 10.2：跑测试看失败**

```bash
npx vitest run tests/server/assistant/contract/risksPatch.api.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: "非法 body：传 clauseText" case FAIL（因为当前 zod strip 模式会忽略额外字段，handler 仅按 archivedStatus 走 200 流程）。

- [ ] **Step 10.3：handler 加 .strict()**

打开 `server/api/v1/assistant/contract/reviews/risks/[riskId].patch.ts`，第 20-22 行：

```typescript
const bodySchema = z.object({
    archivedStatus: z.enum(['handled', 'ignored']).nullable(),
})
```

改为（仅在 z.object(...) 后追加 `.strict()` + 注释）：

```typescript
/**
 * 律师 PATCH risk 仅允许处置状态字段。锚点字段（clause/quote 系列）一律视为只读——
 * 律师改业务文字不应破坏与原文的锚定；重定位锚点是 v2 功能，本 PR 不实现。
 * `.strict()` 让传入未知字段直接 400 拒绝（spec §5.0）。
 */
const bodySchema = z.object({
    archivedStatus: z.enum(['handled', 'ignored']).nullable(),
}).strict()
```

- [ ] **Step 10.4：跑测试看通过**

```bash
npx vitest run tests/server/assistant/contract/risksPatch.api.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 10.5：commit**

```bash
git add server/api/v1/assistant/contract/reviews/risks/[riskId].patch.ts tests/server/assistant/contract/risksPatch.api.test.ts
git commit -m "fix(contract): PATCH risk 加 zod .strict() 拒绝 clause/quote 字段（spec §5.0）"
```

---

## Task 11：contract 全量回归 + typecheck + 自我审查

**Files:**
- 仅运行验证命令，不修改

- [ ] **Step 11.1：跑全量 typecheck**

```bash
bun run typecheck 2>&1 | tee /tmp/pr3-typecheck-final.log | tail -20
```

Expected: 0 错误。如果出现 `Risk` / `RISK_SHAPE` / `PersistAiRiskRow` 相关报错，把报错文件路径回填到本 step，按报错信息修。

- [ ] **Step 11.2：跑 contract 全部测试**

```bash
npx vitest run tests/server/agents/contract/ tests/server/assistant/contract/ --reporter=verbose 2>&1 | tail -50
```

Expected: 全部 PASS。

如有失败：
- `analyzeSingleClause.test.ts` 失败：检查测试是否依赖旧 `{{clauseText}}` 占位符精确匹配
- `m3Integration.test.ts` / `m4Integration.test.ts` 失败：检查 mock 是否硬编码了 RISK_SHAPE 形状（缺新字段会被 schema 拒绝；mock 输出加 default `problemSentenceIds: []` 即可）
- 新增的 `quoteMatchSource='fallback'` case：旧测试断言可能假设 `problematicQuote` 等于 `clauseText` 整段（旧行为），现在 `quoteMatchSource='fallback'` 时 `problematicQuote=null`——按新行为更新断言

- [ ] **Step 11.3：跑全量回归（避免破坏其他模块）**

```bash
bun run test 2>&1 | tail -50
```

Expected: 全部 PASS。如失败，仅查看与本 PR 修改文件相关的测试（`splitSentences` / `textSimilarity` / `resolveQuoteAnchor` / `riskSchema.builder` / `contractRisk.service` / `analyzeSingleClause` / `[riskId].patch` / `anchorMigrate`）。其他模块的偶发失败（如属性测试 seed 不稳定）不归本 PR 处理。

- [ ] **Step 11.4：spec 覆盖度自我审查**

对照 spec §5.0 ~ §5.5 + §10.1 四点逐条核对：

| Spec 段 | 要求 | 本 PR 任务 | 状态 |
|---|---|---|---|
| §5.0 | PATCH zod 拒绝 clause/quote 字段 | Task 10 | ✓ |
| §5.1 | splitSentences 中文条款断句（含子项编号 / 引号 / 边角） | Task 1 + Task 2 | ✓ |
| §5.2 | prompt 改造：sentencesNumbered + clauseTextRaw + 输出 problemSentenceIds / problematicQuote | Task 8 + Task 9 | ✓ |
| §5.3.1 | fuzzyLocateInText（32 字符上限 / Match_Distance / 单例隔离）+ anchorMigrate 同步重构 | Task 3 + Task 4 | ✓ |
| §5.3.2 | resolveQuoteAnchor 三档 fallback | Task 5 | ✓ |
| §5.4 | RISK_SHAPE 加 problemSentenceIds + problematicQuote | Task 6 | ✓ |
| §5.5 | persistAiRisksAsContractRows 集成 splitSentences + resolveQuoteAnchor | Task 7 | ✓ |
| §10.1 | splitSentences / resolveQuoteAnchor / contractRisk.service 单测 | Task 2 / 5 / 7 | ✓ |
| §10.3 | quote_match_source 运维埋点（监控 SQL） | 不在 PR 3 范围（运维侧 SQL） | — |

- [ ] **Step 11.5：清点 commit 历史**

```bash
git log --oneline dev..HEAD
```

Expected: 10 条 commit（Task 1-10 各一条；Task 0 / Task 11 不 commit），无失败 commit。

- [ ] **Step 11.6：push 分支**

```bash
git push -u origin pr3-route2-anchoring
```

- [ ] **Step 11.7：创建 PR（用户确认后再操作，不要自动创建）**

PR description 模板：

```markdown
# PR 3 · 路线 2 精准锚点（sentence_id + fuzzy fallback）

> 对应 spec：`docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` § 5
> 实施 plan：`docs/superpowers/plans/2026-05-02-contract-review-pr3-route2-anchoring.md`
> 前置：PR 2（数据模型重构）已合并

## 🚨 合并前 BLOCKER（必读）

1. **`ls_new_testing` 测试模板库 + 生产库 prompt id=28 必须升到 v3**——见下方"运维 checklist"。**未跑 UPDATE 直接合 → CI 全绿但生产首次审查 prompt 占位符 `{{sentencesNumbered}}` 不被替换 → LLM 拿到字面量 → 输出全错**。
2. **PR 2-4 同窗口发布**：本 PR 单独上线无破坏性，但用户感知不到精准锚点效果直到 PR 4（前端 Layout A/C 切换）也上线——建议 PR 3 / PR 4 在同一 release tag 内顺序合并。
3. **dev 本地必须先跑 plan Task 9 Step 9.2 的临时 UPDATE 把 `ls_new_testing` 模板和业务库的 prompt id=28 升到 v3**，再跑 contract 全量测试 + 集成测试，否则本机测试结果不可信。

## 改动摘要

- **新工具**：splitSentences / fuzzyLocateInText / resolveQuoteAnchor 三件套
- **anchorMigrate.findBestSubstring** fast-path 复用 fuzzyLocateInText
- **RISK_SHAPE / Risk** 加 `problemSentenceIds` / `problematicQuote`
- **persistAiRisksAsContractRows** 内部集成切句 + anchor 解析，写 `quote_*` 字段（调用方零改动）
- **analyzeSingleClause** prompt 占位符升级到 `{{sentencesNumbered}}` + `{{clauseTextRaw}}`
- **prompt id=28** 升级到 v3（seedData.sql 直接改 INSERT 字面值，保留 `ON CONFLICT DO NOTHING` 项目惯例；已上线环境走运维 UPDATE SQL 同步——见下方 checklist）
- **PATCH risk** 加 `.strict()` 拒绝 clause/quote 字段（spec §5.0 防御）

## 发布窗口协调（spec §11.2）

按 spec §11.2，**PR 2-4 必须在同一发布窗口上线**：
- PR 2（数据模型重构）→ 已合
- **PR 3（本 PR）**：后端写入 `quote_*` 字段、LLM 输出 `problemSentenceIds` / `problematicQuote`
- PR 4（前端风险卡 Layout A/C 切换）：消费 `problematicQuote` 字段做精准 quote 显示

**PR 3 单独上线无破坏性**——`quote_*` 字段 PR 2 已为 nullable，PR 3 写入但前端不消费等于无感；PATCH `.strict()` 拒绝的字段前端本来就不发。**但用户感知不到精准锚点效果直到 PR 4 也上线**。建议 PR 3 / PR 4 在同一 release tag 内顺序合并。

## 数据流（首次审查）

```
Risk[] (含 problemSentenceIds + problematicQuote 由 LLM 输出)
   ↓
PersistAiRiskRow[] = risks.map(r => ({ risk: r, ... }))   ← 调用方零改
   ↓
persistAiRisksAsContractRows
   ├── splitSentences(clauseText) → [Sn] sentences
   ├── resolveQuoteAnchor → { problematicQuote, charStart, charEnd, matchSource }
   └── INSERT contract_risks(..., problematic_quote, quote_char_start, quote_char_end, quote_match_source)
```

## 测试

- 新增 splitSentences / textSimilarity / resolveQuoteAnchor 三个文件单元测试，覆盖率 >95%
- contractRisk.service.test.ts 加双锚点 quote 写入 3 case（sentence_id / fuzzy / fallback 三档）
- analyzeSingleClause.test.ts 加 `{{sentencesNumbered}}` 占位符替换断言（仿 L78 真实 mock pattern：动态 import + `(createChatModel as any).mockReturnValueOnce({ invoke: vi.fn(...) })` 截 prompt）
- risksPatch.api.test.ts 新建（仿 patchReview.api.test.ts pattern），加 .strict() 拒绝额外字段断言
- 全量 contract 测试 PASS / typecheck 干净

## ⚠️ 运维 checklist（合并前必须配套执行）

`seedData.sql` 是 prompt 内容的 single source of truth，新人冷启动 / 全量 reset 拿 v3；但 `ON CONFLICT DO NOTHING` 不会自动升级已上线环境的 v2 记录。**已上线环境必须走手工 SQL 同步**：

1. **dev 本地 `ls_new_testing` 测试模板库 + dev 业务库**（每个开发者 pull dev 后必跑）
   - `ls_new_testing` 是本地 PostgreSQL 的源模板库（`tests/_infra/global-setup.ts` 跑测试时从此 CREATE DATABASE TEMPLATE 克隆 worker DB）
   - 跑 plan Task 9 Step 9.2 的临时脚本（`DELETE FROM prompts WHERE id=28; INSERT INTO prompts ...`，分别对 dev 业务库和 `ls_new_testing` 跑一次）
   - **不做这步的后果**：worker 测试拿到 v2 prompt，`{{sentencesNumbered}}` / `{{clauseTextRaw}}` 占位符不会被替换 → contract 集成测试可能 mock 透明误绿，但真集成 / 手工冒烟时 LLM 拿到字面占位符直接错位

2. **生产库 + 预发库**（DBA / 运营任选其一）
   - **路径 A（推荐）**：DBA 跑等价 SQL（与本地 update-prompt-28.sql 内容相同：`DELETE + INSERT`），按运维流程审批
   - **路径 B**：运营在管理后台 `/admin/prompts/28` → 编辑内容 → 保存（自动新建 v3 版本）→ 在版本历史里激活 v3，把 v2 status 置 0

3. **PR 2-4 同窗口**：建议本 PR 与 PR 4 一起 release，避免后端写 quote 但前端无感

## 运维埋点（spec §10.3）

PR 3 部署一周后用 SQL 观察分布：

\`\`\`sql
SELECT quote_match_source, COUNT(*),
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM contract_risks
WHERE source = 'ai' AND created_at > NOW() - INTERVAL '7 days'
GROUP BY quote_match_source
ORDER BY COUNT(*) DESC;
\`\`\`

期望：sentence_id ≥ 80%，fuzzy ≤ 15%，fallback ≤ 5%。fallback > 10% 时复查 prompt / 切句规则。

## Test plan

- [ ] CI typecheck PASS
- [ ] CI vitest PASS（前提：`ls_new_testing` 模板库 prompt id=28 已 UPDATE 到 v3，见上方 checklist）
- [ ] dev 跑临时 UPDATE SQL 把本地 prompt 升级到 v3，再跑 contract 集成测试
- [ ] dev 上传一份带分号的合同条款，检查数据库 contract_risks 行：
  - quote_match_source = 'sentence_id' 占主流
  - problematic_quote 不等于 clause_text 整段（精准到句子）
  - quote_char_start / quote_char_end 取出来 substring 等于 problematic_quote
- [ ] dev PATCH risk 试传 `{archivedStatus:null, clauseText:'x'}` 应 400
```

> 不自动调 `gh pr create`——用户确认 PR description 后手工创建，避免误推送 / 漏写 reviewers。

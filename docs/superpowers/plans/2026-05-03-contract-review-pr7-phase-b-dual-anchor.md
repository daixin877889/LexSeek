# 合同审查 PR7 · Phase B 锚点迁移升级（双锚点优先级） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `uploadClientVersion.service.ts` Step 5 的"单锚点（clauseText）漂移迁移"升级为"双锚点优先级（quote 优先 → clause fallback → orphaned）"，让客户回传链路在条款被改写后，仍能依靠 PR3 落地的 `problematicQuote` 精确锚点把风险卡牢牢钉在原句子上；条款大改时降级到 clauseText 模糊匹配（quote 字段置 null）；两档都失败才置 `orphaned=true`。

**Architecture:** 在 `server/agents/contract/utils/anchorMigrate.ts` 新增高层 wrapper `migrateRiskWithDualAnchor`：内部档 1 调 `fuzzyLocateInText`（PR3 已落地）在客户新 docx 全文 `normalizedText` 上查 `problematicQuote`，命中位置回查 `newClauses[]` 找包含的 segment，把 quote 重新摘录 + 在新 clauseText 内的相对 offset 重算；档 1 失败（无 quote / fuzzy 不命中 / 跨段 / 长 quote 末段相似度过低）落入档 2，复用既有 `migrateAnchor` 走 clauseText 模糊匹配；都失败返回 null。`uploadClientVersion.service.ts` Step 5 的 `for (const r of dbRisks)` 循环把现有 `migrateAnchor` 调用替换为新 wrapper，并按 matchType 决定如何写双锚点 7 字段（`clauseText` / `clauseIndex` / `clauseCharStart/End` / `problematicQuote` / `quoteCharStart/End` 是否清空）。`originalClauseText` 写入条件收紧为「clauseText 实际变化 + 旧值非空」（Spec §9.3）。

**与 spec §9.1 现状描述的差异说明**：spec §9.1 描述的 `r.anchorQuote.includes(oldClauseHead)` 旧实现已被前置 PR 重构为 `findOldClauseArrayIdxByAnchor` + `clauseDiffResult` 路由（`uploadClientVersion.service.ts:798-868`）。本 PR 在重构后的代码上把 modified/removed/null 三个分支的 `migrateAnchor` 单调用升级为 `migrateRiskWithDualAnchor` 双锚点 wrapper，clauseDiff 路由层不动。

**关于 spec §12 feature flag 的取舍（与用户确认放弃）**：spec §12 建议"保留旧逻辑作为 feature flag 兜底 1 周"。**本 plan 不实现 flag**，理由：(1) wrapper 的档 2 (clause fuzzy fallback) 就是旧 `migrateAnchor` 的等价行为——软兜底已天然存在；(2) PR2 已 drop `anchor_*` 5 字段，flag-off 路径无法实现完全等价；(3) 客户回传链路本身有完整事务回滚 + status=failed + Step 4 风险新增同样回滚的多层保护（`uploadClientVersion.service.ts:702 / :895`）。如上线后档 1 误命中率超预期，回退手段是 hot-fix 把 wrapper 档 1 短路（一行 `return null`），不需要 flag。

**Tech Stack:** TypeScript / Vitest / Prisma / diff-match-patch（已封装）。复用 `fuzzyLocateInText` / `migrateAnchor` / `ClauseSnapshotItem` / 既有 worker 级 DB 隔离测试基建。

**Spec:** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md`（PR7 范围 = §9 + §11.7 + §12 风险点 "Phase B 双锚点迁移逻辑改动大易回归"）

**前置（已落地，验证完毕）：**

- `fuzzyLocateInText(text, pattern) → { start, end } | null`（`server/agents/contract/utils/textSimilarity.ts:97-128`）
- `migrateAnchor({ oldAnchorQuote, preferredNewClauseArrayIdx, newClauses }) → AnchorMigrateResult | null`（`server/agents/contract/utils/anchorMigrate.ts:103-149`）
- `ClauseSnapshotItem { index: number; text: string; offsetStart: number; offsetEnd: number }`（`shared/types/contract.ts:453-458`，`segmentClauses` 1-based `index`）
- `contractRisks` 表已有 11 个双锚点字段（`prisma/models/contractRiskAndAnnotation.prisma:26-62`）
- `quoteMatchSource` 字面量 union: `'sentence_id' | 'fuzzy' | 'fallback' | null`（`shared/types/contract.ts:519`）
- `uploadClientVersionService` Step 5 现有迁移循环（`server/agents/contract/uploadClientVersion.service.ts:813-868`）已用 `findOldClauseArrayIdxByAnchor` + `clauseDiffResult` 做 modified/removed/unchanged/null 路由
- `Step 5+6 一次事务` 已有 `tx.contractRisks.update` + `syncReviewRisksJsonb(review.id, tx)` 同事务保证（`uploadClientVersion.service.ts:702 / :873`）

**工期：** 2 天 × 9 个 Task

---

## 文件结构

### 新增（2）

- `tests/server/assistant/contract/utils/_clauseFixture.ts` — 共享 fixture helper（封装 `segmentClauses` 真实切句，1-based index 与生产对齐；供 PR7+ 后续测试复用）
- `tests/server/assistant/contract/utils/migrateRiskWithDualAnchor.test.ts` — `migrateRiskWithDualAnchor` 三档 fallback 单元测试

### 修改（4）

- `server/agents/contract/utils/anchorMigrate.ts` — 新增 `migrateRiskWithDualAnchor` 高层 wrapper + `DualAnchorMigrateInput` / `DualAnchorMigrateResult` 类型导出（含档 1 命中后相似度二次校验）
- `server/agents/contract/uploadClientVersion.service.ts` — Step 5 迁移循环（lines 813-868）替换为新 wrapper；按 matchType 写双锚点 7 字段；`originalClauseText` 收紧条件
- `tests/server/agents/contract/uploadClientVersion.service.test.ts` — 新增 6 条 Phase B 双锚点迁移集成测试（档 1 命中 / 档 1 长 quote 相似度二次校验 / 档 2 fallback / 档 3 orphaned / orphaned 复活 / unchanged 路径 / 老 risk 全 null 兼容）
- `docs/tech-docs/backend/contract.md` — 新增「Phase B 双锚点迁移」段（与 PR3 的「双锚点」段衔接，含运维监控 SQL 排除迁移行的说明）

---

## Task 0：新增共享 fixture helper（`_clauseFixture.ts`）

**Why this Task exists**: 既有 `tests/server/assistant/contract/utils/anchorMigrate.test.ts:5-12` 与 `clauseDiff.test.ts:6` 各自手写了一份 `makeClauses(texts)`，且都用 0-based `index`（与生产 `segmentClauses` 1-based 不一致——既存的 fixture bug，因为旧测试不断言 `index` 字段所以未暴露）。PR7 测试需要真实 `segmentClauses` 产物（spec/审查要点 #2：手工拼装的 `offset += text.length + 1` 在多行 segment / 段间空行场景下与生产偏移不一致，会让单测全绿但生产踩边角）。把 helper 抽到独立文件，PR7 测试用真值；旧 0-based 测试本 PR 不迁（属超 PR7 范围 refactor）。

**Files:**
- Create: `tests/server/assistant/contract/utils/_clauseFixture.ts`

- [ ] **Step 1：写共享 helper**

```typescript
/**
 * 合同测试共享 fixture：用真实 segmentClauses 切句产生 (newClauses, newDocxText)。
 *
 * 为什么不用手工拼装：
 *   - segmentClauses 内部用 lineStarts + trim offset 计算 offsetStart/End，段间空行 / 子项编号会
 *     让 segment 间的 char gap 不固定为 1（不是简单的 \n 分隔）。手工 fixture 的 `offset += text.length + 1`
 *     在多行 segment 上失真，单测全绿但生产偏移对不上。
 *   - 直接用真值才能让档 1 的 fuzzyLocateInText + segment 包含校验得到生产同等行为。
 *
 * 适用范围：所有需要 ClauseSnapshotItem[] + normalizedText 的合同业务测试。
 *
 * **Feature: contract-review-precise-anchoring**
 */
import type { ClauseSnapshotItem } from '#shared/types/contract'
import { segmentClauses } from '~~/server/agents/contract/docx/clauseSegmenter'

/**
 * 用真实 segmentClauses 把段落数组切成 ClauseSnapshotItem[] + normalizedText。
 *
 * @param paragraphs 一组段落（每段对应 docx 里一个 \<w:p\>）
 * @returns { newClauses, newDocxText } 与生产 uploadClientVersion Step 2 同等产物
 */
export async function makeClauseFixture(paragraphs: string[]): Promise<{
    newClauses: ClauseSnapshotItem[]
    newDocxText: string
}> {
    const { segments, normalizedText } = await segmentClauses(paragraphs.join('\n'))
    const newClauses: ClauseSnapshotItem[] = segments.map(s => ({
        index: s.index, // segmentClauses 1-based
        text: s.text,
        offsetStart: s.offsetStart,
        offsetEnd: s.offsetEnd,
    }))
    return { newClauses, newDocxText: normalizedText }
}
```

- [ ] **Step 2：跑 typecheck**

Run: `bun run typecheck`
Expected: PASS（新 helper 未被引用允许，下个 Task 引入）

- [ ] **Step 3：commit**

```bash
git add tests/server/assistant/contract/utils/_clauseFixture.ts
git commit -m "test(contract): 抽 makeClauseFixture 共享 helper（用真实 segmentClauses 切句）

为 PR7 双锚点迁移测试提供真值 fixture（段间偏移与生产 segmentClauses 一致）。
既有 anchorMigrate / clauseDiff 测试的 0-based makeClauses bug 暂不迁（超 PR7 范围）。"
```

---

## Task 1：新增 `migrateRiskWithDualAnchor` 单元测试（先写测试，TDD RED）

**Files:**
- Create: `tests/server/assistant/contract/utils/migrateRiskWithDualAnchor.test.ts`

- [ ] **Step 1：写测试文件**

```typescript
/**
 * migrateRiskWithDualAnchor 单元测试
 *
 * Spec §9.2 三档 fallback：
 *   档 1：problematicQuote 在 newDocxText 上 fuzzy 命中 → 回查 newClauses 找包含的 segment
 *         （命中后做相似度二次校验，长 quote >32 字 Bitap probe 仅前 32 字会假阳）
 *   档 2：档 1 失败（quote 为 null / fuzzy miss / 跨段 / 相似度过低）→ migrateAnchor 走 clauseText
 *   档 3：两档都失败 → null
 *
 * **Feature: contract-review-precise-anchoring**
 * **Validates: spec §9.2**
 */
import { describe, it, expect } from 'vitest'
import { migrateRiskWithDualAnchor } from '~~/server/agents/contract/utils/anchorMigrate'
import { makeClauseFixture } from './_clauseFixture'

describe('migrateRiskWithDualAnchor', () => {
    describe('档 1：quote 优先', () => {
        it('quote 在新文档完全相同位置：matchType=quote, 重摘 quote + 重算 segment 内偏移', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
                '第二条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('quote')
            expect(result!.newClauseArrayIdx).toBe(1)
            expect(result!.newClauseText).toBe(newClauses[1]!.text)
            expect(result!.newClauseCharStart).toBe(newClauses[1]!.offsetStart)
            expect(result!.newClauseCharEnd).toBe(newClauses[1]!.offsetEnd)
            expect(result!.newProblematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
            expect(result!.newQuoteCharStart).toBeGreaterThanOrEqual(0)
            // segment 内相对 offset 切片应等于 quote 原文
            expect(
                result!.newClauseText.slice(result!.newQuoteCharStart!, result!.newQuoteCharEnd!),
            ).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        })

        it('quote 落到了不同的 clause 上（条款顺序被客户调整）：matchType=quote, newClauseArrayIdx 跟着 quote 走', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
                '第二条 甲方应当按时支付货款。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 1, // 先验是错的
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('quote')
            expect(result!.newClauseArrayIdx).toBe(0) // 跟着 quote 走，不是 preferredIdx
            expect(result!.newProblematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        })

        it('长 quote (>32 字 Bitap probe 上限)：命中后相似度校验通过 → 档 1', async () => {
            // 80 字 quote，超过 dmp Match_MaxBits=32，wrapper 必须在 fuzzy 命中后做相似度二次校验
            // 这条 case 防止"档 1 假阳"（probe 前 32 字命中但 hit.end 推算落在不相关字符上）
            const longQuote = '乙方逾期支付货款超过 30 日的，甲方有权单方解除合同，并要求乙方按合同总价 20% 支付违约金，且不影响甲方就实际损失追偿权利'
            const newClauseText = `第三条 ${longQuote}。`
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 双方应诚实信用履行本合同。',
                newClauseText,
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: newClauseText, // 内容未改
                oldProblematicQuote: longQuote,
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('quote')
            expect(result!.newProblematicQuote).toBe(longQuote)
            // 切片回原 quote
            expect(
                result!.newClauseText.slice(result!.newQuoteCharStart!, result!.newQuoteCharEnd!),
            ).toBe(longQuote)
        })

        it('长 quote 后半被改写：fuzzy 前 32 字命中但相似度校验不过 → 落档 2', async () => {
            // 旧 quote 80 字，新文档把 quote 后 50 字改写但保留前 30 字 → Bitap probe 命中但 slice 后相似度低
            const oldQuote = '乙方逾期支付货款超过 30 日的，甲方有权单方解除合同，并要求乙方按合同总价 20% 支付违约金，且不影响甲方就实际损失追偿权利'
            const newClauseText = '第三条 乙方逾期支付货款超过 30 日的，双方应当友好协商解决争议，必要时可以申请仲裁。'
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 双方应诚实信用履行本合同。',
                newClauseText,
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第三条 ' + oldQuote + '。',
                oldProblematicQuote: oldQuote,
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            // 不强求一定 match 成功（取决于 clauseText fuzzy 阈值），但绝不能档 1 假阳
            // 档 1 假阳的表现是 matchType='quote' + newProblematicQuote 不等于 oldQuote
            if (result?.matchType === 'quote') {
                throw new Error(`档 1 假阳：probe 命中但相似度未守住，得到 quote=${result.newProblematicQuote}`)
            }
            // 期望落档 2 或 orphaned 都可接受
            expect(result === null || result.matchType === 'clause').toBe(true)
        })
    })

    describe('档 2：clause fallback', () => {
        it('quote 为 null（PR3 之前的旧 risk）：直接走 clauseText fuzzy', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
                '第二条 乙方应在收款后 7 日内交付货物。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物。',
                oldProblematicQuote: null,
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('clause')
            expect(result!.newClauseArrayIdx).toBe(1)
            expect(result!.newClauseText).toBe(newClauses[1]!.text)
            expect(result!.newClauseCharStart).toBe(newClauses[1]!.offsetStart)
            expect(result!.newClauseCharEnd).toBe(newClauses[1]!.offsetEnd)
            expect(result!.newProblematicQuote).toBeNull()
            expect(result!.newQuoteCharStart).toBeNull()
            expect(result!.newQuoteCharEnd).toBeNull()
        })

        it('quote 在新文档已被客户彻底删除：fuzzy miss → 落档 2', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
                '第二条 乙方应在收款后 7 日内交付货物。', // 删掉了"逾期"那一句
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物，逾期支付的，每日按 0.05% 加收滞纳金。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('clause')
            expect(result!.newClauseArrayIdx).toBe(1)
            expect(result!.newProblematicQuote).toBeNull()
            expect(result!.newQuoteCharStart).toBeNull()
        })

        it('quote 太短（<4 字符）：跳过档 1，走档 2', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                '第一条 甲方应当按时支付货款。',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第一条 甲方应当按时支付货款。',
                oldProblematicQuote: '货款', // 2 字符
                preferredNewClauseArrayIdx: 0,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            expect(result!.matchType).toBe('clause')
        })
    })

    describe('档 3：orphaned', () => {
        it('quote miss + clause 也找不到（条款完全被替换）：返回 null', async () => {
            const { newClauses, newDocxText } = await makeClauseFixture([
                'XYZXYZXYZ ABCABC DEF GHIJKL MNOPQRSTUVWXYZ啊啊啊啊啊啊啊啊啊啊啊啊啊',
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第二条 乙方应在收款后 7 日内交付货物。',
                oldProblematicQuote: '逾期支付的，每日按 0.05% 加收滞纳金',
                preferredNewClauseArrayIdx: 0,
                newClauses,
                newDocxText,
            })
            expect(result).toBeNull()
        })

        it('newClauses 为空：返回 null', () => {
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '第一条 甲方应支付。',
                oldProblematicQuote: '甲方应支付',
                preferredNewClauseArrayIdx: null,
                newClauses: [],
                newDocxText: '',
            })
            expect(result).toBeNull()
        })
    })

    describe('档 1 边界：quote 跨 segment 边界', () => {
        it('quote 起点在某 segment 内但终点超过该 segment：判档 1 失败，落档 2', async () => {
            // 构造一个边界场景：quote 起点 = segment[0] 末尾，终点会超过 offsetEnd
            const { newClauses, newDocxText } = await makeClauseFixture([
                '前段',                                  // segment[0]
                '后段且包含很长的内容用于 fallback 命中', // segment[1]
            ])
            const result = migrateRiskWithDualAnchor({
                oldClauseText: '后段且包含很长的内容用于 fallback 命中',
                oldProblematicQuote: '段\n后段', // quote 跨越段间 \n
                preferredNewClauseArrayIdx: 1,
                newClauses,
                newDocxText,
            })
            expect(result).not.toBeNull()
            // quote 跨段 → 档 1 失败 → 走档 2 → 命中 segment[1]
            expect(result!.matchType).toBe('clause')
            expect(result!.newClauseArrayIdx).toBe(1)
        })
    })
})
```

- [ ] **Step 2：跑测试，确认 RED**

Run: `npx vitest run tests/server/assistant/contract/utils/migrateRiskWithDualAnchor.test.ts`
Expected: FAIL，错误形如 `migrateRiskWithDualAnchor is not exported by '~~/server/agents/contract/utils/anchorMigrate'`

- [ ] **Step 3：commit**

```bash
git add tests/server/assistant/contract/utils/migrateRiskWithDualAnchor.test.ts
git commit -m "test(contract): migrateRiskWithDualAnchor 三档 fallback 单测蓝图

Spec §9.2 双锚点优先级（quote 优先 → clause fallback → orphaned）。
此 commit 故意 RED，下个 commit 实现 wrapper 让其 GREEN。"
```

---

## Task 2：实现 `migrateRiskWithDualAnchor` wrapper（GREEN）

**Files:**
- Modify: `server/agents/contract/utils/anchorMigrate.ts`

- [ ] **Step 1：在 `anchorMigrate.ts` 文件末尾追加新 wrapper**

```typescript
/**
 * Phase B 锚点迁移 · 双锚点优先级（spec §9.2）
 *
 *  档 1（quote 优先）：用 oldProblematicQuote 在客户新 docx normalizedText 上做 dmp 模糊匹配。
 *      命中后回查 newClauses 找包含命中 offset 的 segment：
 *        - 找到 + quote 完全落在该 segment 内 → 写新 clauseText (= segment.text 全段) + 重摘 quote +
 *          quoteCharStart/End 重算（在新 clauseText 内的相对 offset）
 *        - 跨 segment 边界 → 视为档 1 失败，落入档 2
 *
 *  档 2（clause fallback）：复用既有 migrateAnchor 走 clauseText 模糊匹配（既有 fast-path + 全局扫）。
 *      命中后写新 clauseText (= segment.text 全段) + 清空 quote 字段。
 *
 *  档 3（orphaned）：两档都失败 → 返回 null（调用方置 orphaned=true）。
 *
 *  设计要点：
 *    - clauseText 写入用 segment.text 全段，不再像旧实现那样取 newCharStart..newCharEnd 切片
 *      （旧切片源自单锚点模型，会丢上下文；双锚点下层 1 完整、层 2 精确，clauseText 必须保完整）
 *    - clauseCharStart/End 用 segment.offsetStart/End（文档全文 normalizedText 内的 offset，符合
 *      schema 注释 "clause 在文档全文 normalizedText 里的 offset"）
 *    - quoteMatchSource 由调用方决定（档 1 沿用旧值 / 档 2 置 null），wrapper 不返回该字段
 *    - 短 quote (< 4 字符) 直接跳过档 1：fuzzy 在短串上误命中率高，不如直接走 clauseText
 *    - 长 quote (> 32 字) 命中后做相似度二次校验：dmp Match_MaxBits=32，fuzzyLocateInText 用前 32 字
 *      做 Bitap probe，hit.end = hit.start + pattern.length 是按原长度推算的——hit.end 之外的字符
 *      未参与匹配。生产合同 quote 普遍 30-100 字，必须用 calcSimilarity 把 segment 内切片与原 quote
 *      做 Levenshtein 比对，相似度 < SIMILARITY_THRESHOLD 视为档 1 假阳，落入档 2。
 */
import type { ClauseSnapshotItem } from '#shared/types/contract'
import { calcSimilarity, fuzzyLocateInText } from './textSimilarity'

export interface DualAnchorMigrateInput {
    /** 旧 risk 的完整条款原文（档 2 fallback 用） */
    oldClauseText: string
    /** 旧 risk 的精确问题片段（档 1 主路径用；null / 太短 时直接跳过档 1） */
    oldProblematicQuote: string | null
    /** clauseDiff 已识别出的"老条款 → 新条款"映射的 newIndex；无先验时 null */
    preferredNewClauseArrayIdx: number | null
    /** 客户回传 docx 重切的新条款数组（segmentClauses 产出） */
    newClauses: ClauseSnapshotItem[]
    /** 客户回传 docx 全文 normalizedText（档 1 在全文上 fuzzy） */
    newDocxText: string
}

export interface DualAnchorMigrateResult {
    /** 命中档位 */
    matchType: 'quote' | 'clause'
    /** 在 newClauses 数组里的下标（0-based） */
    newClauseArrayIdx: number
    /** 新 clauseText（segment.text 全段，不切片） */
    newClauseText: string
    /** 新 clauseText 在文档全文 normalizedText 内的 offset */
    newClauseCharStart: number
    newClauseCharEnd: number
    /** 仅档 1 有值；档 2 为 null */
    newProblematicQuote: string | null
    /** 在新 clauseText 内的相对 offset；档 2 为 null */
    newQuoteCharStart: number | null
    newQuoteCharEnd: number | null
}

/** quote 字符数太短时跳过档 1 的最小阈值（与 resolveQuoteAnchor 档 2 同口径） */
const MIN_QUOTE_LEN_FOR_TIER1 = 4
/** 档 1 命中后相似度二次校验阈值（与 migrateAnchor 默认 similarityThreshold=0.6 同口径） */
const TIER1_SIMILARITY_THRESHOLD = 0.6

export function migrateRiskWithDualAnchor(input: DualAnchorMigrateInput): DualAnchorMigrateResult | null {
    const { oldClauseText, oldProblematicQuote, preferredNewClauseArrayIdx, newClauses, newDocxText } = input

    if (newClauses.length === 0) return null

    // ===== 档 1：quote 优先 =====
    const quote = oldProblematicQuote?.trim() ?? ''
    if (quote.length >= MIN_QUOTE_LEN_FOR_TIER1 && newDocxText.length > 0) {
        const hit = fuzzyLocateInText(newDocxText, quote)
        if (hit) {
            // 找包含 hit.start 的 segment
            const segIdx = newClauses.findIndex(s => s.offsetStart <= hit.start && hit.start < s.offsetEnd)
            if (segIdx !== -1) {
                const segment = newClauses[segIdx]!
                // 严格校验 quote 完全落在该 segment 内（不跨段）
                if (hit.end <= segment.offsetEnd) {
                    const quoteStartInSegment = hit.start - segment.offsetStart
                    const quoteEndInSegment = hit.end - segment.offsetStart
                    const candidate = segment.text.slice(quoteStartInSegment, quoteEndInSegment)
                    // 长 quote 假阳保护：dmp Match_MaxBits=32，>32 字 quote 用前 32 字 probe，
                    // hit.end 是按原 length 推算（>32 字部分未参与匹配）→ 必须做相似度二次校验。
                    // 短 quote (<=32) 也走这一步是保险（calcSimilarity 单字符比对成本极低）。
                    if (calcSimilarity(quote, candidate) >= TIER1_SIMILARITY_THRESHOLD) {
                        return {
                            matchType: 'quote',
                            newClauseArrayIdx: segIdx,
                            newClauseText: segment.text,
                            newClauseCharStart: segment.offsetStart,
                            newClauseCharEnd: segment.offsetEnd,
                            newProblematicQuote: candidate,
                            newQuoteCharStart: quoteStartInSegment,
                            newQuoteCharEnd: quoteEndInSegment,
                        }
                    }
                    // 相似度未达阈值 → 档 1 假阳，落档 2
                }
            }
        }
    }

    // ===== 档 2：clause fallback（复用 migrateAnchor）=====
    const clauseResult = migrateAnchor({
        oldAnchorQuote: oldClauseText,
        preferredNewClauseArrayIdx,
        newClauses,
    })
    if (clauseResult) {
        const segment = newClauses[clauseResult.newClauseIndex]!
        return {
            matchType: 'clause',
            newClauseArrayIdx: clauseResult.newClauseIndex,
            // 注意：用 segment.text 全段，不用 slice(newCharStart..newCharEnd)
            // ——双锚点模型下 clauseText 是层 1 完整条款，必须保完整上下文
            newClauseText: segment.text,
            newClauseCharStart: segment.offsetStart,
            newClauseCharEnd: segment.offsetEnd,
            newProblematicQuote: null,
            newQuoteCharStart: null,
            newQuoteCharEnd: null,
        }
    }

    // ===== 档 3：orphaned =====
    return null
}
```

- [ ] **Step 2：跑单测，确认 GREEN**

Run: `npx vitest run tests/server/assistant/contract/utils/migrateRiskWithDualAnchor.test.ts`
Expected: PASS（11 个 case 全绿，含长 quote 二次校验通过 + 长 quote 假阳被阻断两条）

- [ ] **Step 3：跑既有 anchorMigrate 单测，确认无回归**

Run: `npx vitest run tests/server/assistant/contract/utils/anchorMigrate.test.ts`
Expected: PASS（既有 7 个 case 不变）

- [ ] **Step 4：commit**

```bash
git add server/agents/contract/utils/anchorMigrate.ts
git commit -m "feat(contract): migrateRiskWithDualAnchor wrapper 实现 Phase B 双锚点优先级

档 1：oldProblematicQuote 在 newDocxText 上 fuzzy → 回查 segment + 相似度二次校验 + 重摘 quote
档 2：oldClauseText 走 migrateAnchor（既有逻辑）→ 写新 clauseText 全段 + null quote 字段
档 3：两档失败 → null（调用方置 orphaned）

clauseText 写 segment.text 全段（不再切片），clauseCharStart/End 用 segment.offsetStart/End
（文档全文 offset，符合 schema 注释）。短 quote (<4 字符) 跳过档 1，长 quote (>32 字) 命中后
calcSimilarity 二次校验阻断 dmp Match_MaxBits=32 假阳。

Spec §9.2"

```

---

## Task 3：替换 `uploadClientVersion.service.ts` Step 5 迁移循环（接入新 wrapper）

**Files:**
- Modify: `server/agents/contract/uploadClientVersion.service.ts:813-868`

- [ ] **Step 0：调研 clauseText 长度 invariant 下游依赖（必做）**

PR7 Task 3 实施会改变 clauseText 写入行为：旧实现写 `segment.text.slice(newCharStart, newCharEnd)`（切片），新实现写 `segment.text` 全段。需要确认下游没有"clauseText.length === clauseCharEnd - clauseCharStart"的隐含 invariant 依赖，否则 PR7 上线会破坏既有功能。

Run（项目根）：

```bash
grep -rn "clauseText.length\|clauseCharEnd - clauseCharStart\|clauseText.slice" server/ app/ shared/ --include="*.ts" --include="*.vue" | grep -v "\.test\.ts"
```

Expected：检查命中行，确认下游使用模式都是「`clauseText.slice(quoteCharStart, quoteCharEnd)` 在 clauseText 内做 quote 切片」（这是 PR7 修复方向，不是依赖被破坏方向）。如果发现真有下游依赖 `clauseText.length === clauseCharEnd - clauseCharStart`（例如 commentInjector 用 char range 严格定位），停下与用户对齐再继续。

预判已知（plan 作者已 grep 一次，附确认结论）：
- `app/components/assistant/contract/RiskClauseDiff.vue:55-61` 用 `clauseText.length` 校验 quote offset 不越界，并 `clauseText.slice(start, end)` 切 quote —— **PR7 反而修复**了 quote offset 越界的潜在问题（之前 quote_char_offset 是相对 segment.text 全段写入的，老 migrate 把 clauseText 切短让 offset 越界）
- `server/agents/contract/middleware/reviewResultPersistence.middleware.ts:90` 用 `a.risk.clauseText` 作 anchorQuote 给 commentInjector 做 fuzzy 段落搜索 —— 全段更稳定，无破坏

如果 grep 出新的依赖点，按需追加迁移步骤。

- [ ] **Step 1：替换 import 行（顶部 import block）**

找到（`uploadClientVersion.service.ts:31`）：

```typescript
import { migrateAnchor } from './utils/anchorMigrate'
```

替换为：

```typescript
import { migrateRiskWithDualAnchor } from './utils/anchorMigrate'
```

- [ ] **Step 2：替换 Step 5 迁移循环（lines 813-868）**

找到（`uploadClientVersion.service.ts:813-868`）以下整个 `for (const r of dbRisks)` 循环：

```typescript
            for (const r of dbRisks) {
                if (r.clauseParagraphIndex == null) continue
                const oldArrayIdx = findOldClauseArrayIdxByAnchor(r.clauseText ?? '')
                const isModified = oldArrayIdx !== null
                    && clauseDiffResult.modified.some((m) => m.oldIndex === oldArrayIdx)
                const isRemoved = oldArrayIdx !== null && clauseDiffResult.removed.includes(oldArrayIdx)
                const unchangedMapping = oldArrayIdx !== null
                    ? clauseDiffResult.unchanged.find((u) => u.oldIndex === oldArrayIdx)
                    : null

                if (isModified || isRemoved || oldArrayIdx === null) {
                    // modified / removed / 完全找不到对应旧条款 → 都走全局漂移迁移
                    const preferredNew = isModified
                        ? (clauseDiffResult.modified.find((m) => m.oldIndex === oldArrayIdx)?.newIndex ?? null)
                        : null
                    const result = migrateAnchor({
                        oldAnchorQuote: r.clauseText ?? '',
                        preferredNewClauseArrayIdx: preferredNew,
                        newClauses,
                    })
                    if (result) {
                        // newClauses[result.newClauseIndex] 是数组下标 → 转段落序号
                        const newParaIdx = newClauseArrayIdxToParaIdx(result.newClauseIndex)
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                clauseParagraphIndex: newParaIdx,
                                clauseCharStart: result.newCharStart,
                                clauseCharEnd: result.newCharEnd,
                                clauseText: newClauses[result.newClauseIndex]!.text.slice(
                                    result.newCharStart,
                                    result.newCharEnd,
                                ),
                                ...(r.originalClauseText ? {} : { originalClauseText: r.clauseText }),
                            },
                        })
                    } else {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                orphaned: true,
                                ...(r.originalClauseText ? {} : { originalClauseText: r.clauseText }),
                            },
                        })
                    }
                } else if (unchangedMapping) {
                    // unchanged clause：位置可能变化，更新 clauseParagraphIndex 到新段落序号
                    const newParaIdx = newClauseArrayIdxToParaIdx(unchangedMapping.newIndex)
                    if (newParaIdx !== r.clauseParagraphIndex) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: { clauseParagraphIndex: newParaIdx },
                        })
                    }
                }
            }
```

替换为：

```typescript
            for (const r of dbRisks) {
                if (r.clauseParagraphIndex == null) continue
                const oldArrayIdx = findOldClauseArrayIdxByAnchor(r.clauseText ?? '')
                const isModified = oldArrayIdx !== null
                    && clauseDiffResult.modified.some((m) => m.oldIndex === oldArrayIdx)
                const isRemoved = oldArrayIdx !== null && clauseDiffResult.removed.includes(oldArrayIdx)
                const unchangedMapping = oldArrayIdx !== null
                    ? clauseDiffResult.unchanged.find((u) => u.oldIndex === oldArrayIdx)
                    : null

                if (isModified || isRemoved || oldArrayIdx === null) {
                    // modified / removed / 完全找不到对应旧条款 → 走双锚点迁移（spec §9.2）
                    const preferredNew = isModified
                        ? (clauseDiffResult.modified.find((m) => m.oldIndex === oldArrayIdx)?.newIndex ?? null)
                        : null
                    const result = migrateRiskWithDualAnchor({
                        oldClauseText: r.clauseText ?? '',
                        oldProblematicQuote: r.problematicQuote,
                        preferredNewClauseArrayIdx: preferredNew,
                        newClauses,
                        newDocxText,
                    })
                    if (result) {
                        const newParaIdx = newClauseArrayIdxToParaIdx(result.newClauseArrayIdx)
                        // spec §9.3：clauseText 实际变化 + 旧值非空 + 未备份过时才回填 originalClauseText
                        // 旧值非空守护：PR2 schema 给 clauseText `@default("")`，存量行可能是空串，
                        // 备份空串无业务意义反而污染"原文已修改"UI 提示
                        const oldClauseTextStr = r.clauseText ?? ''
                        const clauseTextChanged = oldClauseTextStr.length > 0 && oldClauseTextStr !== result.newClauseText
                        const originalUpdate = clauseTextChanged && !r.originalClauseText
                            ? { originalClauseText: oldClauseTextStr }
                            : {}
                        // 档 1 (matchType=quote)：写双锚点全字段；保留原 quoteMatchSource
                        // 档 2 (matchType=clause)：写 clause 字段 + 清空 quote 字段（含 quoteMatchSource）
                        const quoteUpdate = result.matchType === 'quote'
                            ? {
                                problematicQuote: result.newProblematicQuote,
                                quoteCharStart: result.newQuoteCharStart,
                                quoteCharEnd: result.newQuoteCharEnd,
                                // quoteMatchSource 沿用旧值（迁移不改变首次审查时的命中来源语义）
                            }
                            : {
                                problematicQuote: null,
                                quoteCharStart: null,
                                quoteCharEnd: null,
                                quoteMatchSource: null,
                            }
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                clauseIndex: newClauses[result.newClauseArrayIdx]!.index,
                                clauseParagraphIndex: newParaIdx,
                                clauseText: result.newClauseText,
                                clauseCharStart: result.newClauseCharStart,
                                clauseCharEnd: result.newClauseCharEnd,
                                orphaned: false, // 之前 orphaned=true 的 risk 重传后又能定位时复活
                                ...quoteUpdate,
                                ...originalUpdate,
                            },
                        })
                    } else {
                        // 档 3：两档都失败 → orphaned，保留旧 clauseText / problematicQuote 不动
                        // originalClauseText 仅在旧值非空 + 未备份过时回填（与档 1/2 同口径）
                        const oldClauseTextStr = r.clauseText ?? ''
                        const orphanedOriginalUpdate = oldClauseTextStr.length > 0 && !r.originalClauseText
                            ? { originalClauseText: oldClauseTextStr }
                            : {}
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                orphaned: true,
                                ...orphanedOriginalUpdate,
                            },
                        })
                    }
                } else if (unchangedMapping) {
                    // unchanged clause：位置可能变化，更新 clauseParagraphIndex 到新段落序号
                    // （quote 字段无需动——clauseText 没变，相对 offset 仍然有效）
                    const newParaIdx = newClauseArrayIdxToParaIdx(unchangedMapping.newIndex)
                    if (newParaIdx !== r.clauseParagraphIndex) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: { clauseParagraphIndex: newParaIdx },
                        })
                    }
                }
            }
```

- [ ] **Step 3：跑 typecheck 确认替换无类型错**

Run: `bun run typecheck`
Expected: PASS（无新增类型错误。如果报 `r.problematicQuote` 不存在，说明 PR2 的字段确实落库；用 `prisma generate` 后重试）

- [ ] **Step 4：跑 service 既有单测，确认无回归**

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts tests/server/assistant/contract/uploadClientVersion.service.test.ts`
Expected: PASS（既有失败路径与 happy path 都不应被新逻辑破坏。如果有 fail，先查是不是 mock 数据里 `problematicQuote` 缺失导致档 1 误命中——按需为相关 risk fixture 加 `problematicQuote: null`）

- [ ] **Step 5：commit**

```bash
git add server/agents/contract/uploadClientVersion.service.ts
git commit -m "feat(contract): uploadClientVersion Step 5 接入双锚点迁移（spec §9.2）

将 modified/removed/null 路径的 migrateAnchor 单锚点调用替换为
migrateRiskWithDualAnchor 双锚点 wrapper：
  - 档 1 quote 命中：写双锚点全字段（clauseText 全段 + 重摘 quote + 重算 offset）
  - 档 2 clause fallback：写新 clauseText + 清空 quote 字段（含 quoteMatchSource）
  - 档 3：orphaned=true，保留旧 quote/clause 不动

变化对比：
  - clauseText 不再取 slice(newCharStart..newCharEnd)，改写 segment.text 全段
    （双锚点模型下层 1 必须保完整上下文；顺带修复 quote_char_offset 在被切片
    clauseText 内可能越界的潜在 bug——RiskClauseDiff.vue:55 的 end > clauseText.length
    校验之前会让 quote 高亮悄悄消失）
  - clauseCharStart/End 改写 segment.offsetStart/End（文档全文 offset，符合 schema 注释）
  - 新增 clauseIndex 字段同步（newClauses[idx].index 1-based）
  - originalClauseText 收紧条件：clauseText 实际变化 + 旧值非空时才回填（spec §9.3）
  - 之前 orphaned=true 的 risk 重传后再定位到新位置时 orphaned 自动复位 false"
```

---

## Task 4：补集成测试 · 档 1 quote 命中（uploadClientVersion 端到端）

**Files:**
- Modify: `tests/server/agents/contract/uploadClientVersion.service.test.ts`（在文件末尾追加新 describe 块）

- [ ] **Step 1：在测试文件末尾追加新 describe 块**

```typescript
// ==================== Phase B 双锚点迁移（PR7） ====================

describe('uploadClientVersionService（Phase B 双锚点迁移 spec §9.2）', () => {
    let userId: number
    let reviewId: number
    let ossFileId: number
    let initialVersionId: number

    const createdOssFileIds: number[] = []
    const createdReviewIds: number[] = []

    beforeEach(async () => {
        userId = await ensureTestUser()

        const review = await prisma.contractReviews.create({
            data: {
                userId,
                status: 'completed',
                risks: [],
                sessionId: `pr7-dual-anchor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                originalFileId: 0,
                maxVersionNo: 1,
            },
        })
        reviewId = review.id
        createdReviewIds.push(reviewId)

        // 旧版本 snapshot：包含 oldClauses，让 diffClauses 能识别 modified
        const oldVersion = await prisma.contractReviewVersions.create({
            data: {
                reviewId,
                versionNo: 1,
                systemLabel: 'initial_upload',
                createdById: userId,
                snapshotData: {
                    docxText: '第一条 工资按月支付。\n第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。',
                    clauses: [
                        { index: 1, text: '第一条 工资按月支付。', offsetStart: 0, offsetEnd: 11 },
                        { index: 2, text: '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。', offsetStart: 12, offsetEnd: 36 },
                    ],
                } as any,
            },
        })
        initialVersionId = oldVersion.id
        await prisma.contractReviews.update({
            where: { id: reviewId },
            data: { currentVersionId: initialVersionId },
        })

        const oss = await createOssFileDao({
            userId,
            fileType: DOCX_MIME,
            fileName: 'client-return.docx',
            filePath: `pr7/dual-anchor/${Date.now()}.docx`,
            fileSize: 100,
            mimeType: DOCX_MIME,
        })
        ossFileId = oss.id
        createdOssFileIds.push(ossFileId)
    })

    afterEach(async () => {
        vi.clearAllMocks()
        // 反向清理：annotations → risks → versions → reviews → ossFiles
        await prisma.contractAnnotations.deleteMany({ where: { reviewId: { in: createdReviewIds } } })
        await prisma.contractRisks.deleteMany({ where: { reviewId: { in: createdReviewIds } } })
        await prisma.contractReviewVersions.deleteMany({ where: { reviewId: { in: createdReviewIds } } })
        await prisma.contractReviews.deleteMany({ where: { id: { in: createdReviewIds } } })
        await prisma.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
        createdReviewIds.length = 0
        createdOssFileIds.length = 0
    })

    it('档 1：quote 命中 → clauseText 升级为新段全文，problematicQuote 重摘，quote_char_offset 重算到新 clauseText 内', async () => {
        // 旧 risk：clauseText="第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。"
        //         problematicQuote="逾期支付的，每日按 0.05% 加收滞纳金"
        //         quoteCharStart=4, quoteCharEnd=22（在旧 clauseText 内）
        //         quoteMatchSource='sentence_id'（PR3 路径）
        const oldClauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const oldQuote = '逾期支付的，每日按 0.05% 加收滞纳金'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'medium',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText: oldClauseText,
                clauseParagraphIndex: 1,
                clauseCharStart: 12,
                clauseCharEnd: 36,
                problematicQuote: oldQuote,
                quoteCharStart: oldClauseText.indexOf(oldQuote),
                quoteCharEnd: oldClauseText.indexOf(oldQuote) + oldQuote.length,
                quoteMatchSource: 'sentence_id',
            },
        })

        // 客户回传新 docx：把第二条改写但保留 quote 那一句
        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '第一条 工资按月支付，并应在月底前一个工作日完成。',
                '第二条 乙方应当及时履行付款义务；逾期支付的，每日按 0.05% 加收滞纳金；累计超 30 日的，甲方有权单方解除。',
            ],
            rawXml: '<root/>',
        })

        const events = await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        // 没有 error 事件
        expect(events.find(e => e.type === 'error')).toBeUndefined()
        expect(events.find(e => e.type === 'complete')).toBeDefined()

        // 验证 risk 行被升级为档 1 命中
        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        expect(updated).not.toBeNull()
        expect(updated!.orphaned).toBe(false)
        // clauseText 升级为新段全文（包含原 quote + 新增前后文）
        expect(updated!.clauseText).toContain('逾期支付的，每日按 0.05% 加收滞纳金')
        expect(updated!.clauseText).toContain('累计超 30 日的') // 新增的后文
        // problematicQuote 重新摘录
        expect(updated!.problematicQuote).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        // quoteCharStart/End 是在新 clauseText 内的相对 offset
        expect(updated!.quoteCharStart).toBeGreaterThanOrEqual(0)
        expect(
            updated!.clauseText.slice(updated!.quoteCharStart!, updated!.quoteCharEnd!),
        ).toBe('逾期支付的，每日按 0.05% 加收滞纳金')
        // quoteMatchSource 沿用旧值（迁移不改变首次审查命中来源语义）
        expect(updated!.quoteMatchSource).toBe('sentence_id')
        // originalClauseText 已写入（旧 clauseText 备份）
        expect(updated!.originalClauseText).toBe(oldClauseText)
    })
})
```

- [ ] **Step 2：跑该测试**

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts -t "档 1"`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add tests/server/agents/contract/uploadClientVersion.service.test.ts
git commit -m "test(contract): uploadClientVersion 档 1 quote 命中迁移集成测试

旧 risk 含 problematicQuote + quoteCharStart/End，客户回传 docx 把条款改写
但保留原句子 → migration 应升级 clauseText 为新段全文，重摘 quote，重算
quote 在新 clauseText 内的相对 offset，quoteMatchSource 沿用 sentence_id。"
```

---

## Task 5：补集成测试 · 档 2 clause fallback

**Files:**
- Modify: `tests/server/agents/contract/uploadClientVersion.service.test.ts`（在 Task 4 的 describe 块内追加）

- [ ] **Step 1：在 Phase B 双锚点迁移 describe 块内追加新 it**

```typescript
    it('档 2：客户删除了 quote 那一句但保留了大半条款 → fallback 到 clauseText fuzzy，quote 字段全清空', async () => {
        const oldClauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const oldQuote = '逾期支付的，每日按 0.05% 加收滞纳金'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'medium',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText: oldClauseText,
                clauseParagraphIndex: 1,
                clauseCharStart: 12,
                clauseCharEnd: 36,
                problematicQuote: oldQuote,
                quoteCharStart: oldClauseText.indexOf(oldQuote),
                quoteCharEnd: oldClauseText.indexOf(oldQuote) + oldQuote.length,
                quoteMatchSource: 'fuzzy',
            },
        })

        // 客户回传：第二条改成"乙方应于每月末前向甲方完成结算"，原 quote 那一句被彻底删掉
        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '第一条 工资按月支付。',
                '第二条 乙方应于每月末前向甲方完成结算。',
            ],
            rawXml: '<root/>',
        })

        const events = await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        expect(events.find(e => e.type === 'error')).toBeUndefined()

        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        expect(updated).not.toBeNull()
        expect(updated!.orphaned).toBe(false)
        // clauseText 升级为新段（不再含 quote）
        expect(updated!.clauseText).toContain('乙方应于每月末前向甲方完成结算')
        // quote 字段全清空（档 2 兜底）
        expect(updated!.problematicQuote).toBeNull()
        expect(updated!.quoteCharStart).toBeNull()
        expect(updated!.quoteCharEnd).toBeNull()
        expect(updated!.quoteMatchSource).toBeNull()
        // originalClauseText 写入了旧 clauseText
        expect(updated!.originalClauseText).toBe(oldClauseText)
    })

    it('PR3 之前老 risk 兼容：problematicQuote / quoteCharStart / quoteMatchSource 全为 null → 自动走档 2 不抛错', async () => {
        // spec §11.2 独立发布约束：PR7 假设 PR2 schema + PR3 sentence_id 已发生产，
        // 但既有库里仍有 PR3 上线前残留的 risk 行（quote 字段全 null）。本 case 守住前向兼容。
        const oldClauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'medium',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText: oldClauseText,
                clauseParagraphIndex: 1,
                clauseCharStart: 12,
                clauseCharEnd: 36,
                // 全 null：PR3 上线前的存量行
                problematicQuote: null,
                quoteCharStart: null,
                quoteCharEnd: null,
                quoteMatchSource: null,
                originalClauseText: null,
            },
        })

        // 客户回传：第二条被微调
        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '第一条 工资按月支付。',
                '第二条 乙方逾期支付货款的，每日按 0.05% 加收滞纳金。',
            ],
            rawXml: '<root/>',
        })

        const events = await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        expect(events.find(e => e.type === 'error')).toBeUndefined()

        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        expect(updated).not.toBeNull()
        expect(updated!.orphaned).toBe(false)
        // 老 risk 没 quote → wrapper 自动跳过档 1 → 档 2 命中 → clauseText 升级
        expect(updated!.clauseText).toContain('乙方逾期支付货款的')
        // quote 字段保持 null（档 2 不写）
        expect(updated!.problematicQuote).toBeNull()
        expect(updated!.quoteMatchSource).toBeNull()
        // originalClauseText 回填旧 clauseText
        expect(updated!.originalClauseText).toBe(oldClauseText)
    })
```

- [ ] **Step 2：跑这两条 case**

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts -t "档 2" -t "PR3 之前老 risk 兼容"`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add tests/server/agents/contract/uploadClientVersion.service.test.ts
git commit -m "test(contract): uploadClientVersion 档 2 clause fallback + PR3 之前老 risk 全 null 兼容集成测试

档 2：quote 在新文档已被客户删除 → clauseText 升级 + quote 字段全清空。
兼容：PR3 上线前残留 risk（quote 字段全 null）→ 自动跳过档 1 落档 2 不抛错（spec §11.2）。"
```

---

## Task 6：补集成测试 · 档 3 orphaned + originalClauseText 幂等

**Files:**
- Modify: `tests/server/agents/contract/uploadClientVersion.service.test.ts`（继续追加）

- [ ] **Step 1：在 Phase B describe 块内追加 it**

```typescript
    it('档 3：条款被整段替换 → orphaned=true，旧 clauseText/quote 保留不变（律师工作区"孤立批注区"展示用）', async () => {
        const oldClauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const oldQuote = '每日按 0.05% 加收滞纳金'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'high',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText: oldClauseText,
                clauseParagraphIndex: 1,
                clauseCharStart: 12,
                clauseCharEnd: 36,
                problematicQuote: oldQuote,
                quoteCharStart: oldClauseText.indexOf(oldQuote),
                quoteCharEnd: oldClauseText.indexOf(oldQuote) + oldQuote.length,
                quoteMatchSource: 'sentence_id',
            },
        })

        // 客户回传：把第二条整段替换成完全不相关的内容
        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '第一条 工资按月支付。',
                'XYZXYZXYZ ABCABC DEF GHIJKL MNOPQRSTUVWXYZ啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊',
            ],
            rawXml: '<root/>',
        })

        const events = await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        expect(events.find(e => e.type === 'error')).toBeUndefined()

        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        expect(updated).not.toBeNull()
        // 档 3：orphaned=true
        expect(updated!.orphaned).toBe(true)
        // 旧字段保留不变（孤立批注区展示原文）
        expect(updated!.clauseText).toBe(oldClauseText)
        expect(updated!.problematicQuote).toBe(oldQuote)
        expect(updated!.quoteMatchSource).toBe('sentence_id')
        // originalClauseText 写入旧 clauseText（首次孤立时备份）
        expect(updated!.originalClauseText).toBe(oldClauseText)
    })

    it('originalClauseText 幂等：第二次客户回传时不覆盖第一次的备份', async () => {
        const oldClauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const ALREADY_SAVED_ORIGINAL = '【最初版本的条款原文】'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'medium',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText: oldClauseText,
                clauseParagraphIndex: 1,
                problematicQuote: null,
                originalClauseText: ALREADY_SAVED_ORIGINAL, // 已被前次回传写过
            },
        })

        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '第一条 工资按月支付。',
                '第二条 乙方应当按时履行付款义务，否则承担违约责任。',
            ],
            rawXml: '<root/>',
        })

        await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        // originalClauseText 没被新一次的迁移覆盖
        expect(updated!.originalClauseText).toBe(ALREADY_SAVED_ORIGINAL)
    })
```

- [ ] **Step 2：跑这两个 case**

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts -t "档 3"` 与 `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts -t "originalClauseText 幂等"`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add tests/server/agents/contract/uploadClientVersion.service.test.ts
git commit -m "test(contract): uploadClientVersion 档 3 orphaned + originalClauseText 幂等集成测试

档 3：条款被整段替换 → orphaned=true，旧 clauseText/quote/quoteMatchSource 全保留。
originalClauseText 已写过则后续迁移不覆盖（首次写入幂等保护）。"
```

---

## Task 7：补集成测试 · orphaned 复活 + unchanged 路径不动 quote

**Files:**
- Modify: `tests/server/agents/contract/uploadClientVersion.service.test.ts`（继续追加）

- [ ] **Step 1：在 Phase B describe 块内追加 it**

```typescript
    it('orphaned 复活：之前 orphaned=true 的 risk 在新 docx 里能再次定位时 orphaned 恢复 false', async () => {
        const oldClauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const oldQuote = '每日按 0.05% 加收滞纳金'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'high',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText: oldClauseText,
                clauseParagraphIndex: 1,
                problematicQuote: oldQuote,
                quoteCharStart: oldClauseText.indexOf(oldQuote),
                quoteCharEnd: oldClauseText.indexOf(oldQuote) + oldQuote.length,
                quoteMatchSource: 'sentence_id',
                orphaned: true, // 上一轮回传时被判孤立
                originalClauseText: oldClauseText,
            },
        })

        // 这次客户又把那一句加回来了
        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '第一条 工资按月支付。',
                '第二条 乙方应及时付款；每日按 0.05% 加收滞纳金；累计超 30 日的甲方可解除。',
            ],
            rawXml: '<root/>',
        })

        await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        expect(updated!.orphaned).toBe(false)
        expect(updated!.problematicQuote).toBe('每日按 0.05% 加收滞纳金')
    })

    // PR7 新契约回归保护：unchanged 路径在 PR7 之前根本没有 quote 字段；PR7 改造后这条路径
    // 必须显式不动 quote 字段（防止后续 refactor 误把 quote 也清空）
    it('unchanged 路径：clauseText 完全没变 → 只更新 paragraphIndex，不动 quote 字段（PR7 新契约回归保护）', async () => {
        const clauseText = '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。'
        const quote = '每日按 0.05% 加收滞纳金'
        const risk = await prisma.contractRisks.create({
            data: {
                reviewId,
                source: 'ai',
                level: 'medium',
                stance: 'balanced',
                category: '违约金',
                problem: '违约金过低',
                clauseIndex: 2,
                clauseText,
                clauseParagraphIndex: 1,
                clauseCharStart: 12,
                clauseCharEnd: 36,
                problematicQuote: quote,
                quoteCharStart: clauseText.indexOf(quote),
                quoteCharEnd: clauseText.indexOf(quote) + quote.length,
                quoteMatchSource: 'sentence_id',
            },
        })

        // 客户只在前面加了一段，没动第二条本身
        mockParseDocx.mockResolvedValueOnce({
            paragraphs: [
                '前言：本合同自双方签字盖章之日起生效。',
                '第一条 工资按月支付。',
                '第二条 乙方逾期支付的，每日按 0.05% 加收滞纳金。',
            ],
            rawXml: '<root/>',
        })

        await collectEvents(uploadClientVersionService({
            review: (await prisma.contractReviews.findUnique({ where: { id: reviewId } }))!,
            ossFileId,
            userId,
        }))

        const updated = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
        // unchanged 路径：clauseText / quote / quoteMatchSource 全都不动
        expect(updated!.clauseText).toBe(clauseText)
        expect(updated!.problematicQuote).toBe(quote)
        expect(updated!.quoteCharStart).toBe(clauseText.indexOf(quote))
        expect(updated!.quoteMatchSource).toBe('sentence_id')
        expect(updated!.orphaned).toBe(false)
        // 只 paragraphIndex 跟着变（前面新增了一段，第二条段落序号 +1）
        expect(updated!.clauseParagraphIndex).toBe(2)
    })
```

- [ ] **Step 2：跑这两个 case**

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts -t "orphaned 复活" -t "unchanged 路径"`
Expected: PASS

- [ ] **Step 3：跑完整的 Phase B 双锚点 describe 块**

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts -t "Phase B 双锚点迁移"`
Expected: PASS（6 个 case 全绿：档 1 / 档 2 / 老 risk 全 null 兼容 / 档 3 / originalClauseText 幂等 / orphaned 复活 / unchanged 回归）

- [ ] **Step 4：commit**

```bash
git add tests/server/agents/contract/uploadClientVersion.service.test.ts
git commit -m "test(contract): uploadClientVersion orphaned 复活 + unchanged 路径不动 quote 集成测试

orphaned 复活：旧 orphaned=true 的 risk 在新 docx 找回 quote 时 orphaned 自动复位 false。
unchanged 路径：clauseText 完全没变 → 仅更新 paragraphIndex，quote 字段保持不变。"
```

---

## Task 8：更新技术文档（contract.md）

**Files:**
- Modify: `docs/tech-docs/backend/contract.md`

- [ ] **Step 1：找到「双锚点」相关章节（PR3 已写过的"路线 2 sentence ID"段落附近）**

Run: `grep -n "双锚点\|sentence_id\|problematicQuote" docs/tech-docs/backend/contract.md | head -20`
读相邻段落判断在哪里追加。

- [ ] **Step 2：在合适位置追加「Phase B 双锚点迁移」章节**

```markdown
### Phase B 双锚点迁移（PR7）

客户回传 docx 时，`uploadClientVersionService` Step 5 走双锚点优先级把旧 risk 的位置迁到新文档：

| 档 | 命中条件 | 写入字段 |
|---|---|---|
| 1 (quote) | `problematicQuote` 在新文档 `normalizedText` 上 fuzzy 命中且未跨段 | `clauseText` 升级为新段 segment.text 全段；`problematicQuote` 重摘录；`quoteCharStart/End` 重算到新 clauseText 内的相对 offset；`quoteMatchSource` 沿用旧值；`orphaned=false` |
| 2 (clause) | 档 1 失败 + `clauseText` 走 `migrateAnchor` 命中 | `clauseText` 升级为新段全段；`problematicQuote/quoteCharStart/End/quoteMatchSource` 全清空 null；`orphaned=false` |
| 3 (orphaned) | 两档都失败 | `orphaned=true`；`clauseText/problematicQuote/quoteMatchSource` 全保留旧值（孤立批注区展示用） |

`originalClauseText` 在迁移后 clauseText 实际变化 + 旧值非空 + 未备份过时首次写入（幂等：已有值则不覆盖）。

实现位置：
- `server/agents/contract/utils/anchorMigrate.ts` `migrateRiskWithDualAnchor` wrapper（spec §9.2，含档 1 命中后 calcSimilarity 二次校验阻断长 quote 假阳）
- `server/agents/contract/uploadClientVersion.service.ts` Step 5（spec §9.3）

为什么 quote 优先：精确句子比整段更稳定——条款里其它字改了，只要"导致风险的那句话"还在就能锚住；clauseText 含整段更易因字面变化失败。

之前 orphaned=true 的 risk 在后续回传里能再次定位时 `orphaned` 自动复位 false（不需要律师手工"重激活"）。

#### 运维监控注意事项（与 spec §10.3 衔接）

spec §10.3 监控 SQL 期望首次审查的 `quote_match_source` 分布是 `sentence_id ≥ 80%, fuzzy ≤ 15%, fallback ≤ 5%`。**Phase B 迁移会污染这个分布**：

- 档 1 命中：沿用旧 `quote_match_source`（首次审查写入的值），分布无影响
- 档 2 命中：把 `quote_match_source` 清 null，独立桶
- 档 3 orphaned：保留旧值，分布无影响

**告警 SQL 必须排除迁移行**：迁移行在 Phase B 客户回传后 `updated_at > created_at`。建议监控 SQL：

```sql
-- 仅统计首次审查的命中分布，排除 Phase B 迁移行
SELECT quote_match_source, COUNT(*),
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM contract_risks
WHERE source = 'ai'
  AND created_at > NOW() - INTERVAL '7 days'
  AND created_at = updated_at  -- 排除 Phase B 迁移行
GROUP BY quote_match_source
ORDER BY COUNT(*) DESC;
```
```

- [ ] **Step 3：commit**

```bash
git add docs/tech-docs/backend/contract.md
git commit -m "docs(contract): tech-docs 新增 Phase B 双锚点迁移段（PR7）

档 1/2/3 fallback 矩阵 + originalClauseText 幂等条件 + orphaned 复活语义 +
运维监控 SQL 排除 Phase B 迁移行的写法（spec §10.3 衔接）。"
```

---

## Task 9：全量验证 + push

**Files:**
- 无新增/修改

- [ ] **Step 1：跑完整的 contract 子集测试**

Run: `npx vitest run tests/server/agents/contract/ tests/server/assistant/contract/`
Expected: PASS（既有 + 新增 case 全绿）

- [ ] **Step 2：typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3：跑全量测试**

Run: `bun run test`
Expected: PASS（如有跨 worker 污染表现，按 `.claude/rules/testing.md` 三步诊断；常见污染源是 `mockParseDocx.mockResolvedValueOnce` 残留——新 case 都用 `Once` 是正确做法）

- [ ] **Step 4：人工冒烟（可选但强烈建议）**

按下面流程在本地 dev 环境验证 happy path：

1. `bun dev` 启动
2. 用真实合同上传 → AI 审查 → 选一条 high 风险记下其 problematicQuote
3. 在 Word 里把该条款改写但保留 problematicQuote 句子 → 客户回传
4. 验证风险卡仍指向原句子（DocxPreview 字符级高亮、风险卡的"问题片段"框）
5. 把 problematicQuote 那一句删掉再回传 → 验证档 2 fallback：风险卡退化到段落级高亮（quote 字段为 null）
6. 把整段替换成完全不相关的内容再回传 → 验证档 3：风险卡进入"孤立批注区"

记录冒烟结果（pass/fail + 截图）发给 reviewer。

- [ ] **Step 5：push 当前分支**

```bash
git push -u origin "$(git branch --show-current)"
```

- [ ] **Step 6：提 PR**

PR 标题：`feat(contract): PR7 Phase B 锚点迁移升级（双锚点优先级）`

PR body 模板：

```markdown
## 摘要

合同审查精准锚点 spec PR7 落地：Phase B 客户回传链路把旧"单锚点 clauseText fuzzy"升级为"双锚点优先级（quote 优先 → clause fallback → orphaned）"。

## 改动范围

- 新增 `migrateRiskWithDualAnchor` wrapper（`server/agents/contract/utils/anchorMigrate.ts`，含档 1 命中后 calcSimilarity 二次校验阻断长 quote 假阳）
- 替换 `uploadClientVersion.service.ts` Step 5 迁移循环（lines 813-868 区间）
- 新增 `_clauseFixture.ts` 共享 fixture helper（用真实 segmentClauses，避免手工拼装假偏移）
- 11 个 wrapper 单测 + 6 个 service 集成测试，覆盖三档 fallback + 长 quote 假阳保护 + originalClauseText 幂等 + orphaned 复活 + unchanged 路径回归 + PR3 之前老 risk 全 null 兼容
- 1 篇 tech-docs 段落（contract.md，含运维监控 SQL 排除迁移行的写法）

## 关键决策

- `clauseText` 写 `segment.text` 全段（不再切片到 `newCharStart..newCharEnd`）—— 顺带修复 quote_char_offset 在被切片 clauseText 内可能越界的潜在 bug
- `clauseCharStart/End` 写 `segment.offsetStart/End`（文档全文 offset，符合 schema 注释）
- `quoteMatchSource` 档 1 沿用旧值（迁移不改命中来源语义）；档 2 清 null
- `originalClauseText` 收紧到「clauseText 实际变化 + 旧值非空」才回填（spec §9.3）
- 之前 orphaned=true 的 risk 在新一轮迁移命中时 orphaned 自动复位 false
- 长 quote (>32 字 dmp Bitap probe 上限) 命中后做 calcSimilarity 二次校验阻断假阳
- **不实现 spec §12 feature flag 兜底**：档 2 fallback 已是软兜底（详见 plan 顶部说明）

## 兼容性

- 数据库 schema 不变（PR2 已落字段）
- 不破坏既有 risk 行：旧 `problematicQuote=null` 的 risk 自动走档 2；既有失败路径测试无回归
- API 接口不变

## Test plan

- [x] makeClauseFixture 共享 helper
- [x] migrateRiskWithDualAnchor 单测（11 个 case，含长 quote 假阳保护）
- [x] uploadClientVersionService 集成测试 6 case（档 1 / 档 2 / 档 3 / orphaned 复活 / unchanged 回归 / PR3 之前老 risk 全 null 兼容）
- [x] 既有 anchorMigrate / uploadClientVersion 测试无回归
- [x] typecheck pass
- [x] full bun run test pass
- [ ] 人工冒烟：上传合同 → 改写 → 验证三档行为

## Spec / 上游

- spec: `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` §9 + §11.7（放弃 §12 feature flag）
- 前置 PR：PR1-6 已合
```

---

## 自检（writing-plans 强制）

**Spec 覆盖**：
- §9.1 现状描述（已被前置 PR 重构）→ Task 3 在 clauseDiff 路由层不动、仅替换 modified/removed/null 分支的 migrateAnchor 单调用（Goal 段已说明现状差异）
- §9.2 双锚点优先级 → Task 0+1+2 单测 + wrapper 实现（含长 quote 假阳保护，覆盖）
- §9.3 originalClauseText 写入条件 → Task 3 step 2 (含旧值非空守护) + Task 6 幂等测试（覆盖）
- §10.3 运维埋点 → Task 8 docs 加监控 SQL 排除 Phase B 迁移行的写法（覆盖）
- §11.2 独立发布约束（PR3 之前老 risk 兼容）→ Task 5 加"全 null 兼容"集成 case（覆盖）
- §11.7 工期 2 天 → 9 个 task 在 2 天内可达
- §12 风险点"Phase B 双锚点迁移逻辑改动大易回归" → Task 1 长 quote 假阳保护 + Task 4-7 六个集成 case + Task 9 全量验证（覆盖）；**§12 feature flag 兜底已与用户对齐放弃**（理由见 Goal 段）

**Placeholder 扫描**：无 TBD / TODO / "implement later"。每个 step 都有具体代码块或 grep 命令。

**类型一致性**：
- `migrateRiskWithDualAnchor` 入参 `oldProblematicQuote: string | null` 与 Prisma `problematicQuote String? @db.Text` 对齐
- `quoteMatchSource: null` 与 schema `String? @db.VarChar(20)` + `'sentence_id' | 'fuzzy' | 'fallback' | null` 字面量 union 对齐
- `newClauses[idx].index` 1-based 与 `clauseIndex Int?` 字段对齐
- `originalClauseText: oldClauseTextStr` 与 `clauseText String @default("")` NOT NULL 字段对齐（守护 length > 0 避免备份空串）
- 测试 fixture `clauseText` / `quoteCharStart/End` 等字段名与 `CreateContractRiskInput` / Prisma schema 完全对齐

**5 维度审查闭环**（spec/plan/4 agent review）：
- 基建复用：复用 `migrateAnchor` / `fuzzyLocateInText` / `calcSimilarity` / 真实 `segmentClauses`；新建 `_clauseFixture.ts` 共享 helper 避免再次手写假偏移
- spec 对齐：与用户确认放弃 §12 feature flag；Goal 段说明 §9.1 现状差异；Task 5 补 PR3 之前老 risk 兼容；Task 8 docs 补 §10.3 监控 SQL 排除迁移行
- 代码规范：TDD 顺序、显式 import、`#shared` / `~~/` 别名、commit conventional + 中文 body、无 emoji、cleanup 反向顺序
- 第三方库：`fuzzyLocateInText` Match_MaxBits=32 长 quote 假阳已在 wrapper 内加 calcSimilarity 二次校验；fixture 用真实 `segmentClauses` 避免段间偏移失真；空 clauseText 不写空 originalClauseText

无类型不一致，无遗留 spec 章节未覆盖。

---

## 执行选择（Execution Handoff）

Plan complete and saved to `docs/superpowers/plans/2026-05-03-contract-review-pr7-phase-b-dual-anchor.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 主对话每个 Task 派发新的 subagent 执行 + 二段 review；fast iteration，主上下文清爽
2. **Inline Execution** — 当前会话连跑 + checkpoint 暂停；适合任务彼此关联较紧、想随手调整时

哪种？

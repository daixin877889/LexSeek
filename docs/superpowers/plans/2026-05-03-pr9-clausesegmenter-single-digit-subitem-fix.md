# 合同审查 PR9 · clauseSegmenter 单数字子项编号识别修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `clauseSegmenter.ts:178-186` 把单数字子项编号「1.」「2.」「3.」（每个父条款内重置的相对计数）错按 X.Y 多级编号规则做「intPrefix === currentDiTiaoIdx」检查的 bug，让父条款内部的单数字子项被独立识别为 segment（之前约 50% 子项被错误合并到父条款），让 risk 卡片在 DocxPreview 跳转时能精确定位到子项段落而非父条款标题行。

**Architecture:** 区分两类 `RE_NUM_DOT` 匹配的编号 — 单数字 X.（如「1.」「2.」「3.」，相对父条款内部计数）总是识别为子项；多级 X.Y（如「3.1」「1.2.3」，全局多级编号）保持现有 intPrefix 检查避免「3.1」在「第二条」内被误判。修复仅 5 行代码，不动 `RE_NUM_DOT` 正则本身、不影响 `splitSentences.ts:58` 的复用（splitSentences 不做 intPrefix 检查）。

**Tech Stack:** TypeScript / Vitest（已有 9 个 clauseSegmenter 单测）

**Spec:** 无独立 spec 文档（bug 修复，根因 + 修复方向已在 PR9 brainstorm 阶段实测验证完毕，详见 commit message）

**前置（已实测验证）：**

- bug 现象：截图实际合同 10 行（3 父条款 + 7 子项）→ `segmentClausesByRegex` 只切出 5 个 segment（约 50% 子项漏识别）
- 修复后：同样 10 行 → 切出 10 个 segment，全部父条款 + 子项独立识别 ✓
- 既有「第X条 + 1.1 共存」case 修复后仍输出 5 个 segment，numbers 完全一致 ✓
- 误判保护「第二条 + 错位 3.1」修复后 3.1 仍被忽略，与现状一致 ✓
- `splitSentences.ts:58` 复用 RE_NUM_DOT 但不做 intPrefix 检查 → 修复不影响 splitSentences 行为
- 5 个 invokeNodeJson 调用方测试 + PR7 双锚点测试不依赖 segmentClauses 子项粒度（间接 mock），不会引入回归

**工期：** 0.5 天 × 3 个 Task

---

## 文件结构

### 修改（2）

- `server/agents/contract/docx/clauseSegmenter.ts:178-186` — `RE_NUM_DOT` 匹配后区分单数字 vs 多级，单数字总识别为子项
- `tests/server/assistant/contract/docx/clauseSegmenter.test.ts` — 新增 1 个 case「第X条 + 单数字子项 1./2./3.」（覆盖截图实际合同格式）

---

## Task 1：新增「第X条 + 单数字子项」测试（TDD RED）

**Files:**
- Modify: `tests/server/assistant/contract/docx/clauseSegmenter.test.ts`（在「混合编号：第X条 + 1.1 共存」case 后追加）

- [ ] **Step 1：在测试文件「混合编号：第X条 + 1.1 共存」case 后追加新 case**

找到 `tests/server/assistant/contract/docx/clauseSegmenter.test.ts:45-57` 的 `it('混合编号：第X条 + 1.1 共存，各自识别', ...)`，在该 case 后追加：

```typescript
    it('第X条 + 单数字子项「1.」「2.」「3.」（截图实际合同格式）', () => {
        // 截图反馈的真实合同格式：父条款是「第X条」，子项是单数字「1.」「2.」「3.」
        // （每个父条款内部从 1. 重置计数，与全局父级序号无关）
        // PR9 修复前：约 50% 子项漏识别（如「第二条」内的「1.」intPrefix=1≠currentDiTiaoIdx=2 被忽略）
        const text = [
            '第一条 合同期限与试用期',
            '1. 合同期限： 本合同期限为 3 年。',
            '2. 试用期： 试用期为 6 个月。',
            '3. 试用期工资： 试用期工资为转正后工资的 50%。',
            '第二条 工作内容与地点',
            '1. 岗位调整： 乙方聘用岗位为[填入岗位]。',
            '2. 工作地点： 乙方工作地点不仅限于[当前城市]。',
            '第三条 工作时间与休息休假',
            '1. 奋斗者协议：乙方自愿加入甲方的"奋斗者计划"。',
            '2. 放弃年休假：为体现敬业精神，乙方自愿放弃入职前 3 年的带薪年休假。',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments).toHaveLength(10)
        expect(segments.map(s => s.number)).toEqual([
            '第一条', '1.', '2.', '3.',
            '第二条', '1.', '2.',
            '第三条', '1.', '2.',
        ])
    })

    it('误判保护：「第二条」内出现错位多级「3.1」时仍按 intPrefix 检查忽略（spec §3.4 现有契约不破坏）', () => {
        // 修复必须区分单数字 X.（总识别）vs 多级 X.Y（保持 intPrefix 检查）
        // 否则「3.1」在「第二条」（currentDiTiaoIdx=2）内会被误判为子项
        const text = [
            '第一条 定义',
            '1.1 内容 A',
            '第二条 付款',
            '3.1 这是错位多级编号，应被忽略',
            '2.1 这条整数前缀对应当前父级，应识别',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['第一条', '1.1', '第二条', '2.1'])
    })
```

- [ ] **Step 2：跑测试，确认 RED**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts`
Expected: FAIL（「第X条 + 单数字子项」case 失败：实际 5 个 segment / numbers 形如 `['第一条','1.','第二条','2.','第三条']`，与期望 10 个不符）。「错位 3.1」case 应 PASS（既有 intPrefix 检查已经拦截）。既有 9 个 case 全部 PASS（不会因新增 case 误伤）。

- [ ] **Step 3：commit**

```bash
git add tests/server/assistant/contract/docx/clauseSegmenter.test.ts
git commit -m "test(contract): clauseSegmenter「第X条 + 单数字子项」case 蓝图（PR9 RED）

截图实际合同格式：父条款「第X条」+ 子项单数字「1.」「2.」「3.」（每个
父条款内从 1. 重置计数，相对父级内部编号）。修复前约 50% 子项漏识别。

此 commit 故意 RED，下个 commit 实现单数字 vs 多级区分让其 GREEN。同时
新增「错位多级 3.1 仍按 intPrefix 检查忽略」case 守住既有契约不被破坏。"
```

---

## Task 2：修复 clauseSegmenter 区分单数字 vs 多级（GREEN）

**Files:**
- Modify: `server/agents/contract/docx/clauseSegmenter.ts:178-186`

- [ ] **Step 1：替换 lines 178-186 的 m1 处理逻辑**

找到 `server/agents/contract/docx/clauseSegmenter.ts:178-186`：

```typescript
        // 「X.X」级编号：若存在「第X条」格式，则要求整数前缀等于当前父级序号
        const m1 = line.match(RE_NUM_DOT)
        if (m1?.[1]) {
            const intPrefix = parseInt(m1[1].split('.')[0]!, 10)
            if (!hasDiTiao || currentDiTiaoIdx === intPrefix) {
                matches.push({ lineIdx: i, number: m1[1].replace(/\s+$/, '') })
                continue
            }
        }
```

替换为：

```typescript
        // 编号识别：区分单数字 X.（相对父条款内部计数）vs 多级 X.Y（全局多级编号）
        //   - 单数字 X.：每个父条款内从 1. 重置（如「第一条」「第二条」内都有自己的「1.」），
        //     与父级序号无关 → 总是识别为子项
        //   - 多级 X.Y：整数前缀是父级序号（如「3.1」属「第三条」），需匹配 currentDiTiaoIdx
        //     才识别（避免「3.1」在「第二条」内被误判为子项）
        const m1 = line.match(RE_NUM_DOT)
        if (m1?.[1]) {
            const numStr = m1[1]
            const isMultiLevel = /^\d+\.\d/.test(numStr) // 形如「3.1」「1.2.3」
            if (isMultiLevel) {
                const intPrefix = parseInt(numStr.split('.')[0]!, 10)
                if (!hasDiTiao || currentDiTiaoIdx === intPrefix) {
                    matches.push({ lineIdx: i, number: numStr.replace(/\s+$/, '') })
                    continue
                }
            } else {
                // 单数字 X. 总识别（hasDiTiao 模式下相对父级；无 hasDiTiao 时是顶级编号）
                matches.push({ lineIdx: i, number: numStr.replace(/\s+$/, '') })
                continue
            }
        }
```

- [ ] **Step 2：跑 PR9 单测确认 GREEN**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts`
Expected: PASS（11 个 case 全绿：既有 9 个 + PR9 新增 2 个）

- [ ] **Step 3：跑既有调用方测试无回归**

Run: `npx vitest run tests/server/assistant/contract/utils/splitSentences.test.ts tests/server/assistant/contract/utils/anchorMigrate.test.ts tests/server/assistant/contract/utils/migrateRiskWithDualAnchor.test.ts tests/server/assistant/contract/utils/clauseDiff.test.ts`
Expected: PASS（splitSentences 不做 intPrefix 检查，行为不变；其它 utils 测试不直接调 segmentClauses）

- [ ] **Step 4：跑全量 contract 子集测试**

Run: `npx vitest run tests/server/assistant/contract/ tests/server/agents/contract/`
Expected: 与 PR8 baseline 一致（11 fail 全部 pre-existing，详见 PR8 Task 5 验证结果）。如果有新 fail 文件，stash + 对比确认是否真的 PR9 引入。

- [ ] **Step 5：typecheck**

Run: `bun run typecheck`
Expected: PASS（修复仅改函数体内逻辑，未改 export 签名）

- [ ] **Step 6：commit**

```bash
git add server/agents/contract/docx/clauseSegmenter.ts
git commit -m "fix(contract): clauseSegmenter 区分单数字子项 vs 多级编号（PR9 GREEN）

bug: 父条款「第X条」内的单数字子项「1.」「2.」「3.」（每个父条款内重置的
相对计数）被错按 X.Y 多级规则做 intPrefix === currentDiTiaoIdx 检查，导致
约 50% 子项漏识别合并到父条款 segment，risk 卡片在 DocxPreview 跳转时只能
定位到父条款标题行。

修复: 区分两类 RE_NUM_DOT 匹配的编号
  - 单数字 X.（如「1.」「2.」）→ 总是识别为子项（相对父级内部计数）
  - 多级 X.Y（如「3.1」「1.2.3」）→ 保持现有 intPrefix 检查（避免错位多级
    在父条款内被误判）

实测验证（截图实际合同 10 行 + 既有 9 个测试 + 错位多级保护）全部通过，
splitSentences.ts:58 复用 RE_NUM_DOT 但不做 intPrefix 检查，行为不受影响。

旧 review 数据切句粒度变细后，risk.clauseParagraphIndex 在新一轮重审时
自动刷新到子项段落；存量数据保持不变（schema 不变）。"
```

---

## Task 3：全量验证 + push + PR

**Files:**
- 无改动

- [ ] **Step 1：跑全量测试**

Run: `bun run test`
Expected: 9586 PASS / 11 fail（与 PR8 baseline 一致 +1，因为 PR9 新增 2 个 case 但 1 个本来就 PASS（错位 3.1 守住既有契约））

> 实际通过数 = PR8 baseline 9585 + PR9 新增 2 case = 9587。如果不到 9587 说明引入回归，需 stash + 对比定位。

- [ ] **Step 2：检查 git status + commit chain**

```bash
git status --short
git log --oneline origin/dev..HEAD | head -20
```

Expected: 工作区干净；commit chain 含 PR9 的 2 个 commit（Task 1 测试蓝图 + Task 2 修复实现）。

- [ ] **Step 3：按发布策略拆分 push（与 PR7/PR8 同模式）**

PR9 是独立 bug 修复，不依赖 PR7/PR8 任何 commit。按发布策略 A：每个独立业务领域一个 PR。

具体路径取决于 PR7/PR8 当前 push 状态：

**情况 a**：PR7 + PR8 已 push（合并到 origin/dev 后）：

```bash
git fetch origin
git checkout -b pr9-clausesegmenter-single-digit-fix origin/dev
git cherry-pick <PR9 Task 1 commit hash> <PR9 Task 2 commit hash>
git push -u origin pr9-clausesegmenter-single-digit-fix
# 在 GitHub 创建 PR9
```

**情况 b**：PR7 + PR8 仍在本地未 push：

```bash
# 当前 dev 分支已有 PR7/PR8/PR9 共 18+ commit。
# 先 push PR7（10 commit）→ merge → 再 cut PR8 分支 → push → merge → 再 cut PR9 分支
# 或者按 spec §6 PR8 plan §Task 5 给的串行 push 流程
```

由 reviewer / 用户决定 push 策略，本 plan 不强制顺序。

- [ ] **Step 4：提 PR**

PR 标题：`fix(contract): PR9 clauseSegmenter 单数字子项编号识别修复`

PR body 模板：

```markdown
## 摘要

修复 `clauseSegmenter.ts:178-186` 把单数字子项编号「1.」「2.」「3.」错按 X.Y 多级规则做 intPrefix 检查的 bug。父条款「第X条」内的子项编号是相对父级的内部计数（每个父条款重置），与全局父级序号无关——之前约 50% 子项被错误合并到父条款 segment，导致 risk 卡片在 DocxPreview 跳转时只能定位到父条款标题行而非子项段落。

## 用户视角的 bug 表现

合同审查界面：
- **审查中**：左侧 DocxPreview 能定位到具体子项分段
- **审查后**：点击 risk 卡只能滚到父条款标题（如「第二条 工作内容与地点」），无法精确到子项（如「2. 工作地点」）

## 改动范围

- 修复 `server/agents/contract/docx/clauseSegmenter.ts:178-186`（5 行代码区分单数字 vs 多级）
- 新增 2 个单测 case：截图实际合同格式 + 错位多级保护（守住既有契约不破坏）
- 既有 9 个 clauseSegmenter 单测 + splitSentences / anchorMigrate / clauseDiff / migrateRiskWithDualAnchor 测试无回归

## 关键决策

- **不改 RE_NUM_DOT 正则本身**：正则定义保持不变，仅在 segmentClausesByRegex 内的 intPrefix 判定逻辑分两类处理
- **splitSentences.ts:58 复用 RE_NUM_DOT 但不做 intPrefix 检查**：修复对 splitSentences 行为零影响
- **存量 review 数据不动**：schema 不变；旧 review 切句粒度变细后，risk.clauseParagraphIndex 在新一轮重审时自动刷新到子项段落

## 兼容性

- 数据库 schema 不变
- 既有 risk 行不需要数据迁移（旧合同重审时会按新粒度切句生成新 risk）
- API 接口不变
- 单测 / 集成测试无回归

## Test plan

- [x] 新增 2 个 clauseSegmenter 单测 case
- [x] 既有 clauseSegmenter / splitSentences / anchorMigrate / clauseDiff / migrateRiskWithDualAnchor 测试无回归
- [x] typecheck PASS
- [x] full bun run test PASS（与 PR8 baseline +2 case PASS 一致）
- [ ] 人工冒烟：上传截图实际格式合同 → 点击「2. 工作地点」类子项 risk → 验证 DocxPreview 定位到子项段落而非父条款标题

## 上游

- 用户截图反馈触发的 bug（无独立 spec 文档；根因 + 修复在 brainstorm 阶段实测验证）
- 前置 PR：PR7 / PR8 独立无依赖
```

---

## 自检（writing-plans 强制）

**Spec 覆盖**：

- bug 根因 → Task 2 Step 1 完整代码块（覆盖）
- 修复方向 A 区分单数字 vs 多级 → Task 2 Step 1 `isMultiLevel` 判定（覆盖）
- 截图实际合同格式回归 → Task 1 「第X条 + 单数字子项」case（覆盖）
- 错位 3.1 误判保护 → Task 1 「错位多级保护」case（覆盖）
- 既有调用方无回归 → Task 2 Step 3 + Task 3 Step 1（覆盖）

**Placeholder 扫描**：无 TBD / TODO / "implement later"。每个 step 都有具体代码 + 命令。

**类型一致性**：

- `numStr: string` 与 `m1[1]: string` 类型一致
- `isMultiLevel: boolean` 由 `/^\d+\.\d/.test(numStr)` 推导
- `intPrefix: number` 仅在 isMultiLevel 分支用
- 测试断言 `segments.map(s => s.number)` 类型为 `(string | null)[]`，期望值都是 string，无类型不一致

**与 PR7/PR8 实施期教训对照**：

- PR7 fixture 踩了 migrateAnchor 25% 长度容差边界 → PR9 单测纯字符串输入，不依赖任何长度容差，应无类似坑
- PR7 segmentClauses 散段切句行为踩坑 → PR9 直接修这个函数，已实测验证三组 case
- PR7 worker 并发污染让 fail 列表抖动 → PR9 单测纯单元（无 DB），不受 worker 污染
- PR8 三态埋点中英文混用 → PR9 commit message + 注释全中文

无类型不一致，无遗留覆盖缺口。

---

## 执行选择（Execution Handoff）

Plan complete and saved to `docs/superpowers/plans/2026-05-03-pr9-clausesegmenter-single-digit-subitem-fix.md`. Two execution options:

1. **Subagent-Driven** — 派 subagent 跑 Task 1+2，主 agent 跑 Task 3（但 PR9 工期 < 0.5 天，开 worker 收益有限）
2. **Inline Execution（推荐）** — 当前会话连跑 3 个 task

哪种？

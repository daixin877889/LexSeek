# AI 分析结果落库前清洗一级标题前文字 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在案件分析与模块对话两类 AI 写库点之前自动去除一级标题（`# xxx`）之前的说明性前言。

**Architecture:** 在 `shared/utils/markdown.ts` 新增双端可用的纯函数 `stripContentBeforeFirstH1`，对 LLM 输出的 markdown 做 strip；分别在 case-analysis V2 工作流、模块对话 `save_analysis_result` 工具、模块对话兜底 middleware 三处写库链路接入。Service / DAO / 前端展示层不动，避免误伤人工编辑路径。

**Tech Stack:** TypeScript / Vitest / 项目自有 logger / Nuxt 4 / LangGraph middleware

**Spec:** [docs/superpowers/specs/2026-05-17-strip-pre-h1-on-save-design.md](../specs/2026-05-17-strip-pre-h1-on-save-design.md)

---

## Task 1：编写 `stripContentBeforeFirstH1` 的失败单元测试（TDD red）

**Files:**
- Create: `tests/shared/utils/markdown.test.ts`

- [ ] **Step 1：新建测试文件，覆盖 spec 列出的所有用例**

Create `tests/shared/utils/markdown.test.ts`（与源文件 `shared/utils/markdown.ts` 一一对应，符合项目惯例）：

```typescript
/**
 * shared/utils/markdown.ts 单元测试
 *
 * 覆盖 spec docs/superpowers/specs/2026-05-17-strip-pre-h1-on-save-design.md
 * 列出的全部规则与边界情况。
 */
import { describe, it, expect } from 'vitest'
import { stripContentBeforeFirstH1 } from '../../../shared/utils/markdown'

describe('stripContentBeforeFirstH1', () => {
    describe('Happy path', () => {
        it('前言 + 一级标题 + 正文 → 删前言，首行就是一级标题', () => {
            const input = [
                '好的，我已经详细阅读了技能的全部参考资料。',
                '现在开始提取和分析案件大事记。',
                '',
                '# 案件大事记',
                '',
                '| 时间 | 事件 |',
                '| --- | --- |',
                '| 2021-05-22 | 定金支付 |',
            ].join('\n')

            const result = stripContentBeforeFirstH1(input)

            expect(result.startsWith('# 案件大事记')).toBe(true)
            expect(result).toContain('| 2021-05-22 | 定金支付 |')
            expect(result).not.toContain('好的，我已经详细阅读')
        })

        it('无前言（首行就是一级标题）→ 完全不变', () => {
            const input = '# 案件大事记\n\n正文内容。\n'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('没有任何一级标题（纯文本）→ 完全不变', () => {
            const input = '这是一段没有标题的纯文本。\n第二行。\n'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('只有二级 / 三级标题，没有一级标题 → 完全不变', () => {
            const input = '## 二级\n### 三级\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })
    })

    describe('空白处理', () => {
        it('前言后紧跟多个空行才到一级标题 → 空行一起删，首行就是一级标题', () => {
            const input = '前言段落\n\n\n\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })

        it('入参只是空白前缀 + 一级标题 → 输出首行就是一级标题', () => {
            const input = '   \n\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })

        it('一级标题前只有空白字符（无任何文字）→ 仍清洗，结果首行为一级标题', () => {
            const input = '\n\n\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })
    })

    describe('边界 / 抗误判', () => {
        it('fenced code block 内有 # foo，外面有真的一级标题 → 找外面那个', () => {
            const input = [
                '示例：',
                '```markdown',
                '# foo（这是代码块内的伪标题）',
                '```',
                '',
                '# 真正的标题',
                '正文',
            ].join('\n')

            const result = stripContentBeforeFirstH1(input)
            expect(result.startsWith('# 真正的标题')).toBe(true)
            expect(result).not.toContain('示例：')
            expect(result).not.toContain('```')
        })

        it('fenced code block 内有 # foo，外面没有真一级标题 → 原文不变', () => {
            const input = [
                '说明文字。',
                '```markdown',
                '# foo',
                '```',
                '结尾。',
            ].join('\n')

            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('~~~ 围栏的 code block 内 # foo → 同样不算', () => {
            const input = [
                '说明',
                '~~~',
                '# foo',
                '~~~',
                '结尾',
            ].join('\n')

            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('indented code block（4 空格）内的 # foo → 不算', () => {
            const input = [
                '前面是一段普通文字。',
                '',
                '    # foo（这是缩进代码块）',
                '',
                '结尾。',
            ].join('\n')

            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('blockquote > # foo → 不算一级标题', () => {
            const input = '前言\n> # 引用里的标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('多个一级标题 → 只在第一个之前删', () => {
            const input = '前言\n# 第一段\n内容1\n# 第二段\n内容2'
            expect(stripContentBeforeFirstH1(input)).toBe('# 第一段\n内容1\n# 第二段\n内容2')
        })

        it('首行 #标题（# 后无空格）→ 不算 ATX 一级标题', () => {
            const input = '#标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('首行单独一个 # → 不算', () => {
            const input = '#\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('一级标题后紧跟一个换行 + 内容 → 保留标题与所有正文', () => {
            const input = '前言\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })

        it('Windows 风格 CRLF 换行 → 也能正确匹配', () => {
            const input = '前言\r\n\r\n# 标题\r\n正文\r\n'
            const result = stripContentBeforeFirstH1(input)
            expect(result.startsWith('# 标题')).toBe(true)
            expect(result).toContain('正文')
        })
    })

    describe('防御', () => {
        it('入参 null → 返回空串', () => {
            expect(stripContentBeforeFirstH1(null)).toBe('')
        })

        it('入参 undefined → 返回空串', () => {
            expect(stripContentBeforeFirstH1(undefined)).toBe('')
        })

        it('入参空串 → 返回空串', () => {
            expect(stripContentBeforeFirstH1('')).toBe('')
        })

        it('入参只有空白 → 返回原值（无一级标题不变）', () => {
            const input = '   \n\n\t'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })
    })
})
```

- [ ] **Step 2：跑测试确认全部 fail（red）**

```bash
npx vitest run tests/shared/utils/markdown.test.ts --reporter=verbose
```

Expected: 全部 FAIL，错误信息形如 `Cannot find module '../../../shared/utils/markdown'`（因为文件还不存在）。**不要继续到 Task 2 之前先确认这一步真的失败。**

---

## Task 2：实现 `stripContentBeforeFirstH1`（TDD green）

**Files:**
- Create: `shared/utils/markdown.ts`

- [ ] **Step 1：新建实现文件**

Create `shared/utils/markdown.ts`：

```typescript
/**
 * Markdown 工具
 *
 * 提供给前后端共用的 markdown 文本处理函数。
 */

/**
 * 判断一行是否是 ATX 一级标题：
 * - 行首允许 0-3 个空格（CommonMark）
 * - 接 `#`
 * - 紧跟一个空格或行末（标题文本可空）
 * - 不匹配 `## ` / `### ` / `#标题`（# 后无空格） / 单独的 `#`
 *
 * 同时把"# 后跟空格但只有空格"也视为有效标题（CommonMark 允许空标题，
 * 不会出现在 LLM 输出里，但匹配上也无害）。
 */
function isAtxH1Line(line: string): boolean {
    // 允许 0-3 个前导空格
    const m = /^( {0,3})#( +.*| *)$/.exec(line)
    if (!m) return false
    const rest = m[2]
    // `#` 后必须有至少一个空格（CommonMark 要求 ATX heading 必须有空格分隔）
    return rest.length > 0 && rest.startsWith(' ')
}

/**
 * 跳过 fenced code block（```或~~~ 围栏）。
 * 给定围栏开始行，向后扫描，返回下一个待处理的行索引（围栏结束行的下一行）。
 * 如果未找到结束围栏，则视为代码块延伸到文档末尾。
 */
function skipFencedBlock(lines: string[], start: number, fence: string): number {
    for (let i = start + 1; i < lines.length; i++) {
        const trimmed = lines[i].trimStart()
        if (trimmed.startsWith(fence)) {
            // 结束围栏：返回它之后的下一行索引
            return i + 1
        }
    }
    return lines.length
}

/**
 * 判断一行是否是 fenced code block 围栏开始（``` 或 ~~~）。
 * 返回围栏字符（'```' 或 '~~~'），不是围栏返回 null。
 */
function detectFenceOpen(line: string): string | null {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('```')) return '```'
    if (trimmed.startsWith('~~~')) return '~~~'
    return null
}

/**
 * 判断一行是否是 indented code block（行首 4 空格或 1 tab）。
 * 注意：indented code block 不能紧跟段落出现，但作为兜底安全策略，
 * 我们一律把"行首 4 空格以上"视为缩进代码块跳过。
 */
function isIndentedCodeLine(line: string): boolean {
    if (line.startsWith('\t')) return true
    if (line.startsWith('    ')) return true
    return false
}

/**
 * 判断一行是否是 blockquote（行首 `>` 后跟空格或更多内容）。
 * CommonMark 里 `>` 后可以紧跟字符，统一拦截。
 */
function isBlockquoteLine(line: string): boolean {
    return /^( {0,3})>/.test(line)
}

/**
 * 去除 markdown 第一个一级标题（# xxx）之前的所有内容。
 *
 * 用于清洗 LLM 输出的说明性前言。若没有匹配到一级标题，原文不动返回。
 * 处理后不保留前导空行 / 空白，输出从该一级标题行的行首开始。
 *
 * @param markdown 原始 markdown
 * @returns 清洗后的 markdown；入参 null/undefined 统一返回空串
 */
export function stripContentBeforeFirstH1(markdown: string | null | undefined): string {
    if (markdown == null) return ''
    if (markdown === '') return ''

    // 按换行符切分，保留 CRLF / LF 兼容
    // 用 \r?\n 分割时丢失原换行符；改用正则保留原换行风格
    const lines = markdown.split(/\r?\n/)

    let i = 0
    let h1LineIndex = -1
    while (i < lines.length) {
        const line = lines[i]

        // 1. fenced code block：跳过整段
        const fence = detectFenceOpen(line)
        if (fence) {
            i = skipFencedBlock(lines, i, fence)
            continue
        }

        // 2. indented code block：跳过单行
        if (isIndentedCodeLine(line)) {
            i++
            continue
        }

        // 3. blockquote：跳过单行（里面的 # 不算独立一级标题）
        if (isBlockquoteLine(line)) {
            i++
            continue
        }

        // 4. 普通行：判断是否一级标题
        if (isAtxH1Line(line)) {
            h1LineIndex = i
            break
        }

        i++
    }

    if (h1LineIndex === -1) return markdown

    // 从一级标题行开始重组：用原换行符样式
    // 检测原文用的是 \r\n 还是 \n
    const usesCRLF = /\r\n/.test(markdown)
    const eol = usesCRLF ? '\r\n' : '\n'
    return lines.slice(h1LineIndex).join(eol)
}
```

- [ ] **Step 2：跑测试确认全部 pass（green）**

```bash
npx vitest run tests/shared/utils/markdown.test.ts --reporter=verbose
```

Expected: 全部 PASS。如果有任何 fail，**不要**改测试期望，回到 Step 1 修实现。

- [ ] **Step 3：跑 typecheck**

```bash
bun run typecheck
```

Expected: 无新增 type 错误（项目可能存在历史 error，关注与本次改动相关的文件）。

- [ ] **Step 4：用 simplify 技能优化新增代码**

调用 `simplify` 技能审视 `shared/utils/markdown.ts` 与 `tests/shared/utils/stripPreH1.test.ts`，按其建议修正。修正后再跑一次测试确认通过。

- [ ] **Step 5：commit 工具与测试**

```bash
git add shared/utils/markdown.ts tests/shared/utils/markdown.test.ts
git commit -m "$(cat <<'EOF'
feat(analysis): 新增 stripContentBeforeFirstH1 工具去除一级标题前的说明性文字
EOF
)"
```

---

## Task 3：接入点 1 — case-analysis V2 工作流落库

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.workflow.ts:262`（在 `resultText = sub.resultText` 后插入清洗）

- [ ] **Step 1：阅读现状**

打开 [server/services/workflow/caseAnalysisV2.workflow.ts:255](server/services/workflow/caseAnalysisV2.workflow.ts:255) 附近代码，确认 `resultText = sub.resultText` 之后到 `updateAnalysisDao` / `createAnalysisDao` 之间没有其他依赖 `resultText.length` 的副作用。当前确认只有 step 5d 的 `logger.info('分析结果持久化完成', { resultLength: resultText.length, ... })`，strip 后 length 自然反映落库长度，**期望行为，无需调整**。

- [ ] **Step 2：在文件顶部加 import**

在该文件的 import 区块（与其他 `~~/server/services/...` 同位）加入：

```typescript
import { stripContentBeforeFirstH1 } from '#shared/utils/markdown'
```

> 注：`#shared/utils/markdown` 别名走 Nuxt 的 `#shared` resolver，前后端通用。

- [ ] **Step 3：在 `resultText = sub.resultText` 后立即 strip**

定位：

```typescript
                responseMessages = sub.messages
                resultText = sub.resultText
```

改为：

```typescript
                responseMessages = sub.messages
                resultText = stripContentBeforeFirstH1(sub.resultText)
```

> 在赋值时一次 strip，下面 `updateAnalysisDao` / `createAnalysisDao` 两个分支都自动用到清洗后的值，避免漏改。

- [ ] **Step 4：typecheck**

```bash
bun run typecheck
```

Expected: 无新增 type 错误。

---

## Task 4：接入点 2 — `save_analysis_result` 工具

**Files:**
- Modify: `server/services/agent-platform/tools/saveAnalysisResult.tool.ts:148`（在 `extractLastAiText` 之后插入清洗）

- [ ] **Step 1：在文件顶部加 import**

在 import 区块（与 `~~/server/services/...` 同位）加入：

```typescript
import { stripContentBeforeFirstH1 } from '#shared/utils/markdown'
```

- [ ] **Step 2：在 `extractLastAiText` 之后 strip 一次，下面用清洗后的内容**

定位：

```typescript
                // ── 2. 从 state.messages 提取分析报告正文 ──
                const lastAi = extractLastAiText(runtime.state?.messages)
                if (!lastAi) {
                    throw new Error('未找到带文本内容的 AI 消息，请先以纯文本形式输出完整的分析报告，再调用此工具')
                }
```

改为（**在 if 块之后新增一行**）：

```typescript
                // ── 2. 从 state.messages 提取分析报告正文 ──
                const lastAi = extractLastAiText(runtime.state?.messages)
                if (!lastAi) {
                    throw new Error('未找到带文本内容的 AI 消息，请先以纯文本形式输出完整的分析报告，再调用此工具')
                }
                // 清洗 LLM 偶发的前言说明文字，落库前必须去掉一级标题之前的内容
                const analysisResult = stripContentBeforeFirstH1(lastAi.text)
```

- [ ] **Step 3：把后面所有使用 `lastAi.text` 作为"落库内容"的地方换成 `analysisResult`**

文件里共 3 处使用 `lastAi.text` 作为分析报告正文（不是 messageId）：

1. 行 205 `updateAndActivateAnalysisService({ analysisResult: lastAi.text, ... })` → 改为 `analysisResult: analysisResult,`（或 ES2015 简写 `analysisResult,`）
2. 行 215 `saveAndActivateAnalysisService({ ..., analysisResult: lastAi.text, ... })` → 改为 `analysisResult: analysisResult,`（或简写）
3. 行 266 `completeAnalysisWithRAG({ analysisId, analysisResult: lastAi.text, tokens, tokenCount })` → 改为 `analysisResult: analysisResult,`（或简写）

具体编辑示例（行 205 附近）：

```typescript
                    // 同字段重写无副作用。
                    await updateAndActivateAnalysisService(analysisId, {
                        analysisResult,
                        tokens,
                        tokenCount,
                    })
```

行 215 附近：

```typescript
                    const created = await saveAndActivateAnalysisService({
                        caseId: context.caseId,
                        sessionId: context.sessionId,
                        nodeId: context.nodeId,
                        analysisType: context.moduleName,
                        analysisResult,
                        tokenCount,
                        tokens,
                    })
```

行 266 附近：

```typescript
                    const summary = await completeAnalysisWithRAG({
                        analysisId,
                        analysisResult,
                        tokens,
                        tokenCount,
                    })
```

> **不要**改 `lastAi.messageId` 的使用（行 245、273、283）——messageId 是 SSE 事件的 parentMessageId，与分析内容无关。

- [ ] **Step 4：typecheck**

```bash
bun run typecheck
```

Expected: 无新增 type 错误。

---

## Task 5：接入点 3 — case-module afterAgent 兜底 middleware

**Files:**
- Modify: `server/agents/case-module/middleware/analysisResultPersistence.middleware.ts:168`（在 `extractLastAIMessageContent` 之后插入清洗）

- [ ] **Step 1：在文件顶部加 import**

在 import 区块加入：

```typescript
import { stripContentBeforeFirstH1 } from '#shared/utils/markdown'
```

- [ ] **Step 2：在 `extractLastAIMessageContent` 之后 strip**

定位：

```typescript
                    const resultText = extractLastAIMessageContent(state.messages ?? [])
                    if (!resultText) {
                        logger.warn('分析持久化：未找到 AIMessage 内容，跳过落库', { analysisRecordId, agentName })
                        return
                    }
```

改为（**在 if 块之后新增一行**）：

```typescript
                    const resultText = extractLastAIMessageContent(state.messages ?? [])
                    if (!resultText) {
                        logger.warn('分析持久化：未找到 AIMessage 内容，跳过落库', { analysisRecordId, agentName })
                        return
                    }
                    // 清洗 LLM 偶发的前言说明文字，落库前必须去掉一级标题之前的内容
                    const cleanedResultText = stripContentBeforeFirstH1(resultText)
```

- [ ] **Step 3：把后面 `completeAnalysisWithRAG` 调用里的 `resultText` 换成 `cleanedResultText`**

定位（行 201-206 附近）：

```typescript
                    await completeAnalysisWithRAG({
                        analysisId: analysisRecordId,
                        analysisResult: resultText,
                        tokens,
                        tokenCount,
                    })
```

改为：

```typescript
                    await completeAnalysisWithRAG({
                        analysisId: analysisRecordId,
                        analysisResult: cleanedResultText,
                        tokens,
                        tokenCount,
                    })
```

- [ ] **Step 4：把 `resultLength` 日志改成反映清洗后长度**

定位（行 208-214 附近）：

```typescript
                    logger.info('分析持久化：完成分析记录', {
                        analysisId: analysisRecordId,
                        agentName,
                        resultLength: resultText.length,
                        tokens,
                        tokenCount,
                    })
```

改为：

```typescript
                    logger.info('分析持久化：完成分析记录', {
                        analysisId: analysisRecordId,
                        agentName,
                        resultLength: cleanedResultText.length,
                        tokens,
                        tokenCount,
                    })
```

> 落库长度应反映清洗后的实际写入字数。

- [ ] **Step 5：typecheck**

```bash
bun run typecheck
```

Expected: 无新增 type 错误。

---

## Task 6：跑相关单元测试 + simplify + commit 三处接入点

**Files:**（仅跑测试，无新增 / 修改）

- [ ] **Step 1：跑工具单元测试（再次确认）**

```bash
npx vitest run tests/shared/utils/markdown.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 2：跑相关接入点已有套件**

```bash
npx vitest run tests/server/services/workflow/ tests/server/services/agent-platform/ tests/server/agents/ --reporter=verbose
```

Expected:
- 已有套件全部 PASS（本次只是在落库前做了 idempotent 的字符串清洗，不影响行为）
- 若发现 fail 是**与本次改动相关的回归**（如某个测试 fixture 假定了落库内容含前言），按 spec 改测试 fixture，**不要**回滚 strip
- 若 fail 与本次无关（项目存量失败 / 环境问题），记录到 `tests/KNOWN_FAILS.md` 并继续

- [ ] **Step 3：用 simplify 技能审视三个接入点改动**

调用 `simplify` 技能审视：
- [server/services/workflow/caseAnalysisV2.workflow.ts:262](server/services/workflow/caseAnalysisV2.workflow.ts:262) 附近改动
- [server/services/agent-platform/tools/saveAnalysisResult.tool.ts:148](server/services/agent-platform/tools/saveAnalysisResult.tool.ts:148) 附近改动
- [server/agents/case-module/middleware/analysisResultPersistence.middleware.ts:168](server/agents/case-module/middleware/analysisResultPersistence.middleware.ts:168) 附近改动

按其建议修正。修正后再跑一次 Step 2 的测试确认未引入回归。

- [ ] **Step 4：commit 三处接入点**

```bash
git add server/services/workflow/caseAnalysisV2.workflow.ts \
        server/services/agent-platform/tools/saveAnalysisResult.tool.ts \
        server/agents/case-module/middleware/analysisResultPersistence.middleware.ts
git commit -m "$(cat <<'EOF'
feat(analysis): 案件分析与模块对话落库前清洗一级标题前的说明性文字

- caseAnalysisV2 工作流子代理结果落库前 strip
- 模块对话 save_analysis_result 工具落库前 strip
- 模块对话 afterAgent 兜底落库前 strip
EOF
)"
```

---

## Task 7：全量相关测试 + 文档收尾

**Files:**（无修改）

- [ ] **Step 1：跑 server + shared 全量测试**

```bash
bun run test:server
bun run test:shared
```

Expected: 全部 PASS（或 fail 项均与本次改动无关）。

- [ ] **Step 2：跑最终 typecheck**

```bash
bun run typecheck
```

Expected: 无新增 type 错误。

- [ ] **Step 3：人工 sanity check**

到本地 dev 跑一次案件分析（任意子模块），打开 DB（用 `bun run prisma:studio` 或直接 psql 查 `caseAnalyses.analysisResult`），确认最新一条记录的首字符就是 `#`，没有前言说明文字。

> 如果 LLM 本次输出恰好规范（无前言），看 logger 里 `分析结果持久化完成` 的 `resultLength` 与原始长度差 0 即可。

- [ ] **Step 4：spec 收尾（无需修改）**

确认 [docs/superpowers/specs/2026-05-17-strip-pre-h1-on-save-design.md](../specs/2026-05-17-strip-pre-h1-on-save-design.md) 与最终实现一致。本计划不涉及 spec 范围调整，预期不需要改 spec。

- [ ] **Step 5：push 与 PR 由用户决定**

本计划不强制 push。等用户确认上线节奏后再走 PR / 合并流程。

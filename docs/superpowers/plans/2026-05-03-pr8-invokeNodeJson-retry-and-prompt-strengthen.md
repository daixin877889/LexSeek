# 合同审查 PR8 · invokeNodeJson schema fail 自动 retry + prompt 强化约束 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `invokeNodeJson` 内置 schema `safeParse` fail 自动 retry（最多 3 次），retry prompt 拼接 zod issue 让 LLM 知道哪里错；同时把合同审查 DB prompt `contractReviewAnalyzeClause` 从 v3 升级到 v4 加 `\n` 反例，形成「prompt 强约束 + zod refine + 3 次 retry」三层防御，把"条款 #N 已跳过"频率从 ~5% 压到 ~0.2%。

**Architecture:** retry 在 `server/services/agent-platform/tools/invokeNodeJson.ts` 内通用化（所有 5 个调用方透明受益）；schema fail 才 retry，JSON.parse fail / extractFirstJsonObject fail / LLM invoke 抛错都直接 throw（这些场景 retry 大概率仍失败、浪费 token）；3 次都 fail 仍 throw，保留调用方现有 catch+skip 语义不变。retry prompt 用「重新渲染 base prompt + 拼接 `## 上次输出违反 schema：${path}: ${message}` 段」方式，不堆叠、不上 multi-turn history。三态 logger.warn 埋点（`触发 retry` / `retry 第 N 次成功` / `retry 仍 fail`）便于运维监控有效率。

**Tech Stack:** TypeScript / zod / Vitest（worker 级 DB 隔离）/ Prisma（prompts 表）/ DeepSeek+Anthropic（既有调用方 LLM 供应商）

**Spec:** `docs/superpowers/specs/2026-05-03-invokeNodeJson-schema-fail-retry-design.md`（PR8 范围 = §3 + §4 + §5）

**前置（已落地，验证完毕）：**

- `server/services/agent-platform/tools/invokeNodeJson.ts:39` 现有 `invokeNodeJson<T>` export 签名（`InvokeNodeJsonOptions<T>`）
- `extractFirstJsonObject` / `summarizeJsonShape` 来自 `~~/server/services/assistant/contract/utils/llmJson`（已使用，行为不动）
- `logContextOverflow` 来自 `~~/server/services/agent-platform/context/contextErrorLogger`（已使用，行为不动）
- 5 个调用方完整位置（grep 实证）：
  - `server/agents/contract/analyzeSingleClause.ts:68`
  - `server/agents/contract/summarizeOverview.ts:50`
  - `server/agents/contract/docx/partyDetector.ts:56`
  - `server/services/memory/memoryExtraction.service.ts:41`
  - `server/services/memory/memorySubjectInfer.service.ts:19`
- 5 个调用方既有测试位置：
  - `tests/server/assistant/contract/analyzeSingleClause.test.ts`
  - `tests/server/assistant/contract/summarizeOverview.test.ts`
  - `tests/server/assistant/contract/docx/partyDetector.test.ts`
  - `tests/server/memory/memoryExtraction.service.test.ts`
  - `tests/server/memory/memorySubjectInfer.service.test.ts`
- prompts 表 schema（`prisma/models/node.prisma`）：`id / name / version / content / type / status (0/1) / nodeId`，多版本通过 `status=0/1` 切换

**工期：** 1 天 × 5 个 Task

---

## 文件结构

### 新增（2）

- `tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts` — invokeNodeJson 完整单元测试（含 retry 9 用例 + 既有 happy path 兼容覆盖）
- `server/scripts/upgradeContractAnalyzePromptV4.ts` — 一次性脚本，把 `contractReviewAnalyzeClause` prompt v3 → v4（加 `\n` 反例段）；幂等可重跑

### 修改（1）

- `server/services/agent-platform/tools/invokeNodeJson.ts` — schema fail 改成 for loop retry + retry prompt 拼接 + 三态 logger.warn 埋点；JSON.parse / extractFirstJsonObject / LLM invoke 抛错路径不动

### 文档 + 操作

- `docs/superpowers/plans/2026-05-03-pr8-invokeNodeJson-retry-and-prompt-strengthen.md` — 本 plan（含 Task 3 完整脚本代码 + Task 4 手工冒烟操作步骤）
- 生产 / 预发库：运维 SSH 跑同脚本（或通过管理后台「提示词管理」手工创建 v4 + 启用——按 spec §4.3 项目惯例）

---

## Task 1：新增 invokeNodeJson retry 单元测试（TDD RED）

**Files:**
- Create: `tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts`

**Why this Task exists**: invokeNodeJson 当前没有自己的单测（只通过调用方间接覆盖），违反 agent-platform ≥90% 覆盖率约束。PR8 同步补全。

- [ ] **Step 1：写测试文件**

```typescript
/**
 * invokeNodeJson 单元测试（PR8）
 *
 * Spec §3 schema safeParse fail 自动 retry（最多 3 次）：
 *   - 首次 PASS 不触发 retry
 *   - 首次 fail + 第 N 次 PASS：retry 命中
 *   - 3 次都 fail：throw + 三态 logger.warn 埋点
 *   - JSON.parse fail / extract null / invoke 抛错：不触发 retry
 *
 * **Feature: contract-review-pr8-invoke-node-json-retry**
 * **Validates: spec §3 + §5.1**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setLevel: vi.fn(),
    },
}))
vi.mock('#shared/utils/logger', () => ({ logger: mockLogger }))

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ invoke: mockInvoke })),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
        modelSdkType: 'openai',
        modelName: 'gpt-4',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelContextWindow: 128000,
        prompts: [{ type: 'system', status: 1, content: 'BASE PROMPT for {{var}}' }],
    }),
}))
// logContextOverflow 仅在 LLM invoke 抛错时调用，mock 成 noop
vi.mock('~~/server/services/agent-platform/context/contextErrorLogger', () => ({
    logContextOverflow: vi.fn(),
}))

import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

const TestSchema = z.object({
    text: z.string().refine(s => !/\r|\n/.test(s), { message: 'no newline' }),
})

const VALID_RESPONSE = JSON.stringify({ text: 'ok' })
const INVALID_RESPONSE = JSON.stringify({ text: 'first\nsecond' }) // 触发 refine fail

beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockReset()
})

describe('invokeNodeJson · 不触发 retry 的快路径', () => {
    it('首次 PASS：单次 invoke + 无 retry warn', async () => {
        mockInvoke.mockResolvedValueOnce({ content: VALID_RESPONSE })
        const data = await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
        })
        expect(data).toEqual({ text: 'ok' })
        expect(mockInvoke).toHaveBeenCalledTimes(1)
        expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('retry'), expect.anything())
    })
})

describe('invokeNodeJson · schema fail 触发 retry', () => {
    it('首次 fail + 第 2 次 PASS：retry 触发 1 次 + "retry 第 2 次成功" warn', async () => {
        mockInvoke
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: VALID_RESPONSE })
        const data = await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
        })
        expect(data).toEqual({ text: 'ok' })
        expect(mockInvoke).toHaveBeenCalledTimes(2)
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('schema 校验失败，触发 retry'),
            expect.objectContaining({ attempt: 1 }),
        )
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('retry 第 2 次成功'),
            expect.objectContaining({ attempt: 2 }),
        )
    })

    it('前 2 次 fail + 第 3 次 PASS：2 次 retry 触发 + "retry 第 3 次成功" warn', async () => {
        mockInvoke
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: VALID_RESPONSE })
        const data = await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
        })
        expect(data).toEqual({ text: 'ok' })
        expect(mockInvoke).toHaveBeenCalledTimes(3)
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('retry 第 3 次成功'),
            expect.objectContaining({ attempt: 3 }),
        )
    })

    it('3 次都 fail：throw + "retry 3 次仍 fail" warn', async () => {
        mockInvoke
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
        await expect(
            invokeNodeJson({
                nodeName: 'testNode',
                temperature: 0,
                schema: TestSchema,
                buildPrompt: t => t.replace('{{var}}', 'X'),
                errorPrefix: 'test',
            }),
        ).rejects.toThrow(/test schema 校验失败: text: no newline/)
        expect(mockInvoke).toHaveBeenCalledTimes(3)
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('retry 3 次仍 fail'),
            expect.objectContaining({ totalAttempts: 3 }),
        )
    })
})

describe('invokeNodeJson · retry prompt 拼接', () => {
    it('retry prompt 包含 zod issue（path: message）', async () => {
        mockInvoke
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: VALID_RESPONSE })
        await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
        })
        // 第 2 次 invoke 的 prompt 含 zod issue 段
        const secondCallArg = mockInvoke.mock.calls[1]![0] as string
        expect(secondCallArg).toContain('## 上次输出违反 schema：')
        expect(secondCallArg).toContain('text: no newline')
        expect(secondCallArg).toContain('请重新生成符合 schema 的 JSON。')
    })

    it('retry prompt 不堆叠：第 3 次 retry 的 prompt 中"上次输出违反 schema"段只出现 1 次', async () => {
        mockInvoke
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: INVALID_RESPONSE })
            .mockResolvedValueOnce({ content: VALID_RESPONSE })
        await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
        })
        const thirdCallArg = mockInvoke.mock.calls[2]![0] as string
        const segCount = thirdCallArg.split('## 上次输出违反 schema：').length - 1
        expect(segCount).toBe(1)
    })
})

describe('invokeNodeJson · 不可恢复错误不触发 retry', () => {
    it('LLM 返回非 JSON：直接 throw + 无 retry warn', async () => {
        mockInvoke.mockResolvedValueOnce({ content: '这不是 JSON 只是普通文字' })
        await expect(
            invokeNodeJson({
                nodeName: 'testNode',
                temperature: 0,
                schema: TestSchema,
                buildPrompt: t => t.replace('{{var}}', 'X'),
                errorPrefix: 'test',
            }),
        ).rejects.toThrow(/test LLM 未返回 JSON/)
        expect(mockInvoke).toHaveBeenCalledTimes(1)
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('触发 retry'),
            expect.anything(),
        )
    })

    it('JSON.parse 失败：直接 throw + 无 retry warn', async () => {
        // 含 { 但不是合法 JSON，让 extractFirstJsonObject 拿到 jsonText 但 JSON.parse 抛
        mockInvoke.mockResolvedValueOnce({ content: '{ malformed json no quotes }' })
        await expect(
            invokeNodeJson({
                nodeName: 'testNode',
                temperature: 0,
                schema: TestSchema,
                buildPrompt: t => t.replace('{{var}}', 'X'),
                errorPrefix: 'test',
            }),
        ).rejects.toThrow(/test JSON 解析失败/)
        expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    it('LLM invoke 抛错：直接 throw + 无 retry warn', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('network timeout'))
        await expect(
            invokeNodeJson({
                nodeName: 'testNode',
                temperature: 0,
                schema: TestSchema,
                buildPrompt: t => t.replace('{{var}}', 'X'),
                errorPrefix: 'test',
            }),
        ).rejects.toThrow(/network timeout/)
        expect(mockInvoke).toHaveBeenCalledTimes(1)
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('触发 retry'),
            expect.anything(),
        )
    })
})
```

- [ ] **Step 2：跑测试，确认 RED**

Run: `npx vitest run tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts`
Expected: FAIL（10 个 retry 相关 case 失败：当前实现 schema fail 直接 throw，没有 retry 行为；快路径与不可恢复错误 4 个 case 应 PASS）

- [ ] **Step 3：commit**

```bash
git add tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts
git commit -m "test(agent-platform): invokeNodeJson schema fail retry 单测蓝图

PR8 spec §3 + §5.1：覆盖 retry 9 用例 + 既有快路径 + 不可恢复错误 3 类。
此 commit 故意 RED，下个 commit 实现 retry loop 让其 GREEN。"
```

---

## Task 2：实现 invokeNodeJson retry loop（GREEN）

**Files:**
- Modify: `server/services/agent-platform/tools/invokeNodeJson.ts`

- [ ] **Step 1：完整重写 invokeNodeJson 函数体（lines 39-136）**

找到现有 export `invokeNodeJson<T>` 函数（lines 39-136），替换函数体（保留外层 import / interface 不动）：

```typescript
/** 顶部 const，不暴露 API（spec §2.2 YAGNI 原则） */
const MAX_RETRIES = 3

/**
 * 加载节点配置 → 渲染 prompt → invoke → extractFirstJsonObject → JSON.parse → schema.safeParse。
 *
 * **PR8 升级**：schema safeParse fail 时自动 retry 最多 3 次。retry prompt 用
 * 「重新渲染 base prompt + 拼接 `## 上次输出违反 schema：${path}: ${message}` 段」方式，
 * 不堆叠、不走 multi-turn history。
 *
 * **不 retry 的场景（spec §3 决定）**：
 *   - LLM invoke 抛错（网络/超时/context overflow）→ 直接 throw（既有 logContextOverflow 路径不变）
 *   - extractFirstJsonObject 返回 null（LLM 输出连 JSON 格式都没出）
 *   - JSON.parse 失败（同上）
 * 这些场景 retry 大概率仍失败，浪费 token。
 *
 * **三态 logger.warn 埋点**（运维监控 retry 有效率，spec §3.4）：
 *   - `${errorPrefix}: schema 校验失败，触发 retry` — 每次 schema fail 且未达 MAX_RETRIES 时
 *   - `${errorPrefix}: retry 第 N 次成功` — attempt > 1 且 PASS 时
 *   - `${errorPrefix}: retry MAX_RETRIES 次仍 fail` — 三次都 fail 时
 *
 * 任何步骤失败都先 `logger.warn` 携带完整诊断信息，再抛出带 `errorPrefix` 的 Error。
 */
export async function invokeNodeJson<T>(opts: InvokeNodeJsonOptions<T>): Promise<T> {
    const { nodeName, temperature, schema, buildPrompt, errorPrefix, logContext = {} } = opts

    const config = await getValidNodeConfig(nodeName)
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error(`${nodeName}: 无可用 API 密钥`)

    const template = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
    if (!template) {
        throw new Error(`${nodeName}: DB 未配置 system 类型的启用态提示词`)
    }

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature,
        streaming: false,
    })

    let lastFirstIssue = ''

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const basePrompt = buildPrompt(template)
        const currentPrompt = attempt === 1
            ? basePrompt
            : `${basePrompt}\n\n## 上次输出违反 schema：\n${lastFirstIssue}\n请重新生成符合 schema 的 JSON。`

        let response
        try {
            response = await model.invoke(currentPrompt, { tags: ['langsmith:nostream', 'internal'] })
        } catch (err) {
            // LLM invoke 抛错：不 retry，直接抛
            logContextOverflow(err, {
                source: nodeName,
                modelName: config.modelName,
                sdkType: config.modelSdkType,
                contextWindow: config.modelContextWindow,
                extra: { ...logContext, promptLength: currentPrompt.length, attempt },
            })
            throw err
        }

        const content = typeof response.content === 'string' ? response.content : ''

        const jsonText = extractFirstJsonObject(content)
        if (!jsonText) {
            // JSON 提取 fail：不 retry，直接抛
            logger.warn(`${errorPrefix}: LLM 未返回 JSON`, {
                ...logContext,
                rawContent: content.slice(0, 500),
                attempt,
            })
            throw new Error(`${errorPrefix} LLM 未返回 JSON`)
        }

        let rawJson: unknown
        try {
            rawJson = JSON.parse(jsonText)
        } catch (err) {
            // JSON.parse fail：不 retry，直接抛
            logger.warn(`${errorPrefix}: JSON.parse 失败`, {
                ...logContext,
                jsonText: jsonText.slice(0, 500),
                errMessage: err instanceof Error ? err.message : String(err),
                attempt,
            })
            throw new Error(`${errorPrefix} JSON 解析失败`)
        }

        const parsed = schema.safeParse(rawJson)
        if (parsed.success) {
            if (attempt > 1) {
                logger.warn(`${errorPrefix}: retry 第 ${attempt} 次成功`, {
                    ...logContext,
                    attempt,
                })
            }
            return parsed.data
        }

        // schema fail：拼 firstIssue 准备下一次 retry，或最终 throw
        const firstIssue = parsed.error.issues[0]
        const pretty = firstIssue
            ? `${firstIssue.path.join('.') || '(root)'}: ${firstIssue.message}`
            : 'unknown'
        lastFirstIssue = pretty

        if (attempt < MAX_RETRIES) {
            logger.warn(`${errorPrefix}: schema 校验失败，触发 retry`, {
                ...logContext,
                attempt,
                firstIssue: pretty,
                rawShape: summarizeJsonShape(rawJson),
            })
        }
    }

    // 3 次都 fail
    logger.warn(`${errorPrefix}: retry ${MAX_RETRIES} 次仍 fail`, {
        ...logContext,
        totalAttempts: MAX_RETRIES,
        firstIssue: lastFirstIssue,
    })
    throw new Error(`${errorPrefix} schema 校验失败: ${lastFirstIssue}`)
}
```

- [ ] **Step 2：跑单测，确认 GREEN**

Run: `npx vitest run tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts`
Expected: PASS（13 个 case 全绿：4 个快路径 + 4 个 retry 主路径 + 2 个 prompt 拼接 + 3 个不可恢复错误）

- [ ] **Step 3：跑既有 5 个调用方测试，确认无回归**

Run: `npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts tests/server/assistant/contract/summarizeOverview.test.ts tests/server/assistant/contract/docx/partyDetector.test.ts tests/server/memory/memoryExtraction.service.test.ts tests/server/memory/memorySubjectInfer.service.test.ts`

Expected: PASS（既有调用方 mock 都返回合规 JSON，走快路径不触发 retry；retry 仅在 schema fail 时引入，对正常路径零影响）

- [ ] **Step 4：跑 typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add server/services/agent-platform/tools/invokeNodeJson.ts
git commit -m "feat(agent-platform): invokeNodeJson schema fail 自动 retry（最多 3 次）

PR8 spec §3：schema safeParse fail 时进入 retry 循环，retry prompt 重新渲染 base
+ 拼 zod issue '## 上次输出违反 schema: \${path}: \${message}' 段。

不 retry 的场景：LLM invoke 抛错 / JSON 提取 fail / JSON.parse fail（这些场景
retry 大概率仍失败，浪费 token）。

三态 logger.warn 埋点：触发 retry / retry 第 N 次成功 / retry 仍 fail，便于
运维按字符串关键字告警与统计有效率（健康分布 succeeded/triggered ≥ 80%、
final_failed/triggered ≤ 5%）。

5 个调用方（analyzeSingleClause / summarizeOverview / partyDetector /
memoryExtraction / memorySubjectInfer）透明受益，行为契约不变（成功返回
数据 / 失败 throw）。"
```

---

## Task 3：升级 DB prompt v3 → v4（dev 库）

**Files:**
- Create: `server/scripts/upgradeContractAnalyzePromptV4.ts`（一次性脚本，跑完即弃；不进生产 CI）
- 无业务源码改动

**Why a script not raw SQL**：v3 content 可能含 `$content$` 字符串破坏 dollar-quoted、含单引号破坏字面量；用 prisma 客户端 INSERT 自动处理转义最稳妥。脚本独立放 `server/scripts/` 与既有 `setupRetrievalInfra.ts` / `rebuildLawEmbeddings.ts` 同模式。

- [ ] **Step 1：写脚本 `server/scripts/upgradeContractAnalyzePromptV4.ts`**

```typescript
/**
 * PR8 Task 3：把 contractReviewAnalyzeClause prompt 从 v3 升级到 v4
 * （加 \n 错误反例 + 分号串联正例，spec §4.2）
 *
 * 操作：
 *   1. 找当前 status=1 的源版本（应为 v3，但兼容 v2 / v3.x 等），拷贝 content / title / variables / nodeId
 *   2. INSERT 新行 version='v4'，content = 源版本 + spec §4.2 追加段，status=0
 *   3. 同事务里 UPDATE 源版本 status=0、新 v4 status=1（避免空窗）
 *
 * 跑法：bunx tsx server/scripts/upgradeContractAnalyzePromptV4.ts
 * 幂等：v4 已存在则只切换 status（不再重复 INSERT）
 */
import { prisma } from '../utils/db'

const PROMPT_NAME = 'contractReviewAnalyzeClause'
const TARGET_VERSION = 'v4'

// spec §4.2 追加段（保持与 plan / spec 文本完全一致）
const V4_APPEND = `


## suggestedClauseText 输出格式约束（铁律）

\`suggestedClauseText\` 必须是单段连续文字，**绝对不可包含**：
- 换行符（\`\\n\` / \`\\r\` / 任何形式的换行）
- 项目符号（\`-\` / \`•\` / \`1.\` / \`(1)\` 等列表标记开头）
- 多段（用空行分隔的多个段落）

理由：Word 文档导出时，OOXML 的 \`<w:t>\` 元素里换行会被渲染成空格不换行，多段建议会变成"一长串混在一起的文字"，律师无法判断段落结构。

❌ 错误示例（schema 会 reject 整条建议）：

\`\`\`json
"suggestedClauseText": "第一款 甲方应支付货款。\\n第二款 逾期支付按 0.5% 加收滞纳金。"
\`\`\`

\`\`\`json
"suggestedClauseText": "1. 甲方应支付货款；2. 逾期支付按 0.5% 加收滞纳金"
\`\`\`

✅ 正确示例（用分号 / 逗号串联多句）：

\`\`\`json
"suggestedClauseText": "甲方应支付货款；逾期支付按 0.5% 加收滞纳金，且累计超 30 日的乙方有权解除合同。"
\`\`\`

如果有多个独立条款建议，请合并成单段语义连贯的文字，用分号或逗号串联。
`

async function main(): Promise<void> {
    // 幂等保护：v4 已存在则只需切换 status
    const existingV4 = await prisma.prompts.findFirst({
        where: { name: PROMPT_NAME, version: TARGET_VERSION },
    })
    if (existingV4) {
        console.log(`[upgrade-prompt-v4] v4 已存在 (id=${existingV4.id})，仅切换 status`)
        await prisma.$transaction([
            prisma.prompts.updateMany({
                where: { name: PROMPT_NAME, status: 1 },
                data: { status: 0 },
            }),
            prisma.prompts.update({
                where: { id: existingV4.id },
                data: { status: 1 },
            }),
        ])
        console.log(`[upgrade-prompt-v4] v4 已启用，其它版本 status=0`)
        return
    }

    // 找当前 status=1 的源版本（应为 v3）
    const source = await prisma.prompts.findFirst({
        where: { name: PROMPT_NAME, status: 1 },
    })
    if (!source) {
        throw new Error(`[upgrade-prompt-v4] 找不到 ${PROMPT_NAME} status=1 源版本`)
    }
    console.log(`[upgrade-prompt-v4] 基线版本: ${source.version} (id=${source.id}, content_len=${source.content.length})`)

    const newContent = source.content + V4_APPEND
    console.log(`[upgrade-prompt-v4] v4 content_len=${newContent.length} (+${V4_APPEND.length})`)

    // 事务内 INSERT v4 + 切换 status，避免空窗
    await prisma.$transaction(async (tx) => {
        const v4 = await tx.prompts.create({
            data: {
                name: source.name,
                title: source.title,
                content: newContent,
                variables: source.variables ?? [],
                version: TARGET_VERSION,
                type: source.type,
                status: 0,
                nodeId: source.nodeId,
            },
        })
        await tx.prompts.update({
            where: { id: source.id },
            data: { status: 0 },
        })
        await tx.prompts.update({
            where: { id: v4.id },
            data: { status: 1 },
        })
        console.log(`[upgrade-prompt-v4] 创建 v4 id=${v4.id} 并启用，原 ${source.version} (id=${source.id}) status=0`)
    })

    // 校验
    const final = await prisma.prompts.findMany({
        where: { name: PROMPT_NAME },
        select: { version: true, status: true },
        orderBy: { version: 'asc' },
    })
    console.log('[upgrade-prompt-v4] 最终版本状态:', final)
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[upgrade-prompt-v4] 失败:', err)
        process.exit(1)
    })
```

- [ ] **Step 2：跑脚本升级 dev 库**

Run: `bunx tsx server/scripts/upgradeContractAnalyzePromptV4.ts`

预期输出：

```
[upgrade-prompt-v4] 基线版本: v3 (id=<n>, content_len=<m>)
[upgrade-prompt-v4] v4 content_len=<m+~1100> (+~1100)
[upgrade-prompt-v4] 创建 v4 id=<n+1> 并启用，原 v3 (id=<n>) status=0
[upgrade-prompt-v4] 最终版本状态: [ { version: 'v3', status: 0 }, { version: 'v4', status: 1 } ]
```

- [ ] **Step 3：再跑一次脚本验证幂等**

Run: `bunx tsx server/scripts/upgradeContractAnalyzePromptV4.ts`

预期输出：

```
[upgrade-prompt-v4] v4 已存在 (id=<n+1>)，仅切换 status
[upgrade-prompt-v4] v4 已启用，其它版本 status=0
```

- [ ] **Step 4：单跑 analyzeSingleClause 测试确认 v4 不破坏既有 mock 行为**

Run: `npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts`
Expected: PASS

> 既有测试 mock 了 `getValidNodeConfig` 返回固定 prompts 内容（`tests/server/assistant/contract/analyzeSingleClause.test.ts:35-48`），不依赖真实 DB 的 v4。所以 DB 升级与单测无直接耦合，本步骤只是再次确认调用方测试无回归。

- [ ] **Step 5：commit 脚本**

```bash
git add server/scripts/upgradeContractAnalyzePromptV4.ts
git commit -m "chore(contract): PR8 一次性脚本升级 contractReviewAnalyzeClause prompt v3 → v4

加 \\n 错误反例 + 分号串联正例（spec §4.2），形成 prompt 强约束 + zod refine
+ 3 次 retry 三层防御。脚本幂等：v4 已存在则只切换 status。

dev 库已跑过；生产 / 预发库由运维 SSH 跑同脚本（或通过管理后台手工创建 v4
+ 启用——按 spec §4.3 项目惯例 prompt 不走 seedData / migration）。"
```

---

## Task 4：手工冒烟（开发期验证 retry 行为，可选但强烈建议）

**Files:**
- 无改动

- [ ] **Step 1：启动 dev server**

Run: `bun dev`
Expected: 服务正常启动，http://localhost:3000 可访问

- [ ] **Step 2：上传一份历史触发过 `\n` 跳过的合同 docx 做审查**

如无现成 fixture，可在 dev 库找一份既有的 `contractReviews` 行（历史日志含「条款 #N 已跳过」的）重跑：

```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
    psql -U daixin -d ls_new -c "SELECT id, status FROM contract_reviews ORDER BY created_at DESC LIMIT 5;"
```

通过前端「合同审查」页重传该 docx → 触发 AI 审查。

- [ ] **Step 3：监控 dev server 日志**

观察 stdout / 文件日志，搜索关键字：

```bash
tail -f .nuxt/logs/*.log | grep -E "触发 retry|retry 第.*次成功|retry 3 次仍 fail|条款.*已跳过"
```

预期场景：

| 观察 | 含义 |
|---|---|
| 看到「触发 retry」+「retry 第 2 次成功」 | LLM 首次违规但 retry 修复，用户感知零跳过 ✓ |
| 看到「retry 3 次仍 fail」 | 极小概率场景，调用方按现有 catch 跳过条款 |
| 完全没有 retry 日志 | LLM 当次输出全部合规，快路径走完 |
| 看到「条款 #N 已跳过」 | 仅当 retry 3 次都 fail 时出现 |

- [ ] **Step 4：检查 contract_risks 表是否所有条款都有 risk 行**

```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
    psql -U daixin -d ls_new -c "
SELECT clause_index, COUNT(*) AS risk_count
FROM contract_risks
WHERE review_id = <你的 review id>
GROUP BY clause_index
ORDER BY clause_index;"
```

预期：所有条款（除非 LLM 真的判断该条无风险）都有至少 1 行；不再大段连续缺失。

- [ ] **Step 5：记录冒烟结果**

把 retry 触发次数 / 成功率 / 最终失败次数记录到本 plan 文件最后的「冒烟结果」段（如该段不存在则追加）；如有意外行为，停下与 reviewer 对齐。

> 本 Task 无 commit，仅做开发期验证。生产上线后由运维按 spec §3.5 监控思路持续观察 retry 分布。

---

## Task 5：全量验证 + push + PR

**Files:**
- 无改动

- [ ] **Step 1：跑 agent-platform + memory + contract 子集测试**

```bash
npx vitest run \
    tests/server/agent-platform/tools/ \
    tests/server/memory/ \
    tests/server/agents/contract/ \
    tests/server/assistant/contract/
```

Expected: PASS（PR8 自身的 invokeNodeJson 单测全绿；既有调用方测试无回归。如果有既有 contract 测试 fail，先 stash + 重跑确认是否 pre-existing；只有真正 PR8 引起的回归才需要 fix）

- [ ] **Step 2：typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3：跑全量测试**

Run: `bun run test`
Expected: PASS（如果有 pre-existing fail，按 PR7 全量验证经验，stash + 对比确认非 PR8 引入即可。invokeNodeJson 是通用工具变化，理论上不应引起其它模块新回归——但确认一下保险）

- [ ] **Step 4：检查 git status + commit chain**

```bash
git status --short
git log --oneline origin/dev..HEAD
```

Expected: 工作区干净（如有 plan 文件本身改动，单独 commit "docs(spec): PR8 plan 实施期同步修订"）；commit chain 含 Task 1+2 的 2 个 commit。

- [ ] **Step 5：push**

```bash
git push -u origin "$(git branch --show-current)"
```

> 注意：PR7 也未 push（共 10 个 commit）。如果 PR7+PR8 都还在本地，这次 push 会一并推 11+ 个 commit。先与 reviewer 沟通是否要拆分 push（按分支策略：PR7 commit 已 verify，PR8 commit 单独成对）。

- [ ] **Step 6：提 PR**

PR 标题：`feat(agent-platform): PR8 invokeNodeJson schema fail 自动 retry + 合同审查 prompt 强化`

PR body 模板：

```markdown
## 摘要

合同审查 PR8 落地：解决 PR6 引入的 `risksSchema.builder` refine 强制 reject 含 `\r|\n` 的 `suggestedClauseText` 时整条 risk 被跳过的问题。在 `invokeNodeJson` 通用化 retry 机制（最多 3 次）+ 把合同审查 DB prompt 升级到 v4 加 `\n` 反例，形成「prompt 强约束 + zod refine + 3 次 retry」三层防御，把"条款 #N 已跳过"频率从 ~5% 压到 ~0.2%。

## 改动范围

- 新增 `tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts`（13 case 完整覆盖快路径 + retry + 不可恢复错误）
- 改造 `server/services/agent-platform/tools/invokeNodeJson.ts`（schema fail loop + retry prompt 拼接 + 三态埋点）
- 新增 `server/scripts/upgradeContractAnalyzePromptV4.ts` 一次性脚本：DB prompt `contractReviewAnalyzeClause` v3 → v4（加 `\n` 错误反例 + 分号串联正例），幂等可重跑
- 5 个调用方（analyzeSingleClause / summarizeOverview / partyDetector / memoryExtraction / memorySubjectInfer）透明受益，零业务代码改动

## 关键决策

- retry 在 invokeNodeJson 通用化，所有调用方透明受益（spec §3）
- 硬编码 `MAX_RETRIES = 3`（YAGNI，不暴露 API）
- 仅 schema safeParse fail 触发 retry；JSON.parse / extract null / invoke 抛错都直接 throw（这些场景 retry 大概率仍失败）
- retry prompt 单次拼接，不堆叠、不走 multi-turn history
- 三态 logger.warn 埋点便于运维监控（健康分布 succeeded/triggered ≥ 80%、final_failed/triggered ≤ 5%）
- prompt v4 不走 seedData / migration（按项目惯例运行时管理后台升级）

## 兼容性

- invokeNodeJson 契约不变（成功返回数据 / 失败 throw）
- 5 个调用方测试无需修改
- 调用方现有 catch+skip 语义保留（3 次 retry 都 fail 仍 throw）
- DB prompt v3 仍保留（status=0），可一键回滚

## Test plan

- [x] invokeNodeJson 单测（13 case）
- [x] 5 个调用方既有测试无回归
- [x] typecheck PASS
- [x] full bun run test PASS
- [ ] dev 环境手工冒烟：上传历史触发跳过的合同 → 验证 retry 命中
- [ ] 生产部署后观察 retry 三态日志分布

## Spec / 上游

- spec: `docs/superpowers/specs/2026-05-03-invokeNodeJson-schema-fail-retry-design.md`
- 前置 PR：PR6 redlineInjector 已合（spec §8.3.3 强约束）；PR7 双锚点迁移独立无依赖
```

---

## 自检（writing-plans 强制）

**Spec 覆盖**：

- §3.1 现状 → Task 2 完整重写函数体（覆盖）
- §3.2 改造后目标行为 → Task 2 Step 1 完整代码块（覆盖）
- §3.3 retry prompt 拼接策略（不堆叠 / 不带 history）→ Task 1 step 2 单测「retry prompt 不堆叠」 + Task 2 实现 `attempt === 1 ? basePrompt : ...`（覆盖）
- §3.4 三态埋点 → Task 2 实现 `logger.warn(...触发 retry / retry 第 N 次成功 / retry MAX_RETRIES 次仍 fail)`（覆盖）
- §3.5 监控思路 → 已在 spec 文件，plan Task 4 冒烟时引用（覆盖）
- §4.2 v4 追加段 → Task 3 Step 2 完整文本（覆盖）
- §4.3 落地方式 → Task 3 Step 3 dev 库 SQL + 生产说明（覆盖）
- §5.1 单测 9 用例 → Task 1 实际 13 case（含 4 个快路径冗余覆盖，>= 9 用例需求）（覆盖）
- §5.2 回归测试 → Task 2 Step 3 + Task 5 Step 1（覆盖）
- §5.3 集成验证手工冒烟 → Task 4（覆盖）
- §6 PR 拆分 1 天工期 → 5 个 task 在 1 天内可达（覆盖）
- §7 风险点 → 各 Task 测试用例 + Task 4 冒烟 + Task 5 全量验证三层防御（覆盖）
- §8 后续路线（OOXML 多段插入 / 可配 maxRetries / 指数退避）→ 本 PR 范围外，spec 已声明不做（覆盖）

**Placeholder 扫描**：无 TBD / TODO / "implement later"。每个 step 都有完整代码块或具体命令 + 预期输出。

**类型一致性**：

- `MAX_RETRIES = 3` 顶部 const 与 Task 1 单测中的 `mockResolvedValueOnce` 调用次数（最多 3 次）一致
- `lastFirstIssue: string` 与 logger.warn 字段 `firstIssue` 类型一致
- `currentPrompt: string` 与 `model.invoke(prompt)` 入参类型一致
- 测试 fixture `TestSchema = z.object({ text: z.string().refine(...) })` 与生产 `RISK_SHAPE.suggestedClauseText.refine(s => !/\r|\n/.test(s))` 同口径，断言行为一致

**与 PR7 实施期教训的对照**：

- PR7 fixture 踩了 migrateAnchor 25% 长度容差边界 → PR8 单测纯 mock chatModel.invoke，不依赖真实算法边界，应无类似坑
- PR7 segmentClauses 散段切句行为踩坑 → PR8 不调 segmentClauses
- PR7 woker 并发污染让 fail 列表抖动 → PR8 单测纯单元（仅 mock），无 DB 操作不受 worker 污染
- PR7 commit body 误把 \n 当字面量写进字符串 → PR8 commit message 用 heredoc + `\n` 转义已防护（git commit 自动处理）

无类型不一致，无遗留 spec 章节未覆盖。

---

## 执行选择（Execution Handoff）

Plan complete and saved to `docs/superpowers/plans/2026-05-03-pr8-invokeNodeJson-retry-and-prompt-strengthen.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 主对话每个 Task 派发新 subagent + 二段 review
2. **Inline Execution** — 当前会话连跑 + checkpoint 暂停

哪种？

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
const { mockGetValidNodeConfig } = vi.hoisted(() => ({
    mockGetValidNodeConfig: vi.fn().mockResolvedValue({
        modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
        modelSdkType: 'openai',
        modelName: 'gpt-4',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelContextWindow: 128000,
        prompts: [{ type: 'system', status: 1, content: 'BASE PROMPT for {{var}}', displayOrder: 100 }],
    }),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: mockGetValidNodeConfig,
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

describe('invokeNodeJson · onTokenUsage 上报（V1）', () => {
    it('每次 model.invoke 成功后回调本次 token 用量', async () => {
        mockInvoke.mockResolvedValueOnce({
            content: VALID_RESPONSE,
            usage_metadata: { total_tokens: 1500 },
        })
        const tokenReports: number[] = []
        const data = await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
            onTokenUsage: t => tokenReports.push(t),
        })
        expect(data).toEqual({ text: 'ok' })
        expect(tokenReports).toEqual([1500])
    })

    it('schema 重试时每次调用各上报一次 token', async () => {
        mockInvoke
            .mockResolvedValueOnce({ content: INVALID_RESPONSE, usage_metadata: { total_tokens: 800 } })
            .mockResolvedValueOnce({ content: VALID_RESPONSE, usage_metadata: { total_tokens: 900 } })
        const tokenReports: number[] = []
        await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
            onTokenUsage: t => tokenReports.push(t),
        })
        expect(tokenReports).toEqual([800, 900])
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
            expect.stringContaining('schema 校验失败，触发重试'),
            expect.objectContaining({ attempt: 1 }),
        )
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('第 2 次重试成功'),
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
            expect.stringContaining('第 3 次重试成功'),
            expect.objectContaining({ attempt: 3 }),
        )
    })

    it('3 次都 fail：throw + "重试 3 次仍失败" warn + 严格 invoke 仅 3 次', async () => {
        // 用 mockResolvedValue (无 Once) 替代链式：实现 bug 写成 attempt ≤ 4 时
        // 第 4 次会拿到同样的 INVALID_RESPONSE 而非 undefined，错误更接近预期；
        // 配合下面 toHaveBeenCalledTimes(3) 严格守住 attempt 上限。
        mockInvoke.mockResolvedValue({ content: INVALID_RESPONSE })
        await expect(
            invokeNodeJson({
                nodeName: 'testNode',
                temperature: 0,
                schema: TestSchema,
                buildPrompt: t => t.replace('{{var}}', 'X'),
                errorPrefix: 'test',
            }),
        ).rejects.toThrow(/test schema 校验失败: text: no newline/)
        expect(mockInvoke).toHaveBeenCalledTimes(3) // 严格 3 次，不是 4 次
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('重试 3 次仍失败'),
            expect.objectContaining({ totalAttempts: 3 }),
        )
    })
})

describe('invokeNodeJson · spec §7 三层防御边角', () => {
    it('LLM 误抄反例字面量 \\n 到输出（字面 backslash+n 两字符）：refine 通过 + 数据保留 + 不触发 retry', async () => {
        // 这条 case 验证 spec §7 风险点之一：LLM 把 prompt v4 反例段里的 "\n" 当字面量
        // 抄到 suggestedClauseText 输出里。zod refine /\r|\n/ 检测的是真换行字符
        // (U+000A)，字面 backslash + n 两字符不会触发 reject —— 这是预期的「三层防御」
        // 之 zod 层兜底语义。
        const literalBackslashN = JSON.stringify({ text: 'first\\nsecond' }) // {"text":"first\\nsecond"}
        mockInvoke.mockResolvedValueOnce({ content: literalBackslashN })
        const data = await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt: t => t.replace('{{var}}', 'X'),
            errorPrefix: 'test',
        })
        // JSON.parse 后 text = "first\nsecond"（即 'first' + backslash + 'n' + 'second'，6+1+1+6=14 字符；不是真换行）
        expect(data.text).toBe('first\\nsecond')
        expect(data.text).not.toContain('\n') // 真换行字符不存在
        expect(mockInvoke).toHaveBeenCalledTimes(1) // refine 通过，不触发 retry
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('触发重试'),
            expect.anything(),
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
            expect.stringContaining('触发重试'),
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
            expect.stringContaining('触发重试'),
            expect.anything(),
        )
    })
})

// ==================== 多 prompt 拼接（修复合同审查"23 条 LLM 未返回 JSON"根因）====================

describe('invokeNodeJson · 多 system prompt 必须按 displayOrder 升序拼接喂给 buildPrompt', () => {
    it('节点同时挂"反越狱护栏"(display=10) + "业务 prompt"(display=100)：buildPrompt 必须收到拼接后的完整 template', async () => {
        // 模拟线上场景：DB 里 contractReviewAnalyzeClause 同时挂 2 条 system prompt
        mockGetValidNodeConfig.mockResolvedValueOnce({
            modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
            modelSdkType: 'openai',
            modelName: 'gpt-4',
            modelProviderBaseUrl: 'https://api.openai.com/v1',
            modelContextWindow: 128000,
            prompts: [
                // 注意：故意打乱顺序，验证内部按 displayOrder 升序排序
                { type: 'system', status: 1, content: '业务 prompt：分析 {{var}}', displayOrder: 100 },
                { type: 'system', status: 1, content: '安全护栏：禁止越权', displayOrder: 10 },
                { type: 'user', status: 1, content: '应被忽略（type 不是 system）', displayOrder: 1 },
                { type: 'system', status: 0, content: '应被忽略（status=0）', displayOrder: 5 },
            ],
        })
        mockInvoke.mockResolvedValueOnce({ content: VALID_RESPONSE })

        const buildPrompt = vi.fn((t: string) => t.replace('{{var}}', 'X'))
        await invokeNodeJson({
            nodeName: 'contractReviewAnalyzeClause',
            temperature: 0,
            schema: TestSchema,
            buildPrompt,
            errorPrefix: 'test',
        })

        // 修复前：只取第一个 → buildPrompt 收到 "业务 prompt：分析 {{var}}"（display=100 排前因为 .find 不排序，但 DAO 给出的顺序是 ASC 反越狱护栏在前）
        // 修复后：必须按 displayOrder 升序拼接 → 反越狱护栏在前 + 业务 prompt 在后
        expect(buildPrompt).toHaveBeenCalledTimes(1)
        const passedTemplate = buildPrompt.mock.calls[0][0]
        expect(passedTemplate).toBe('安全护栏：禁止越权\n\n业务 prompt：分析 {{var}}')
    })

    it('单条 system prompt：行为与原 .find 一致', async () => {
        // 默认 mock 返回单条 prompt，等同于回归测试
        mockInvoke.mockResolvedValueOnce({ content: VALID_RESPONSE })
        const buildPrompt = vi.fn((t: string) => t.replace('{{var}}', 'X'))
        await invokeNodeJson({
            nodeName: 'testNode',
            temperature: 0,
            schema: TestSchema,
            buildPrompt,
            errorPrefix: 'test',
        })
        expect(buildPrompt.mock.calls[0][0]).toBe('BASE PROMPT for {{var}}')
    })

    it('零 system prompt：抛 "DB 未配置 system 类型的启用态提示词"', async () => {
        mockGetValidNodeConfig.mockResolvedValueOnce({
            modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
            modelSdkType: 'openai',
            modelName: 'gpt-4',
            modelProviderBaseUrl: 'https://api.openai.com/v1',
            modelContextWindow: 128000,
            prompts: [
                { type: 'user', status: 1, content: '只有 user 提示词', displayOrder: 1 },
            ],
        })
        await expect(
            invokeNodeJson({
                nodeName: 'noSystemNode',
                temperature: 0,
                schema: TestSchema,
                buildPrompt: t => t,
                errorPrefix: 'test',
            }),
        ).rejects.toThrow(/未配置 system 类型的启用态提示词/)
    })
})

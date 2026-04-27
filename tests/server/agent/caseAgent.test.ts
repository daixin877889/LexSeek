import { describe, it, expect, vi } from 'vitest'

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getSubagentConfigsService: vi.fn(),
}))
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(),
}))

// TODO(stage8): runCaseChat 已删除（小索走 case-main vertical → runtime.ts 标准管道）。
// 保留 describe.skip 作回归保护，后续阶段重写为针对 case-main vertical 的集成测试。
describe.skip('caseMainAgent (stage8: runCaseChat 已删，待重写为 vertical 集成测试)', () => {
    it('should export runCaseChat function', async () => {
        const mod = await import(
            '~~/server/services/workflow/agents/index'
        ) as any
        expect(typeof mod.runCaseChat).toBe('function')
    })

    it('should export getChatThreadState function', async () => {
        const { getChatThreadState } = await import(
            '~~/server/services/workflow/agents/index'
        )
        expect(typeof getChatThreadState).toBe('function')
    })
})

/**
 * agentSseStream - stripStaleInterrupt 单测
 *
 * 验证：仅当 run 处于 INTERRUPTED 时才透传 `__interrupt__`，其它任何状态下
 * 一律剥离，避免前端把陈旧 interrupt 误判为 awaiting。
 *
 * 背景：合同审查 resume 分支完全绕过 LangGraph，`parseAndAskStance` 工具的
 * `__interrupt__` 永远不会被 `__resume__` 抵消；前端无论从 checkpoint 拿
 * 终结 run 的快照还是 active run 的 fallback，都会误读到 stale interrupt。
 * 本助手在 SSE 边界做兜底剥离。
 */
import { describe, it, expect } from 'vitest'
import { stripStaleInterrupt } from '~~/server/services/sse/agentSseStream'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

describe('stripStaleInterrupt', () => {
    function makeBaseValues() {
        return {
            messages: [{ type: 'human', content: 'hi' }],
            __interrupt__: [
                {
                    value: { type: 'awaiting_stance', partyA: 'A', partyB: 'B' },
                    id: 'int-1',
                },
            ],
        }
    }

    it.each([
        AGENT_RUN_STATUS.COMPLETED,
        AGENT_RUN_STATUS.FAILED,
        AGENT_RUN_STATUS.CANCELLED,
        AGENT_RUN_STATUS.PENDING,
        AGENT_RUN_STATUS.RUNNING,
        undefined,
    ])('非 INTERRUPTED 状态 %s 应剥离 __interrupt__', (status) => {
        const values = makeBaseValues()
        const result = stripStaleInterrupt(values, status)
        expect('__interrupt__' in result).toBe(false)
        expect(result.messages).toEqual(values.messages)
    })

    it('INTERRUPTED 状态必须保留 __interrupt__（合法等待用户输入）', () => {
        const values = makeBaseValues()
        const result = stripStaleInterrupt(values, AGENT_RUN_STATUS.INTERRUPTED)
        expect(result.__interrupt__).toEqual(values.__interrupt__)
    })

    it('values 本来就没有 __interrupt__ 时直接返回原对象', () => {
        const noInterrupt = { messages: [], extra: 1 }
        const result = stripStaleInterrupt(noInterrupt, AGENT_RUN_STATUS.COMPLETED)
        expect(result).toBe(noInterrupt)
    })

    it('剥离不修改原对象（不可变更新，frozen 入参也能跑通）', () => {
        const values = Object.freeze(makeBaseValues())
        expect(() => stripStaleInterrupt(values, AGENT_RUN_STATUS.COMPLETED)).not.toThrow()
    })
})

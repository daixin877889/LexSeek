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

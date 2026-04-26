import { describe, it, expect } from 'vitest'
import { SessionScope, SessionType, SSECustomEventType, InterruptType } from '#shared/types/agentEvent'
import type { SSECustomEventMap } from '#shared/types/agentEvent'

describe('SessionScope', () => {
    it('包含 4 个 scope 值，对应 caseSessions.scope 列', () => {
        expect(SessionScope.CASE).toBe('case')
        expect(SessionScope.ASSISTANT).toBe('assistant')
        expect(SessionScope.DOCUMENT).toBe('document')
        expect(SessionScope.CONTRACT).toBe('contract')
    })

    it('SessionScope 值集合用于穷举校验', () => {
        const all = Object.values(SessionScope)
        expect(all).toHaveLength(4)
        expect(new Set(all).size).toBe(4)
    })
})

describe('SessionType', () => {
    it('包含 case 域三种类型（数字枚举）', () => {
        expect(SessionType.CHAT).toBe(1)
        expect(SessionType.ANALYSIS).toBe(2)
        expect(SessionType.MODULE).toBe(3)
    })
})

describe('SSECustomEventType', () => {
    it('覆盖现有所有自定义事件类型', () => {
        // 现有发布点：subAgentToolFactory / contractReviewStageEmitter / saveAnalysisResult.tool
        expect(SSECustomEventType.SUB_AGENT_TOKEN).toBe('sub_agent_token')
        expect(SSECustomEventType.SUB_AGENT_TOOL_START).toBe('sub_agent_tool_start')
        expect(SSECustomEventType.SUB_AGENT_TOOL_END).toBe('sub_agent_tool_end')
        expect(SSECustomEventType.SUB_AGENT_STATUS).toBe('sub_agent_status')
        expect(SSECustomEventType.ANALYSIS_RESULT_SAVED).toBe('analysis_result_saved')
        expect(SSECustomEventType.CONTRACT_STAGE).toBe('contract_stage')
        expect(SSECustomEventType.CONTRACT_RISK).toBe('contract_risk')
        expect(SSECustomEventType.CONTRACT_PROGRESS).toBe('contract_progress')
    })

    it('包含阶段 5/6 新增事件类型', () => {
        expect(SSECustomEventType.DRAFT_SAVED).toBe('draft_saved')
        expect(SSECustomEventType.CONTRACT_REVIEW_SAVED).toBe('contract_review_saved')
        expect(SSECustomEventType.CHILD_AGENT_INVOKED).toBe('child_agent_invoked')
    })
})

describe('SSECustomEventMap 类型契约', () => {
    it('类型仅在编译期校验，运行时仅做最小存在性校验', () => {
        // 编译期：SSECustomEventMap[type] 给出 payload 类型
        // 运行时：能够正常 import 即可
        const probe: keyof SSECustomEventMap = SSECustomEventType.DRAFT_SAVED
        expect(probe).toBe('draft_saved')
    })
})

describe('InterruptType', () => {
    it('覆盖所有现有 interrupt 类型', () => {
        // 沿用现有 server/services/workflow / 前端 interrupt handler 中的类型
        expect(InterruptType.INSUFFICIENT_POINTS).toBe('insufficient_points')
        expect(InterruptType.NEED_MEMBERSHIP).toBe('need_membership')
        expect(InterruptType.BASIC_INFO_CONFIRM).toBe('basic_info_confirm')
        expect(InterruptType.CASE_INFO_CHECK).toBe('case_info_check')
        expect(InterruptType.MODULE_SELECT).toBe('module_select')
        expect(InterruptType.CONTRACT_STANCE).toBe('contract_stance')
        expect(InterruptType.EXTRACT_CASE_INFO).toBe('extract_case_info')
    })
})

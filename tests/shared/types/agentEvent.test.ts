import { describe, it, expect } from 'vitest'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

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

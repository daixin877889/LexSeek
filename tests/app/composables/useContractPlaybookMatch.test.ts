import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useContractPlaybookMatch } from '~/composables/useContractPlaybookMatch'
import type { PlaybookSnapshot, Risk } from '#shared/types/contract'

const snapshot: PlaybookSnapshot = {
    contractType: '劳动合同',
    snapshotAt: '2026-04-22T00:00:00Z',
    points: [
        { code: 'probation', title: '试用期', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'c' },
        { code: 'overtime', title: '加班费', defaultLevel: 'medium', stancePreference: 'balanced', checkContent: 'c' },
        { code: 'compete', title: '竞业', defaultLevel: 'low', stancePreference: 'lenient', checkContent: 'c' },
    ],
}

const makeRisk = (id: string, code?: string): Risk => ({
    id,
    clauseIndex: 1,
    clauseText: 't',
    level: 'high',
    category: 'c',
    problem: 'p',
    analysis: 'a',
    risk: 'r',
    suggestion: 's',
    matchedPointCode: code,
})

describe('useContractPlaybookMatch', () => {
    it('snapshot=null 时 enabled=false 且三态为空', () => {
        const m = useContractPlaybookMatch(ref(null), ref([]))
        expect(m.enabled.value).toBe(false)
        expect(m.total.value).toBe(0)
        expect(m.hitCount.value).toBe(0)
        expect(m.hits.value).toEqual([])
        expect(m.misses.value).toEqual([])
        expect(m.extras.value).toEqual([])
    })

    it('命中计数 / 未命中 / 清单外三态派生正确', () => {
        const risks = [
            makeRisk('r1', 'probation'),
            makeRisk('r2', 'overtime'),
            makeRisk('r3', 'overtime'), // 重复命中同一条，hitCount 不重复计
            makeRisk('r4'), // 清单外（无 code）
            makeRisk('r5', 'nonexistent'), // 无效 code（客户端防御）
        ]
        const m = useContractPlaybookMatch(ref(snapshot), ref(risks))
        expect(m.enabled.value).toBe(true)
        expect(m.total.value).toBe(3)
        expect(m.hitCount.value).toBe(2)
        expect(m.hits.value).toHaveLength(2)
        expect(m.hits.value[0]!.point.code).toBe('probation') // 按快照顺序
        expect(m.hits.value[1]!.point.code).toBe('overtime')
        expect(m.misses.value).toHaveLength(1)
        expect(m.misses.value[0]!.code).toBe('compete')
        expect(m.extras.value).toHaveLength(2) // r4 + r5
    })

    it('响应式：snapshot / risks 变化时 computed 重算', () => {
        const snap = ref<PlaybookSnapshot | null>(null)
        const rs = ref<Risk[]>([])
        const m = useContractPlaybookMatch(snap, rs)
        expect(m.enabled.value).toBe(false)
        snap.value = snapshot
        rs.value = [makeRisk('r1', 'probation')]
        expect(m.enabled.value).toBe(true)
        expect(m.hitCount.value).toBe(1)
    })
})

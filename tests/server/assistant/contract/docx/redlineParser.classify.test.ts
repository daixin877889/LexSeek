import { describe, it, expect } from 'vitest'
import { classifyRedlineDecision, type RedlineRefEntry } from '~~/server/agents/contract/docx/redlineParser'
import { ClientRedlineDecision } from '#shared/types/contract'

const ref: RedlineRefEntry = { riskId: 1, delIds: [10], insId: 11, paraIdxs: [3] }

function run(opts: {
    surviveDel?: number[]; surviveIns?: number[]
    corpusT?: string; corpusDel?: string; corpusIns?: string
    old: string; neu: string
}) {
    return classifyRedlineDecision({
        ref,
        survivingDelIds: new Set(opts.surviveDel ?? []),
        survivingInsIds: new Set(opts.surviveIns ?? []),
        corpusT: opts.corpusT ?? '',
        corpusDel: opts.corpusDel ?? '',
        corpusIns: opts.corpusIns ?? '',
        problematicQuote: opts.old,
        suggestedClauseText: opts.neu,
        trustWordIds: true,
    })
}

describe('classifyRedlineDecision', () => {
    it('Layer 1：del+ins 都存活 → 未处理', () => {
        expect(run({ surviveDel: [10], surviveIns: [11], old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.UNTOUCHED)
    })
    it('Layer 1：部分存活（仅 del）→ 需确认', () => {
        expect(run({ surviveDel: [10], old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.AMBIGUOUS)
    })
    it('Layer 2：删除标记 + 插入标记都在 → 未处理（w:id 被重排）', () => {
        expect(run({ corpusDel: '甲方负全责', corpusIns: '双方按约担责', corpusT: '双方按约担责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.UNTOUCHED)
    })
    it('Layer 2：删除标记残留、插入已接受转正 → 接受（半接受状态）', () => {
        expect(run({ corpusDel: '甲方负全责', corpusIns: '', corpusT: '双方按约担责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('Layer 2：删除标记残留、插入已消但新文也不在 → 需确认', () => {
        expect(run({ corpusDel: '甲方负全责', corpusIns: '', corpusT: '甲方负全责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.AMBIGUOUS)
    })
    it('互不包含 · 全接受 → 接受', () => {
        expect(run({ corpusT: '双方按约担责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('互不包含 · 全拒绝 → 拒绝', () => {
        expect(run({ corpusT: '甲方负全责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.REJECTED)
    })
    it('new 含 old（扩写）· 全接受 → 接受', () => {
        expect(run({ corpusT: '违约责任及违约金20%', old: '违约责任', neu: '违约责任及违约金20%' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('new 含 old（扩写）· 全拒绝 → 拒绝', () => {
        expect(run({ corpusT: '违约责任', old: '违约责任', neu: '违约责任及违约金20%' }))
            .toBe(ClientRedlineDecision.REJECTED)
    })
    it('old 含 new（删减）· 全接受 → 接受', () => {
        expect(run({ corpusT: '违约责任', old: '违约责任及违约金20%', neu: '违约责任' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('old 含 new（删减）· 全拒绝 → 拒绝', () => {
        expect(run({ corpusT: '违约责任及违约金20%', old: '违约责任及违约金20%', neu: '违约责任' }))
            .toBe(ClientRedlineDecision.REJECTED)
    })
    it('正文都找不到 → 需确认', () => {
        expect(run({ corpusT: '完全无关的文字', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.AMBIGUOUS)
    })
})

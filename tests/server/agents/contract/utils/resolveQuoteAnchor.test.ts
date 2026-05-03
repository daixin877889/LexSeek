/**
 * resolveQuoteAnchor 单元测试（spec §5.3.2 / §10.1）
 *
 * 三档 fallback：
 *  - sentence_id 命中（单 ID / 多 ID 跨句 / 无效 ID 过滤）
 *  - fuzzy 命中（pattern.length > 32 / Match_Distance 长 text）
 *  - 全失败降级
 *
 * 重点：
 *  - matchSource 字段正确（'sentence_id' / 'fuzzy' / 'fallback'）
 *  - quote.length < 4 跳过 fuzzy
 *  - dmp 单例参数不被污染（间接验证 fuzzyLocateInText 的 try/finally）
 */
import { describe, it, expect } from 'vitest'
import { resolveQuoteAnchor } from '~~/server/agents/contract/utils/resolveQuoteAnchor'
import { splitSentences } from '~~/server/agents/contract/utils/splitSentences'

describe('resolveQuoteAnchor', () => {
    const clauseText = '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。乙方有权追讨。'
    const sentences = splitSentences(clauseText)

    describe('档 1：sentence_id 主路径', () => {
        it('单个 problemSentenceId → 切出对应句子', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [2], problematicQuote: undefined },
            })
            expect(r.matchSource).toBe('sentence_id')
            expect(r.problematicQuote).toBe(clauseText.slice(sentences[1]!.charStart, sentences[1]!.charEnd).trim())
            expect(r.charStart).toBe(sentences[1]!.charStart)
            expect(r.charEnd).toBe(sentences[1]!.charEnd)
        })

        it('多个 problemSentenceIds 跨句 → 取 [min, max] 区间', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [2, 3], problematicQuote: undefined },
            })
            expect(r.matchSource).toBe('sentence_id')
            expect(r.charStart).toBe(sentences[1]!.charStart)
            expect(r.charEnd).toBe(sentences[2]!.charEnd)
            expect(clauseText.slice(r.charStart!, r.charEnd!)).toContain('逾期支付的')
            expect(clauseText.slice(r.charStart!, r.charEnd!)).toContain('追讨')
        })

        it('无效 ID（超出范围）被过滤掉，剩余有效 ID 仍能命中', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [2, 99], problematicQuote: undefined },
            })
            expect(r.matchSource).toBe('sentence_id')
            expect(r.charStart).toBe(sentences[1]!.charStart)
            expect(r.charEnd).toBe(sentences[1]!.charEnd)
        })

        it('全部 ID 无效 → 进档 2', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [99, 100],
                    problematicQuote: '逾期支付的，每日按 0.05%',
                },
            })
            expect(r.matchSource).toBe('fuzzy')
        })

        it('LLM 给 0 / 负数 ID（非 1-based）→ 全部过滤，进档 2', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [0, -1],
                    problematicQuote: '逾期支付的，每日按 0.05%',
                },
            })
            expect(r.matchSource).toBe('fuzzy')
        })
    })

    describe('档 2：fuzzy fallback', () => {
        it('无 problemSentenceIds 但有 problematicQuote → 走 fuzzy', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [],
                    problematicQuote: '逾期支付的，每日按 0.05%',
                },
            })
            expect(r.matchSource).toBe('fuzzy')
            expect(r.charStart).not.toBeNull()
            expect(r.charEnd).not.toBeNull()
            expect(clauseText.slice(r.charStart!, r.charEnd!)).toContain('逾期支付')
        })

        it('quote.length < 4 → 跳过 fuzzy 直接降级', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [],
                    problematicQuote: '过低', // 仅 2 字符
                },
            })
            expect(r.matchSource).toBe('fallback')
        })

        it('quote 在 clauseText 里完全找不到（不相似）→ 进档 3', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {
                    problemSentenceIds: [],
                    problematicQuote: 'XYZQRSTABCDEFG 完全不存在的句子',
                },
            })
            expect(r.matchSource).toBe('fallback')
        })

        it('长 quote（>32 字符）走前 32 字符 anchor，仍能命中', () => {
            const longClauseText = '导入。' + '工资按月底前最后一个工作日结算并通过银行转账方式支付到员工指定账户。' + '尾部其他内容。'
            const longSents = splitSentences(longClauseText)
            const longQuote = '工资按月底前最后一个工作日结算并通过银行转账方式支付到员工指定账户'
            expect(longQuote.length).toBeGreaterThan(32)

            const r = resolveQuoteAnchor({
                clauseText: longClauseText,
                sentences: longSents,
                aiOutput: { problemSentenceIds: [], problematicQuote: longQuote },
            })
            expect(r.matchSource).toBe('fuzzy')
            expect(r.charStart).not.toBeNull()
        })
    })

    describe('档 3：全失败降级', () => {
        it('无 IDs / 无 quote → fallback', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: { problemSentenceIds: [], problematicQuote: undefined },
            })
            expect(r).toEqual({
                problematicQuote: null,
                charStart: null,
                charEnd: null,
                matchSource: 'fallback',
            })
        })

        it('aiOutput 完全是 default 值（LLM 返了 risk 但没填 quote 字段）', () => {
            const r = resolveQuoteAnchor({
                clauseText,
                sentences,
                aiOutput: {},
            })
            expect(r.matchSource).toBe('fallback')
            expect(r.problematicQuote).toBeNull()
        })
    })

    describe('返回值约束', () => {
        it('matchSource=sentence_id 时 problematicQuote 是 trim 过的 slice（含末尾切分标点）', () => {
            const seg = '  工资按月支付。   逾期违约。  '
            const sents = splitSentences(seg)
            const r = resolveQuoteAnchor({
                clauseText: seg,
                sentences: sents,
                aiOutput: { problemSentenceIds: [1] },
            })
            // problematicQuote 必须 = clauseText.slice(charStart, charEnd).trim()
            // PR4 前端字符级高亮按 charStart/End 取字符串，必须与 problematicQuote 严格一致
            expect(r.problematicQuote).toBe(seg.slice(sents[0]!.charStart, sents[0]!.charEnd).trim())
        })
    })
})

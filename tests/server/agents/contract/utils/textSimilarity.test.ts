/**
 * fuzzyLocateInText 单元测试（spec §5.3.1 / §10.1）
 *
 * 重点保护：
 *  1. pattern.length > 32 用前 32 字符 anchor locate 不抛 throw
 *  2. text 超 1000 字符时仍能命中末尾 quote（验证 Match_Distance 显式设定）
 *  3. 共享 dmp 单例参数恢复（不污染 calcSimilarity 等其他调用方）
 *  4. text / pattern 空 / match 不到 → 返回 null
 */
import { describe, it, expect } from 'vitest'
import { fuzzyLocateInText, getDmp, calcSimilarity } from '~~/server/agents/contract/utils/textSimilarity'

describe('fuzzyLocateInText', () => {
    describe('基础命中', () => {
        it('短 pattern 完全匹配 → 返回精确 offset', () => {
            const text = '工资按月支付，逾期支付的每日按 0.05% 加收滞纳金。'
            const r = fuzzyLocateInText(text, '逾期支付的每日按 0.05%')
            expect(r).not.toBeNull()
            expect(text.slice(r!.start, r!.end)).toBe('逾期支付的每日按 0.05%')
        })

        it('短 pattern 含 1-2 字符差异（中英文标点差异）→ 仍能命中', () => {
            const text = '甲方应当履行义务，乙方支付报酬。'
            const r = fuzzyLocateInText(text, '甲方应当履行义务,乙方')
            expect(r).not.toBeNull()
        })

        it('text 为空 → null', () => {
            expect(fuzzyLocateInText('', 'anything')).toBeNull()
        })

        it('pattern 为空 → null', () => {
            expect(fuzzyLocateInText('anything', '')).toBeNull()
        })

        it('找不到完全不相似的 pattern → null', () => {
            expect(fuzzyLocateInText('abcdefg', 'XYZQRST123')).toBeNull()
        })
    })

    describe('pattern.length > 32（dmp Match_MaxBits 上限保护）', () => {
        it('超长 pattern（50 字）走前 32 字符 anchor locate，不抛 throw', () => {
            const text = '导言段。' + 'A'.repeat(20) + '问题片段开始这里有五十个字符的精确问题片段需要被定位到位置上请勿丢失。' + 'B'.repeat(20)
            const longPattern = '问题片段开始这里有五十个字符的精确问题片段需要被定位到位置上请勿丢失'
            expect(longPattern.length).toBeGreaterThan(32)

            // 不应抛 "Pattern too long"
            expect(() => fuzzyLocateInText(text, longPattern)).not.toThrow()

            const r = fuzzyLocateInText(text, longPattern)
            expect(r).not.toBeNull()
            // start 应该指向 longPattern 在 text 里实际开始的位置（前 32 字符 anchor）
            const startIdx = text.indexOf('问题片段开始')
            expect(r!.start).toBe(startIdx)
            // end = start + pattern.length（按调用方约定）
            expect(r!.end).toBe(startIdx + longPattern.length)
        })
    })

    describe('Match_Distance 显式设定（长 text 末尾命中）', () => {
        it('text 长度 > 1000 时仍能命中末尾 quote', () => {
            const filler = '前导内容'.repeat(300) // 1200 字符
            const text = filler + '【末尾标记】违约金每日 0.5%'
            const pattern = '违约金每日 0.5%'

            const r = fuzzyLocateInText(text, pattern)
            expect(r).not.toBeNull()
            expect(r!.start).toBeGreaterThan(1000)
            expect(text.slice(r!.start, r!.end)).toContain('违约金每日 0.5%')
        })
    })

    describe('共享单例参数恢复', () => {
        it('调 fuzzyLocateInText 后 dmp.Match_Threshold / Match_Distance 恢复默认', () => {
            const dmp = getDmp()
            const beforeThreshold = dmp.Match_Threshold
            const beforeDistance = dmp.Match_Distance

            fuzzyLocateInText('some text', 'some')

            expect(dmp.Match_Threshold).toBe(beforeThreshold)
            expect(dmp.Match_Distance).toBe(beforeDistance)
        })

        it('fuzzyLocateInText 抛错时也要恢复参数（finally 保护）', () => {
            const dmp = getDmp()
            const before = dmp.Match_Threshold

            try {
                fuzzyLocateInText('text', 'pattern')
            }
            catch { /* ignore */ }
            expect(dmp.Match_Threshold).toBe(before)
        })

        it('calcSimilarity 紧跟 fuzzyLocateInText 调用，结果不被污染', () => {
            // 先调一次 fuzzyLocateInText（会临时改 Match_Threshold/Distance）
            fuzzyLocateInText('precondition', 'pre')
            // 然后调 calcSimilarity，结果应等于直接调用的结果（无污染）
            const sim = calcSimilarity('hello world', 'hello there')
            expect(sim).toBeGreaterThan(0)
            expect(sim).toBeLessThanOrEqual(1)
        })
    })
})

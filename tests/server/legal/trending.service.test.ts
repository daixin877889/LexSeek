/**
 * 法律法规检索热门词 service 单元测试
 */

import { describe, it, expect } from 'vitest'
import { normalizeKeywordService } from '~~/server/services/legal/trending.service'

describe('normalizeKeywordService', () => {
    it('去除首尾空白并合并连续空格', () => {
        expect(normalizeKeywordService('  民法典   合同   ')).toBe('民法典 合同')
    })

    it('长度 < 2 返回 null', () => {
        expect(normalizeKeywordService('a')).toBeNull()
        expect(normalizeKeywordService(' ')).toBeNull()
        expect(normalizeKeywordService('')).toBeNull()
    })

    it('长度 > 50 返回 null', () => {
        expect(normalizeKeywordService('民'.repeat(51))).toBeNull()
    })

    it('纯标点 / 纯空白返回 null', () => {
        expect(normalizeKeywordService('!!!???')).toBeNull()
        expect(normalizeKeywordService(',，。 ')).toBeNull()
    })

    it('混合中文 + 字母数字正常返回', () => {
        expect(normalizeKeywordService('民法典 2026')).toBe('民法典 2026')
        expect(normalizeKeywordService('Labor Law')).toBe('Labor Law')
    })
})

/**
 * wordCommentRef 工具单元测试
 *
 * 覆盖目标：90%+ 行覆盖率（纯函数无 DB / 无网络依赖）
 *
 * 测试范围：
 * - generateWordCommentRef：格式 / rand8 唯一性
 * - extractRandomFromRef：空值 / 错误格式 / 正常格式
 * - buildAuthorField：人名 trim / 空值兜底
 * - stripAuthorRef：完整 LS:xxx [#a-b-c] 剥离 / 仅含 LS: 前缀的客户自定义保留
 * - stripLeadingLsPrefix：强制剥 LS: 前缀
 * - isWordCommentRef：合法格式 vs 非法
 * - parseWordCommentRef：DB 格式解析 + 错误处理
 * - parseCommentRef：Phase C+ author 格式（含 reviewId） / 老格式拒识 / 尾部空白容忍
 *
 * **Validates: 阶段 8 测试覆盖率提升**
 */

import { describe, it, expect } from 'vitest'
import {
    generateWordCommentRef,
    extractRandomFromRef,
    buildAuthorField,
    stripAuthorRef,
    stripLeadingLsPrefix,
    isWordCommentRef,
    parseWordCommentRef,
    parseCommentRef,
} from '~~/server/agents/contract/utils/wordCommentRef'

describe('wordCommentRef 工具', () => {
    describe('generateWordCommentRef', () => {
        it('格式应为 LEXSEEK-{annotationId}-{rand8}', () => {
            const ref = generateWordCommentRef(123)
            expect(ref).toMatch(/^LEXSEEK-123-[a-zA-Z0-9]{8}$/)
        })

        it('同一 annotationId 多次调用产生不同 rand8', () => {
            const refs = new Set<string>()
            for (let i = 0; i < 50; i++) {
                refs.add(generateWordCommentRef(42))
            }
            // 50 次几乎不可能碰撞
            expect(refs.size).toBeGreaterThan(45)
        })

        it('支持大 annotationId', () => {
            const ref = generateWordCommentRef(99999999)
            expect(ref.startsWith('LEXSEEK-99999999-')).toBe(true)
        })
    })

    describe('extractRandomFromRef', () => {
        it('从合法 ref 提取 rand8', () => {
            expect(extractRandomFromRef('LEXSEEK-101-abcdEF12')).toBe('abcdEF12')
        })

        it('null / undefined / 空串 → null', () => {
            expect(extractRandomFromRef(null)).toBeNull()
            expect(extractRandomFromRef(undefined)).toBeNull()
            expect(extractRandomFromRef('')).toBeNull()
        })

        it('非法格式 → null', () => {
            expect(extractRandomFromRef('FAKE-101-abc')).toBeNull()
            expect(extractRandomFromRef('LEXSEEK-101')).toBeNull()
            expect(extractRandomFromRef('LEXSEEK-101-toolong123')).toBeNull()
        })
    })

    describe('buildAuthorField', () => {
        it('正常人名前加 LS: 前缀', () => {
            expect(buildAuthorField('AI', 100, 'LEXSEEK-101-abc12345')).toBe('LS:AI')
            expect(buildAuthorField('张律师', 200, 'LEXSEEK-202-def67890')).toBe('LS:张律师')
        })

        it('空名字兜底 AI', () => {
            expect(buildAuthorField('', 100, 'ref')).toBe('LS:AI')
            expect(buildAuthorField('   ', 100, 'ref')).toBe('LS:AI')
        })

        it('null/undefined 名字兜底 AI', () => {
            expect(buildAuthorField(null as unknown as string, 100, 'ref')).toBe('LS:AI')
            expect(buildAuthorField(undefined as unknown as string, 100, 'ref')).toBe('LS:AI')
        })

        it('两侧空白被 trim', () => {
            expect(buildAuthorField('  律师  ', 100, 'ref')).toBe('LS:律师')
        })
    })

    describe('stripAuthorRef', () => {
        it('系统格式 LS:AI [#1-2-abc12345] → AI', () => {
            expect(stripAuthorRef('LS:AI [#1-2-abc12345]')).toBe('AI')
        })

        it('系统格式带尾部空白 → 名字', () => {
            expect(stripAuthorRef('LS:律师 [#10-20-aBcD1234]   ')).toBe('律师')
            expect(stripAuthorRef('LS:律师 [#10-20-aBcD1234] ​')).toBe('律师')
        })

        it('客户自定义 LS: 前缀但无系统标识 → 保留 LS:', () => {
            expect(stripAuthorRef('LS:张')).toBe('LS:张')
        })

        it('普通客户 author → 原样返回', () => {
            expect(stripAuthorRef('客户A')).toBe('客户A')
        })

        it('null/undefined/empty → 空串', () => {
            expect(stripAuthorRef(null)).toBe('')
            expect(stripAuthorRef(undefined)).toBe('')
            expect(stripAuthorRef('')).toBe('')
        })
    })

    describe('stripLeadingLsPrefix', () => {
        it('剥 LS: 前缀', () => {
            expect(stripLeadingLsPrefix('LS:AI')).toBe('AI')
            expect(stripLeadingLsPrefix('LS:张律师')).toBe('张律师')
        })

        it('无 LS: 前缀 → 原样', () => {
            expect(stripLeadingLsPrefix('AI')).toBe('AI')
        })

        it('null/undefined/empty → 空串', () => {
            expect(stripLeadingLsPrefix(null)).toBe('')
            expect(stripLeadingLsPrefix(undefined)).toBe('')
            expect(stripLeadingLsPrefix('')).toBe('')
        })
    })

    describe('isWordCommentRef', () => {
        it('合法 ref → true', () => {
            expect(isWordCommentRef('LEXSEEK-101-aBcD1234')).toBe(true)
        })

        it('错误格式 → false', () => {
            expect(isWordCommentRef('LEXSEEK-101')).toBe(false)
            expect(isWordCommentRef('FAKE-101-abc12345')).toBe(false)
            expect(isWordCommentRef('LEXSEEK-101-tooshort')).toBe(true) // 'tooshort' 是 8 字符
            expect(isWordCommentRef('LEXSEEK-101-tooshorts')).toBe(false) // 9 字符
        })

        it('null/undefined/empty → false', () => {
            expect(isWordCommentRef(null)).toBe(false)
            expect(isWordCommentRef(undefined)).toBe(false)
            expect(isWordCommentRef('')).toBe(false)
        })
    })

    describe('parseWordCommentRef', () => {
        it('合法 ref 提取 annotationId', () => {
            expect(parseWordCommentRef('LEXSEEK-101-abcd1234')).toEqual({ annotationId: 101 })
        })

        it('错误格式 → null', () => {
            expect(parseWordCommentRef('FAKE-101-xx')).toBeNull()
            expect(parseWordCommentRef('LEXSEEK-101')).toBeNull()
        })

        it('null/undefined/empty → null', () => {
            expect(parseWordCommentRef(null)).toBeNull()
            expect(parseWordCommentRef(undefined)).toBeNull()
            expect(parseWordCommentRef('')).toBeNull()
        })
    })

    describe('parseCommentRef', () => {
        it('Phase C+ 格式 LS:xxx [#reviewId-annotationId-rand8] 解析成功', () => {
            const r = parseCommentRef('LS:AI [#100-200-abcd1234]', null)
            expect(r).toEqual({ reviewId: 100, annotationId: 200, source: 'author' })
        })

        it('尾部含空白/NBSP/零宽 → 仍解析成功', () => {
            expect(parseCommentRef('LS:AI [#1-2-abcd1234]   ', null)).toEqual({
                reviewId: 1, annotationId: 2, source: 'author',
            })
            expect(parseCommentRef('LS:AI [#1-2-abcd1234] ​', null)).toEqual({
                reviewId: 1, annotationId: 2, source: 'author',
            })
        })

        it('老 Phase C 格式（无 reviewId）拒识 → null', () => {
            // 老格式：[#annotationId-rand8]，只有 2 段
            expect(parseCommentRef('LS:AI [#101-abcd1234]', null)).toBeNull()
        })

        it('initials 完全不参与识别（即使含 LEXSEEK 字面量也忽略）', () => {
            // author 格式不对就拒识，无论 initials 多匹配
            expect(parseCommentRef('普通用户', 'LEXSEEK-101-abcd1234')).toBeNull()
        })

        it('null/undefined author → null', () => {
            expect(parseCommentRef(null, null)).toBeNull()
            expect(parseCommentRef(undefined, undefined)).toBeNull()
            expect(parseCommentRef('', null)).toBeNull()
        })
    })
})

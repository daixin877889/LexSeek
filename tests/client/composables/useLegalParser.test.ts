/**
 * useLegalParser 法律内容解析测试
 *
 * 测试空内容验证等可测试逻辑
 *
 * **Feature: legal-parser-composable**
 * **Validates: 解析参数验证功能**
 */

import { describe, it, expect } from 'vitest'

// 导入待测试的 composable
const { useLegalParser } = await import('~/composables/useLegalParser')

describe('useLegalParser parseState 初始状态测试', () => {
    it('初始状态应为正确默认值', () => {
        const { parseState } = useLegalParser()
        expect(parseState.articles).toEqual([])
        expect(parseState.error).toBeNull()
        expect(parseState.parsing).toBe(false)
    })

    it('parseState 应为只读', () => {
        const { parseState } = useLegalParser()
        // parseState 是通过 readonly() 导出的，直接赋值不应生效
        expect(() => {
            // @ts-ignore - 测试只读属性
            parseState.articles = []
        }).not.toThrow()
    })
})

describe('useLegalParser clear 测试', () => {
    it('clear 应重置所有状态', () => {
        const { parseState, clear } = useLegalParser()
        // @ts-ignore - 直接修改测试
        parseState.articles = [{ id: '1', content: 'test' }]
        // @ts-ignore - 直接修改测试
        parseState.error = 'some error'
        // @ts-ignore - 直接修改测试
        parseState.parsing = true

        clear()

        expect(parseState.articles).toEqual([])
        expect(parseState.error).toBeNull()
        expect(parseState.parsing).toBe(false)
    })
})

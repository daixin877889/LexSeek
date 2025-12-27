/**
 * 工具函数测试
 *
 * 测试 cn 函数（tailwind-merge + clsx 组合）
 *
 * **Feature: utils**
 * **Validates: Requirements 6.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { cn } from '../../../app/lib/utils'

describe('cn 函数 - 基础功能', () => {
    it('单个类名应原样返回', () => {
        expect(cn('text-red-500')).toBe('text-red-500')
    })

    it('多个类名应合并', () => {
        expect(cn('text-red-500', 'bg-blue-500')).toBe('text-red-500 bg-blue-500')
    })

    it('空字符串应被过滤', () => {
        expect(cn('text-red-500', '', 'bg-blue-500')).toBe('text-red-500 bg-blue-500')
    })

    it('undefined 应被过滤', () => {
        expect(cn('text-red-500', undefined, 'bg-blue-500')).toBe('text-red-500 bg-blue-500')
    })

    it('null 应被过滤', () => {
        expect(cn('text-red-500', null, 'bg-blue-500')).toBe('text-red-500 bg-blue-500')
    })

    it('false 应被过滤', () => {
        expect(cn('text-red-500', false, 'bg-blue-500')).toBe('text-red-500 bg-blue-500')
    })

    it('无参数应返回空字符串', () => {
        expect(cn()).toBe('')
    })
})

describe('cn 函数 - Tailwind 类名合并', () => {
    it('相同属性的类名应合并（后者覆盖前者）', () => {
        expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
    })

    it('padding 类名应合并', () => {
        expect(cn('p-4', 'p-8')).toBe('p-8')
    })

    it('margin 类名应合并', () => {
        expect(cn('m-2', 'm-4')).toBe('m-4')
    })

    it('不同属性的类名应保留', () => {
        expect(cn('text-red-500', 'p-4', 'bg-blue-500')).toBe('text-red-500 p-4 bg-blue-500')
    })

    it('flex 相关类名应正确合并', () => {
        expect(cn('flex', 'flex-col', 'items-center')).toBe('flex flex-col items-center')
    })

    it('响应式类名应保留', () => {
        expect(cn('md:text-lg', 'lg:text-xl')).toBe('md:text-lg lg:text-xl')
    })

    it('hover 状态类名应保留', () => {
        expect(cn('hover:bg-red-500', 'hover:text-white')).toBe('hover:bg-red-500 hover:text-white')
    })
})

describe('cn 函数 - 条件类名', () => {
    it('条件为 true 时应包含类名', () => {
        const isActive = true
        expect(cn('base-class', isActive && 'active-class')).toBe('base-class active-class')
    })

    it('条件为 false 时应排除类名', () => {
        const isActive = false
        expect(cn('base-class', isActive && 'active-class')).toBe('base-class')
    })

    it('三元表达式应正确处理', () => {
        const variant = 'primary'
        expect(cn(
            'base',
            variant === 'primary' ? 'bg-blue-500' : 'bg-gray-500'
        )).toBe('base bg-blue-500')
    })
})

describe('cn 函数 - 对象语法', () => {
    it('对象语法应正确处理', () => {
        expect(cn({
            'text-red-500': true,
            'bg-blue-500': true,
            'hidden': false,
        })).toBe('text-red-500 bg-blue-500')
    })

    it('混合字符串和对象应正确处理', () => {
        expect(cn(
            'base-class',
            { 'active': true, 'disabled': false }
        )).toBe('base-class active')
    })
})

describe('cn 函数 - 数组语法', () => {
    it('数组语法应正确处理', () => {
        expect(cn(['text-red-500', 'bg-blue-500'])).toBe('text-red-500 bg-blue-500')
    })

    it('嵌套数组应正确处理', () => {
        expect(cn(['text-red-500', ['bg-blue-500', 'p-4']])).toBe('text-red-500 bg-blue-500 p-4')
    })
})

describe('cn 函数 - 属性测试', () => {
    it('Property: 任意有效类名组合应返回字符串', () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(
                    'text-red-500', 'bg-blue-500', 'p-4', 'm-2',
                    'flex', 'hidden', 'block', 'inline',
                    'w-full', 'h-auto', 'rounded', 'shadow'
                ), { minLength: 0, maxLength: 5 }),
                (classes) => {
                    const result = cn(...classes)
                    expect(typeof result).toBe('string')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property: 相同类名重复应只保留一个', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('p-4', 'm-2', 'text-lg', 'bg-red-500'),
                (className) => {
                    const result = cn(className, className, className)
                    // 结果中不应有重复的类名
                    const classes = result.split(' ')
                    const uniqueClasses = [...new Set(classes)]
                    expect(classes.length).toBe(uniqueClasses.length)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('Property: 冲突的 Tailwind 类名应合并', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('p-1', 'p-2', 'p-4', 'p-8'),
                fc.constantFrom('p-1', 'p-2', 'p-4', 'p-8'),
                (class1, class2) => {
                    const result = cn(class1, class2)
                    // 结果应只包含一个 padding 类
                    const paddingClasses = result.split(' ').filter(c => c.startsWith('p-'))
                    expect(paddingClasses.length).toBe(1)
                    // 应该是后面的类名
                    expect(paddingClasses[0]).toBe(class2)
                }
            ),
            { numRuns: 50 }
        )
    })
})

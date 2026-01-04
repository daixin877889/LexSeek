/**
 * 法律条文层级排序算法测试
 *
 * 使用 vitest 进行单元测试，验证排序算法的正确性
 *
 * **Feature: legal-article-hierarchy-sorting**
 * **Validates: Requirements 1-12**
 */

import { describe, it, expect } from 'vitest'
import {
    getParentPath,
    getNodePath,
    sortArticlesByHierarchy,
} from '../../../server/services/legal/articleSorting.service'

describe('法律条文层级排序算法', () => {
    describe('getParentPath', () => {
        it('非层级类型应返回空字符串', () => {
            expect(getParentPath({ id: '1', type: 'notice', order: 1 })).toBe('')
            expect(getParentPath({ id: '2', type: 'header', order: 1 })).toBe('')
            expect(getParentPath({ id: '3', type: 'footer', order: 1 })).toBe('')
            expect(getParentPath({ id: '4', type: 'annex', order: 1 })).toBe('')
        })

        it('l1 应返回空字符串', () => {
            expect(getParentPath({ id: '1', type: 'l1', l1: '第一编', order: 1 })).toBe('')
        })

        it('l2 应返回 l1', () => {
            expect(
                getParentPath({ id: '1', type: 'l2', l1: '第一编', l2: '第一分编', order: 1 })
            ).toBe('第一编')
        })

        it('l3 应返回 l1/l2', () => {
            expect(
                getParentPath({
                    id: '1',
                    type: 'l3',
                    l1: '第一编',
                    l2: '第一分编',
                    l3: '第一章',
                    order: 1,
                })
            ).toBe('第一编/第一分编')
        })

        it('l3 跳级应返回 l1', () => {
            expect(
                getParentPath({
                    id: '1',
                    type: 'l3',
                    l1: '第一编',
                    l2: null,
                    l3: '第一章',
                    order: 1,
                })
            ).toBe('第一编')
        })

        it('l4 应返回 l1/l2/l3', () => {
            expect(
                getParentPath({
                    id: '1',
                    type: 'l4',
                    l1: '第一编',
                    l2: '第一分编',
                    l3: '第一章',
                    l4: '第一节',
                    order: 1,
                })
            ).toBe('第一编/第一分编/第一章')
        })

        it('l5 应返回 l1/l2/l3/l4', () => {
            expect(
                getParentPath({
                    id: '1',
                    type: 'l5',
                    l1: '第一编',
                    l2: '第一分编',
                    l3: '第一章',
                    l4: '第一节',
                    l5: '第一条',
                    order: 1,
                })
            ).toBe('第一编/第一分编/第一章/第一节')
        })

        it('l5 跳级应返回 l1/l2/l3', () => {
            expect(
                getParentPath({
                    id: '1',
                    type: 'l5',
                    l1: '第一编',
                    l2: '第一分编',
                    l3: '第一章',
                    l4: null,
                    l5: '第一条',
                    order: 1,
                })
            ).toBe('第一编/第一分编/第一章')
        })
    })

    describe('getNodePath', () => {
        it('非层级类型应使用 __type__id 格式', () => {
            expect(getNodePath({ id: 'abc123', type: 'notice', order: 1 })).toBe(
                '__notice__abc123'
            )
            expect(getNodePath({ id: 'def456', type: 'header', order: 1 })).toBe(
                '__header__def456'
            )
        })

        it('l1 应返回 l1', () => {
            expect(getNodePath({ id: '1', type: 'l1', l1: '第一编', order: 1 })).toBe('第一编')
        })

        it('l2 应返回 l1/l2', () => {
            expect(
                getNodePath({ id: '1', type: 'l2', l1: '第一编', l2: '第一分编', order: 1 })
            ).toBe('第一编/第一分编')
        })

        it('l3 应返回 l1/l2/l3', () => {
            expect(
                getNodePath({
                    id: '1',
                    type: 'l3',
                    l1: '第一编',
                    l2: '第一分编',
                    l3: '第一章',
                    order: 1,
                })
            ).toBe('第一编/第一分编/第一章')
        })

        it('l3 跳级应返回 l1/l3', () => {
            expect(
                getNodePath({
                    id: '1',
                    type: 'l3',
                    l1: '第一编',
                    l2: null,
                    l3: '第一章',
                    order: 1,
                })
            ).toBe('第一编/第一章')
        })
    })

    describe('sortArticlesByHierarchy', () => {
        it('应处理空输入', () => {
            expect(sortArticlesByHierarchy([])).toEqual([])
        })

        it('应按 order 排序非层级类型', () => {
            const articles = [
                { id: '3', type: 'footer', order: 3 },
                { id: '1', type: 'notice', order: 1 },
                { id: '2', type: 'header', order: 2 },
            ]
            const sorted = sortArticlesByHierarchy(articles)
            expect(sorted.map(a => a.id)).toEqual(['1', '2', '3'])
        })

        it('应正确排序正常层级结构', () => {
            const articles = [
                { id: '5', type: 'l3', l1: '第一编', l2: '第一分编', l3: '第二章', order: 2 },
                { id: '4', type: 'l3', l1: '第一编', l2: '第一分编', l3: '第一章', order: 1 },
                { id: '3', type: 'l2', l1: '第一编', l2: '第一分编', order: 1 },
                { id: '2', type: 'l1', l1: '第一编', order: 2 },
                { id: '1', type: 'notice', order: 1 },
            ]
            const sorted = sortArticlesByHierarchy(articles)
            expect(sorted.map(a => a.id)).toEqual(['1', '2', '3', '4', '5'])
        })

        it('应正确处理跳级结构', () => {
            const articles = [
                {
                    id: '3',
                    type: 'l5',
                    l1: '第一编',
                    l2: null,
                    l3: '第一章',
                    l4: null,
                    l5: '第一条',
                    order: 1,
                },
                { id: '2', type: 'l3', l1: '第一编', l2: null, l3: '第一章', order: 1 },
                { id: '1', type: 'l1', l1: '第一编', order: 1 },
            ]
            const sorted = sortArticlesByHierarchy(articles)
            expect(sorted.map(a => a.id)).toEqual(['1', '2', '3'])
        })

        it('应正确处理混合类型', () => {
            const articles = [
                { id: '5', type: 'footer', order: 5 },
                {
                    id: '4',
                    type: 'l5',
                    l1: null,
                    l2: null,
                    l3: '第一章',
                    l4: null,
                    l5: '第一条',
                    order: 1,
                },
                { id: '3', type: 'l3', l1: null, l2: null, l3: '第一章', order: 3 },
                { id: '2', type: 'header', order: 2 },
                { id: '1', type: 'notice', order: 1 },
            ]
            const sorted = sortArticlesByHierarchy(articles)
            // 顶层节点按 order 排序：notice(1), header(2), l3(3), footer(5)
            // l5 是 l3 的子节点，紧跟 l3
            expect(sorted.map(a => a.id)).toEqual(['1', '2', '3', '4', '5'])
        })

        it('应跳过无效条文', () => {
            const articles = [
                { id: '1', type: 'notice', order: 1 },
                { id: null, type: 'header', order: 2 } as any, // 缺少 id
                { id: '3', type: 'invalid', order: 3 } as any, // 无效类型
                { id: '4', type: 'l1', l1: '第一编', order: 4 },
            ]
            const sorted = sortArticlesByHierarchy(articles)
            expect(sorted.map(a => a.id)).toEqual(['1', '4'])
        })

        it('应将 null order 视为 0', () => {
            const articles = [
                { id: '2', type: 'notice', order: 1 },
                { id: '1', type: 'header', order: null },
            ]
            const sorted = sortArticlesByHierarchy(articles)
            expect(sorted.map(a => a.id)).toEqual(['1', '2'])
        })
    })
})

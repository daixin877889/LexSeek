/**
 * 法律条文层级排序算法集成测试
 *
 * 测试排序算法与 DAO 层的集成
 *
 * **Feature: legal-article-hierarchy-sorting**
 * **Validates: Requirements 10.1, 10.2, 10.3**
 */

import { describe, it, expect } from 'vitest'
import { sortArticlesByHierarchy } from '../../../server/services/legal/articleSorting.service'

describe('法律条文层级排序算法集成测试', () => {
    it('应正确处理复杂的真实场景', () => {
        // 模拟一个复杂的法律文档结构
        const articles = [
            // 通知
            { id: '1', type: 'notice', order: 1, content: '关于发布本法的通知' },

            // 正文头部
            { id: '2', type: 'header', order: 2, content: '中华人民共和国民法典' },

            // 第一编
            { id: '3', type: 'l1', l1: '第一编 总则', order: 3 },

            // 第一编 - 第一章
            {
                id: '4',
                type: 'l3',
                l1: '第一编 总则',
                l2: null,
                l3: '第一章 基本规定',
                order: 1,
            },

            // 第一编 - 第一章 - 第一条
            {
                id: '5',
                type: 'l5',
                l1: '第一编 总则',
                l2: null,
                l3: '第一章 基本规定',
                l4: null,
                l5: '第一条',
                order: 1,
                content: '为了保护民事主体的合法权益...',
            },

            // 第一编 - 第一章 - 第二条
            {
                id: '6',
                type: 'l5',
                l1: '第一编 总则',
                l2: null,
                l3: '第一章 基本规定',
                l4: null,
                l5: '第二条',
                order: 2,
                content: '民法调整平等主体的自然人...',
            },

            // 第一编 - 第二章
            {
                id: '7',
                type: 'l3',
                l1: '第一编 总则',
                l2: null,
                l3: '第二章 自然人',
                order: 2,
            },

            // 第一编 - 第二章 - 第一节
            {
                id: '8',
                type: 'l4',
                l1: '第一编 总则',
                l2: null,
                l3: '第二章 自然人',
                l4: '第一节 民事权利能力和民事行为能力',
                order: 1,
            },

            // 第一编 - 第二章 - 第一节 - 第三条
            {
                id: '9',
                type: 'l5',
                l1: '第一编 总则',
                l2: null,
                l3: '第二章 自然人',
                l4: '第一节 民事权利能力和民事行为能力',
                l5: '第三条',
                order: 3,
                content: '自然人从出生时起到死亡时止...',
            },

            // 第二编
            { id: '10', type: 'l1', l1: '第二编 物权', order: 4 },

            // 第二编 - 第一分编
            {
                id: '11',
                type: 'l2',
                l1: '第二编 物权',
                l2: '第一分编 通则',
                order: 1,
            },

            // 第二编 - 第一分编 - 第一章
            {
                id: '12',
                type: 'l3',
                l1: '第二编 物权',
                l2: '第一分编 通则',
                l3: '第一章 一般规定',
                order: 1,
            },

            // 正文尾部
            { id: '13', type: 'footer', order: 5, content: '本法自2021年1月1日起施行' },

            // 附件
            { id: '14', type: 'annex', order: 6, content: '附件：相关法律条文对照表' },
        ]

        const sorted = sortArticlesByHierarchy(articles)

        // 验证排序结果
        const expectedOrder = [
            '1', // notice
            '2', // header
            '3', // 第一编
            '4', // 第一编 - 第一章
            '5', // 第一编 - 第一章 - 第一条
            '6', // 第一编 - 第一章 - 第二条
            '7', // 第一编 - 第二章
            '8', // 第一编 - 第二章 - 第一节
            '9', // 第一编 - 第二章 - 第一节 - 第三条
            '10', // 第二编
            '11', // 第二编 - 第一分编
            '12', // 第二编 - 第一分编 - 第一章
            '13', // footer
            '14', // annex
        ]

        expect(sorted.map(a => a.id)).toEqual(expectedOrder)
    })

    it('应正确处理多个跳级的情况', () => {
        const articles = [
            // l1 直接包含 l3（跳过 l2）
            { id: '1', type: 'l1', l1: '第一编', order: 1 },
            { id: '2', type: 'l3', l1: '第一编', l2: null, l3: '第一章', order: 1 },
            { id: '3', type: 'l3', l1: '第一编', l2: null, l3: '第二章', order: 2 },

            // l3 直接包含 l5（跳过 l4）
            {
                id: '4',
                type: 'l5',
                l1: '第一编',
                l2: null,
                l3: '第一章',
                l4: null,
                l5: '第一条',
                order: 1,
            },
            {
                id: '5',
                type: 'l5',
                l1: '第一编',
                l2: null,
                l3: '第一章',
                l4: null,
                l5: '第二条',
                order: 2,
            },

            // 另一个 l1 直接包含 l3
            { id: '6', type: 'l1', l1: '第二编', order: 2 },
            { id: '7', type: 'l3', l1: '第二编', l2: null, l3: '第三章', order: 1 },
        ]

        const sorted = sortArticlesByHierarchy(articles)

        expect(sorted.map(a => a.id)).toEqual(['1', '2', '4', '5', '3', '6', '7'])
    })

    it('应正确处理同一层级内的大量条文', () => {
        // 生成 100 个条文
        const articles: Array<{
            id: string
            type: string
            l1?: string | null
            l2?: string | null
            l3?: string | null
            l4?: string | null
            l5?: string | null
            order: number
        }> = []

        // 添加父级节点
        articles.push({
            id: '0',
            type: 'l3',
            l1: '第一编',
            l2: null,
            l3: '第一章',
            order: 1,
        })

        for (let i = 1; i <= 100; i++) {
            articles.push({
                id: `${i}`,
                type: 'l5',
                l1: '第一编',
                l2: null,
                l3: '第一章',
                l4: null,
                l5: `第${i}条`,
                order: i,
            })
        }

        const sorted = sortArticlesByHierarchy(articles)

        // 验证排序结果长度
        expect(sorted.length).toBe(101) // 1 章 + 100 条

        // 验证第一个是父级节点
        expect(sorted[0].id).toBe('0')

        // 验证后续 100 个条文按顺序排列
        for (let i = 1; i <= 100; i++) {
            expect(sorted[i].id).toBe(`${i}`)
        }
    })

    it('应正确处理性能要求（1000 条以内）', () => {
        // 生成 1000 个条文
        const articles: Array<{
            id: string
            type: string
            l1?: string | null
            l2?: string | null
            l3?: string | null
            l4?: string | null
            l5?: string | null
            order: number
        }> = []

        // 添加顶层编
        articles.push({
            id: 'book-1',
            type: 'l1',
            l1: '第一编',
            order: 1,
        })

        // 添加 10 个章
        for (let chapter = 1; chapter <= 10; chapter++) {
            articles.push({
                id: `chapter-${chapter}`,
                type: 'l3',
                l1: '第一编',
                l2: null,
                l3: `第${chapter}章`,
                order: chapter,
            })

            // 每章 100 条
            for (let article = 1; article <= 100; article++) {
                articles.push({
                    id: `article-${chapter}-${article}`,
                    type: 'l5',
                    l1: '第一编',
                    l2: null,
                    l3: `第${chapter}章`,
                    l4: null,
                    l5: `第${article}条`,
                    order: article,
                })
            }
        }

        const startTime = Date.now()
        const sorted = sortArticlesByHierarchy(articles)
        const endTime = Date.now()

        const duration = endTime - startTime

        // 验证排序时间小于 100ms
        expect(duration).toBeLessThan(100)

        // 验证排序结果正确
        expect(sorted.length).toBe(1011) // 1 编 + 10 章 + 1000 条

        // 验证第一个是编
        expect(sorted[0].id).toBe('book-1')
    })
})

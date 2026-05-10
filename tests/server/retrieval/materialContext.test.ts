/**
 * 材料上下文分级注入单元测试
 *
 * **Feature: retrieval**
 * **Validates: getMaterialContextService 分级注入逻辑，buildMaterialContextMessage 格式化**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock prisma（让 fetchMaterialContents 不做真实 DB 查询）---
const prismaMocks = vi.hoisted(() => ({
    textContentRecords: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
}))

vi.stubGlobal('prisma', prismaMocks)
vi.stubGlobal('logger', { info: vi.fn(), error: vi.fn(), warn: vi.fn() })

// mock materialSummary.service（动态 import）
vi.mock('../../../server/services/material/materialSummary.service', () => ({
    generateAndCacheSummaries: vi.fn().mockResolvedValue(new Map()),
}))

// summary 已迁出 caseMaterials.summary，由 getMaterialSummariesByMaterials 跨表查；测试 mock 让它直接返回 Map
const summaryByIdMock = vi.fn(async () => new Map<number, string>())
vi.mock('../../../server/services/material/material.service', async (orig) => {
    const actual = await (orig as any)()
    return {
        ...actual,
        getMaterialSummariesByMaterials: (...args: any[]) => summaryByIdMock(...args),
    }
})

// 在 stub 设置后导入被测模块
import {
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
    MATERIAL_PRIORITY,
    TOKEN_THRESHOLD,
} from '../../../server/services/material/materialPipeline.service'
import type { MaterialContextResult } from '../../../server/services/material/materialPipeline.service'

// --- 测试辅助函数 ---

/**
 * 构造 MaterialWithFile 对象
 * 对于 type=1(CASE_CONTENT)，getSourceId 返回 m.id
 * 对于其他类型，getSourceId 返回 m.ossFileId
 */
function makeMaterial(overrides: {
    id: number
    type: number
    name?: string
    ossFileId?: number | null
    summary?: string | null
}) {
    return {
        id: overrides.id,
        type: overrides.type,
        name: overrides.name ?? `材料${overrides.id}`,
        ossFileId: overrides.ossFileId !== undefined ? overrides.ossFileId : null,
        summary: overrides.summary ?? null,
        caseId: 1,
        userId: 1,
        status: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        file: null,
    } as any
}

/**
 * 设置 prisma mock，让 textContentRecords.findMany 返回指定内容
 * materialId → content 映射（仅用于 type=1 材料）
 */
function mockTextContents(contentMap: Map<number, string>) {
    prismaMocks.textContentRecords.findMany.mockResolvedValue(
        Array.from(contentMap.entries()).map(([materialId, content]) => ({ materialId, content }))
    )
    prismaMocks.docRecognitionRecords.findMany.mockResolvedValue([])
    prismaMocks.imageRecognitionRecords.findMany.mockResolvedValue([])
    prismaMocks.asrRecords.findMany.mockResolvedValue([])
}

/**
 * 为 type=2(DOCUMENT) 材料设置 doc mock
 */
function mockDocContents(contentMap: Map<number, string>, materials: any[]) {
    prismaMocks.textContentRecords.findMany.mockResolvedValue([])
    prismaMocks.imageRecognitionRecords.findMany.mockResolvedValue([])
    prismaMocks.asrRecords.findMany.mockResolvedValue([])

    const records = Array.from(contentMap.entries()).map(([materialId, content]) => {
        const mat = materials.find((m: any) => m.id === materialId)
        return { ossFileId: mat.ossFileId, markdownContent: content }
    })
    prismaMocks.docRecognitionRecords.findMany.mockResolvedValue(records)
}

describe('getMaterialContextService — 分级注入逻辑', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        prismaMocks.textContentRecords.findMany.mockResolvedValue([])
        prismaMocks.docRecognitionRecords.findMany.mockResolvedValue([])
        prismaMocks.imageRecognitionRecords.findMany.mockResolvedValue([])
        prismaMocks.asrRecords.findMany.mockResolvedValue([])
    })

    it('空材料列表 → mode=empty', async () => {
        const result = await getMaterialContextService([])
        expect(result.mode).toBe('empty')
        expect(result.totalTokens).toBe(0)
        expect(result.materialList).toHaveLength(0)
    })

    it('所有材料 token 在预算内 → 全部 mode=full，整体 mode=full', async () => {
        // 每个材料约 100 token（200 个中文字符 = 100 token），总计 200 token，远小于 32000
        const content1 = '甲'.repeat(200)
        const content2 = '乙'.repeat(200)
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '案情材料1' }),
            makeMaterial({ id: 2, type: 1, name: '案情材料2' }),
        ]
        mockTextContents(new Map([[1, content1], [2, content2]]))

        const result = await getMaterialContextService(materials, TOKEN_THRESHOLD)

        expect(result.mode).toBe('full')
        expect(result.materialList).toHaveLength(2)
        for (const item of result.materialList) {
            expect(item.mode).toBe('full')
            expect(item.content).toBeDefined()
            expect(item.summary).toBeUndefined()
        }
    })

    it('部分材料超出预算 → 高优先级全文，低优先级摘要，整体 mode=graded', async () => {
        // type=1(CASE_CONTENT) 优先级 10，type=2(DOCUMENT) 优先级 8
        // tiktoken cl100k_base 下中文字符大约 1 字 ≈ 2 token：
        //   '甲'*200 ≈ 400 tokens（短文档），'乙'*400 ≈ 800 tokens（长文档）
        // 预算 600：案情材料(400)能放入，文档材料(800)超出剩余 200，降级为摘要
        const contentCase = '甲'.repeat(200)
        const contentDoc = '乙'.repeat(400)
        const docMat = makeMaterial({ id: 200, type: 2, name: '文档材料', ossFileId: 200 })
        const caseMat = makeMaterial({ id: 100, type: 1, name: '案情内容' })

        // type=1 从 textContentRecords 读，type=2 从 docRecognitionRecords 读
        prismaMocks.textContentRecords.findMany.mockResolvedValue([
            { materialId: 100, content: contentCase },
        ])
        prismaMocks.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200, markdownContent: contentDoc },
        ])
        prismaMocks.imageRecognitionRecords.findMany.mockResolvedValue([])
        prismaMocks.asrRecords.findMany.mockResolvedValue([])

        const materials = [docMat, caseMat] // 故意乱序，确认优先级排序生效
        const result = await getMaterialContextService(materials, 600)

        expect(result.mode).toBe('graded')

        // type=1(CASE_CONTENT, id=100) 优先级 10 → 先处理，全文
        // type=2(DOCUMENT, id=200) 优先级 8 → 超出剩余预算，摘要
        const caseItem = result.materialList.find(i => i.sourceId === 100)
        const docItem = result.materialList.find(i => i.sourceId === 200)

        expect(caseItem?.mode).toBe('full')
        expect(docItem?.mode).toBe('summary')
    })

    it('所有材料都超出预算 → 全部 mode=summary，整体 mode=summary', async () => {
        const longContent = '丁'.repeat(500) // ~250 tokens
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '大案情1' }),
            makeMaterial({ id: 2, type: 1, name: '大案情2' }),
        ]
        mockTextContents(new Map([[1, longContent], [2, longContent]]))

        // 预算 100，每个材料 250 token，全部超出
        const result = await getMaterialContextService(materials, 100)

        expect(result.mode).toBe('summary')
        for (const item of result.materialList) {
            expect(item.mode).toBe('summary')
        }
    })

    it('优先级排序：CASE_CONTENT(10) > DOCUMENT(8) > IMAGE(5) > AUDIO(3)', async () => {
        // tiktoken cl100k_base 下 '戊'*200 ≈ 400 tokens
        // 预算仅 410（仅能容纳 1 份材料），验证优先级最高的先拿到全文
        const content = '戊'.repeat(200)

        const audioMat = makeMaterial({ id: 1, type: 4, name: '音频', ossFileId: 1001 })
        const imgMat = makeMaterial({ id: 2, type: 3, name: '图片', ossFileId: 1002 })
        const docMat = makeMaterial({ id: 3, type: 2, name: '文档', ossFileId: 1003 })
        const caseMat = makeMaterial({ id: 4, type: 1, name: '案情内容' })

        // 每份内容相同大小
        prismaMocks.textContentRecords.findMany.mockResolvedValue([
            { materialId: 4, content },
        ])
        prismaMocks.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 1003, markdownContent: content },
        ])
        prismaMocks.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 1002, markdownContent: content },
        ])
        prismaMocks.asrRecords.findMany.mockResolvedValue([
            { ossFileId: 1001, summary: content, result: null },
        ])

        // 预算 410：仅能放下 1 份全文（400 tokens）+ 留一点余量给摘要
        const materials = [audioMat, imgMat, docMat, caseMat] // 故意乱序
        const result = await getMaterialContextService(materials, 410)

        const fullItems = result.materialList.filter(i => i.mode === 'full')
        const summaryItems = result.materialList.filter(i => i.mode === 'summary')

        expect(fullItems).toHaveLength(1)
        // 全文的必须是优先级最高的 CASE_CONTENT (id=4, sourceId=4)
        expect(fullItems[0]!.sourceId).toBe(4)
        expect(summaryItems).toHaveLength(3)
    })

    it('无内容的材料 → hasContent=false，mode=summary，summary 含提示文字', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '无内容材料' }),
        ]
        // 不返回任何内容
        prismaMocks.textContentRecords.findMany.mockResolvedValue([])

        const result = await getMaterialContextService(materials, TOKEN_THRESHOLD)

        expect(result.materialList).toHaveLength(1)
        const item = result.materialList[0]!
        expect(item.hasContent).toBe(false)
        expect(item.mode).toBe('summary')
        expect(item.summary).toContain('暂无内容')
    })

    it('材料 summary 缓存命中（getMaterialSummariesByMaterials 返回非空）时，超出预算降级为摘要时优先使用 summary 而非截断 content', async () => {
        const longContent = '己'.repeat(500) // ~250 tokens，超出预算
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '有摘要的文档' }),
        ]
        mockTextContents(new Map([[1, longContent]]))
        // summary 已迁到识别记录表，业务通过 getMaterialSummariesByMaterials 跨表 union 查
        summaryByIdMock.mockResolvedValueOnce(new Map([[1, '这是已有的摘要']]))

        // 预算 50，内容超出 → 摘要模式
        const result = await getMaterialContextService(materials, 50)

        const item = result.materialList[0]!
        expect(item.mode).toBe('summary')
        expect(item.summary).toBe('这是已有的摘要')
    })
})

describe('buildMaterialContextMessage — 格式化输出', () => {
    it('mode=empty → 返回空字符串', () => {
        const context: MaterialContextResult = { mode: 'empty', totalTokens: 0, materialList: [] }
        expect(buildMaterialContextMessage(context)).toBe('')
    })

    it('全 full → 所有条目含 [全文] 标记，统计为 N 份全文 + 0 份摘要', () => {
        const context: MaterialContextResult = {
            mode: 'full',
            totalTokens: 100,
            materialList: [
                { sourceId: 1, name: '案情', type: 1, hasContent: true, mode: 'full', content: '案情正文' },
                { sourceId: 2, name: '合同', type: 2, hasContent: true, mode: 'full', content: '合同内容' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('[全文]')
        expect(msg).toContain('2 份全文 + 0 份摘要')
        expect(msg).not.toContain('[摘要]')
        expect(msg).toContain('案情正文')
        expect(msg).toContain('合同内容')
    })

    it('混合 graded → 头部统计正确，全文和摘要标记均出现', () => {
        const context: MaterialContextResult = {
            mode: 'graded',
            totalTokens: 200,
            materialList: [
                { sourceId: 1, name: '案情', type: 1, hasContent: true, mode: 'full', content: '案情正文' },
                { sourceId: 2, name: '音频', type: 4, hasContent: true, mode: 'summary', summary: '音频摘要' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('1 份全文 + 1 份摘要')
        expect(msg).toContain('[全文]')
        expect(msg).toContain('[摘要]')
        expect(msg).toContain('案情正文')
        expect(msg).toContain('音频摘要')
        expect(msg).toContain('search_case_materials')
    })

    it('全 summary → 所有条目含 [摘要] 标记，统计为 0 份全文 + N 份摘要', () => {
        const context: MaterialContextResult = {
            mode: 'summary',
            totalTokens: 0,
            materialList: [
                { sourceId: 1, name: '大文档', type: 2, hasContent: true, mode: 'summary', summary: '文档摘要内容' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('[摘要]')
        expect(msg).toContain('0 份全文 + 1 份摘要')
        expect(msg).toContain('文档摘要内容')
    })
})

describe('buildIncrementalMaterialMessage — 增量注入格式化', () => {
    it('mode=empty → 返回空字符串', () => {
        const context: MaterialContextResult = { mode: 'empty', totalTokens: 0, materialList: [] }
        expect(buildIncrementalMaterialMessage(context)).toBe('')
    })

    it('混合材料 → 包含"案件新增"字样，含统计和 [全文]/[摘要] 标记', () => {
        const context: MaterialContextResult = {
            mode: 'graded',
            totalTokens: 100,
            materialList: [
                { sourceId: 5, name: '新案情', type: 1, hasContent: true, mode: 'full', content: '新案情正文' },
                { sourceId: 6, name: '新图片', type: 3, hasContent: true, mode: 'summary', summary: '图片摘要' },
            ],
        }
        const msg = buildIncrementalMaterialMessage(context)
        expect(msg).toContain('案件新增了以下材料')
        expect(msg).toContain('1 份全文 + 1 份摘要')
        expect(msg).toContain('[全文]')
        expect(msg).toContain('[摘要]')
        expect(msg).toContain('新案情正文')
        expect(msg).toContain('图片摘要')
    })

    it('全 full → 含 [全文] 标记，不含 [摘要]', () => {
        const context: MaterialContextResult = {
            mode: 'full',
            totalTokens: 100,
            materialList: [
                { sourceId: 7, name: '新文档', type: 2, hasContent: true, mode: 'full', content: '文档全文' },
            ],
        }
        const msg = buildIncrementalMaterialMessage(context)
        expect(msg).toContain('[全文]')
        expect(msg).toContain('1 份全文 + 0 份摘要')
        expect(msg).not.toContain('[摘要]')
    })
})

describe('MATERIAL_PRIORITY — 优先级常量', () => {
    it('CASE_CONTENT > DOCUMENT > IMAGE > AUDIO', () => {
        expect(MATERIAL_PRIORITY[1]).toBeGreaterThan(MATERIAL_PRIORITY[2]!)
        expect(MATERIAL_PRIORITY[2]).toBeGreaterThan(MATERIAL_PRIORITY[3]!)
        expect(MATERIAL_PRIORITY[3]).toBeGreaterThan(MATERIAL_PRIORITY[4]!)
    })

    it('所有优先级值均为正数', () => {
        for (const val of Object.values(MATERIAL_PRIORITY)) {
            expect(val).toBeGreaterThan(0)
        }
    })
})

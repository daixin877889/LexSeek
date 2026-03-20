// tests/server/material/textContentRecords.dao.test.ts

/**
 * textContentRecords DAO 测试
 *
 * 测试文本内容记录的 CRUD 操作和嵌入状态更新
 */
import { describe, it, expect, afterAll } from 'vitest'
import './test-setup'
import { getTestPrisma } from './test-db-helper'

import {
    createTextContentRecordDAO,
    findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO,
    findTextContentRecordsByMaterialIdsDAO,
    updateTextContentRecordEmbeddingDAO,
} from '../../../server/services/material/textContentRecords.dao'

// 测试辅助：收集创建的记录 ID 用于清理
const createdIds: number[] = []

describe('textContentRecords DAO', () => {
    afterAll(async () => {
        // 清理测试数据
        const testPrisma = getTestPrisma()
        if (createdIds.length > 0) {
            await testPrisma.textContentRecords.deleteMany({
                where: { id: { in: createdIds } },
            })
        }
        await testPrisma.$disconnect()
    })

    it('createTextContentRecordDAO 应创建文本内容记录', async () => {
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            materialId: null,
            content: '测试文本内容',
            htmlContent: '<p>测试文本内容</p>',
        })
        createdIds.push(record.id)

        expect(record.id).toBeGreaterThan(0)
        expect(record.content).toBe('测试文本内容')
        expect(record.htmlContent).toBe('<p>测试文本内容</p>')
        expect(record.status).toBe(0) // 默认待处理
        expect(record.lastEmbeddingAt).toBeNull()
    })

    it('findTextContentRecordByIdDAO 应按 ID 查找', async () => {
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            content: '查找测试',
        })
        createdIds.push(record.id)

        const found = await findTextContentRecordByIdDAO(record.id)
        expect(found).not.toBeNull()
        expect(found!.id).toBe(record.id)
    })

    it('findTextContentRecordByMaterialIdDAO 应按 materialId 查找', async () => {
        const testMaterialId = 99999
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            materialId: testMaterialId,
            content: 'materialId 查找测试',
        })
        createdIds.push(record.id)

        const found = await findTextContentRecordByMaterialIdDAO(testMaterialId)
        expect(found).not.toBeNull()
        expect(found!.materialId).toBe(testMaterialId)
    })

    it('findTextContentRecordsByMaterialIdsDAO 应批量查找', async () => {
        const ids = [88881, 88882]
        for (const mid of ids) {
            const r = await createTextContentRecordDAO({
                userId: 1,
                caseId: 1,
                materialId: mid,
                content: `批量查找-${mid}`,
            })
            createdIds.push(r.id)
        }

        const records = await findTextContentRecordsByMaterialIdsDAO(ids)
        expect(records.length).toBe(2)
    })

    it('updateTextContentRecordEmbeddingDAO 应更新嵌入结果', async () => {
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            content: '嵌入更新测试',
        })
        createdIds.push(record.id)

        const now = new Date()
        await updateTextContentRecordEmbeddingDAO(record.id, {
            vectorIds: ['vec-1', 'vec-2'],
            lastEmbeddingAt: now,
            status: 2,
        })

        const updated = await findTextContentRecordByIdDAO(record.id)
        expect(updated!.status).toBe(2)
        expect(updated!.lastEmbeddingAt).not.toBeNull()
        expect(updated!.vectorIds).toEqual(['vec-1', 'vec-2'])
    })
})

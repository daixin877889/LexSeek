/**
 * 案件服务测试
 *
 * **Feature: case-creation-enhancement**
 * **Validates: Requirements 7.1, 7.2, 7.4**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createCaseService } from '../../../server/services/case/case.service'
import { findByCaseIdDAO } from '../../../server/services/case/caseMaterial.dao'
import { CaseMaterialType } from '../../../shared/types/case'
import type { CaseMaterialParam } from '../../../shared/types/case'

// 测试用户 ID（使用测试账号对应的用户 ID）
const TEST_USER_ID = 1
// 测试案件类型 ID（需要确保数据库中存在）
const TEST_CASE_TYPE_ID = 1

describe('案件创建增强 - 事务完整性', () => {
    let createdCaseId: number | null = null

    afterAll(async () => {
        // 清理测试数据
        if (createdCaseId) {
            await prisma.cases.update({
                where: { id: createdCaseId },
                data: { deletedAt: new Date() },
            })
        }
    })

    it('应该在同一个事务中创建案件、会话和材料', async () => {
        // 准备测试数据：创建一个文本材料
        const materials: CaseMaterialParam[] = [
            {
                type: CaseMaterialType.CASE_CONTENT,
                name: '案情描述',
                content: '这是一个测试案件的案情描述内容',
            },
        ]

        // 调用创建案件服务
        const result = await createCaseService({
            title: '测试案件 - 事务完整性',
            content: '测试案件内容',
            userId: TEST_USER_ID,
            caseTypeId: TEST_CASE_TYPE_ID,
            materials,
        })

        // 保存案件 ID 用于清理
        createdCaseId = result.caseId

        // 验证返回结果
        expect(result).toBeDefined()
        expect(result.caseId).toBeGreaterThan(0)
        expect(result.sessionId).toBeDefined()
        expect(result.case).toBeDefined()
        expect(result.session).toBeDefined()

        // 验证案件记录
        expect(result.case.id).toBe(result.caseId)
        expect(result.case.title).toBe('测试案件 - 事务完整性')
        expect(result.case.userId).toBe(TEST_USER_ID)
        expect(result.case.caseTypeId).toBe(TEST_CASE_TYPE_ID)

        // 验证会话记录
        expect(result.session.sessionId).toBe(result.sessionId)
        expect(result.session.caseId).toBe(result.caseId)
        expect(result.session.status).toBe(1) // IN_PROGRESS

        // 验证材料记录（content + materials = 2 个材料）
        const caseMaterials = await findByCaseIdDAO(result.caseId)
        expect(caseMaterials).toBeDefined()
        expect(caseMaterials.length).toBe(2)

        // 第一个材料是从 content 转换的
        expect(caseMaterials[0].name).toBe('案件描述')
        expect(caseMaterials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(caseMaterials[0].content).toBe('测试案件内容')
        expect(caseMaterials[0].caseId).toBe(result.caseId)

        // 第二个材料是用户提供的
        expect(caseMaterials[1].name).toBe('案情描述')
        expect(caseMaterials[1].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(caseMaterials[1].content).toBe('这是一个测试案件的案情描述内容')
        expect(caseMaterials[1].caseId).toBe(result.caseId)
    })

    it('应该支持创建不带材料的案件', async () => {
        // 调用创建案件服务（不传 materials）
        const result = await createCaseService({
            title: '测试案件 - 无材料',
            content: '测试案件内容',
            userId: TEST_USER_ID,
            caseTypeId: TEST_CASE_TYPE_ID,
        })

        // 清理标记
        if (createdCaseId === null) {
            createdCaseId = result.caseId
        } else {
            // 如果已有案件，立即清理这个
            await prisma.cases.update({
                where: { id: result.caseId },
                data: { deletedAt: new Date() },
            })
        }

        // 验证返回结果
        expect(result).toBeDefined()
        expect(result.caseId).toBeGreaterThan(0)
        expect(result.sessionId).toBeDefined()

        // 验证 content 被保存为材料
        const caseMaterials = await findByCaseIdDAO(result.caseId)
        expect(caseMaterials).toBeDefined()
        expect(caseMaterials.length).toBe(1)
        expect(caseMaterials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(caseMaterials[0].name).toBe('案件描述')
        expect(caseMaterials[0].content).toBe('测试案件内容')
    })

    it('应该支持创建多个材料的案件', async () => {
        // 准备测试数据：创建多个文本材料
        const materials: CaseMaterialParam[] = [
            {
                type: CaseMaterialType.CASE_CONTENT,
                name: '案情描述1',
                content: '第一段案情描述',
            },
            {
                type: CaseMaterialType.CASE_CONTENT,
                name: '案情描述2',
                content: '第二段案情描述',
            },
            {
                type: CaseMaterialType.CASE_CONTENT,
                name: '案情描述3',
                content: '第三段案情描述',
            },
        ]

        // 调用创建案件服务
        const result = await createCaseService({
            title: '测试案件 - 多材料',
            content: '测试案件内容',
            userId: TEST_USER_ID,
            caseTypeId: TEST_CASE_TYPE_ID,
            materials,
        })

        // 清理标记
        if (createdCaseId === null) {
            createdCaseId = result.caseId
        } else {
            // 如果已有案件，立即清理这个
            await prisma.cases.update({
                where: { id: result.caseId },
                data: { deletedAt: new Date() },
            })
        }

        // 验证返回结果
        expect(result).toBeDefined()
        expect(result.caseId).toBeGreaterThan(0)

        // 验证材料记录（content + 3 个 materials = 4 个材料）
        const caseMaterials = await findByCaseIdDAO(result.caseId)
        expect(caseMaterials).toBeDefined()
        expect(caseMaterials.length).toBe(4)

        // 验证第一个材料是从 content 转换的
        expect(caseMaterials[0].name).toBe('案件描述')
        expect(caseMaterials[0].content).toBe('测试案件内容')

        // 验证其他材料
        expect(caseMaterials[1].name).toBe('案情描述1')
        expect(caseMaterials[1].content).toBe('第一段案情描述')
        expect(caseMaterials[2].name).toBe('案情描述2')
        expect(caseMaterials[2].content).toBe('第二段案情描述')
        expect(caseMaterials[3].name).toBe('案情描述3')
        expect(caseMaterials[3].content).toBe('第三段案情描述')
    })

    it('应该在未提供标题时生成默认标题', async () => {
        // 调用创建案件服务（不传 title）
        const result = await createCaseService({
            content: '测试案件内容',
            userId: TEST_USER_ID,
            caseTypeId: TEST_CASE_TYPE_ID,
        })

        // 清理标记
        if (createdCaseId === null) {
            createdCaseId = result.caseId
        } else {
            // 如果已有案件，立即清理这个
            await prisma.cases.update({
                where: { id: result.caseId },
                data: { deletedAt: new Date() },
            })
        }

        // 验证返回结果
        expect(result).toBeDefined()
        expect(result.caseId).toBeGreaterThan(0)
        expect(result.case.title).toBeDefined()
        // 验证标题格式为"待分析的{案件类型名称}"
        expect(result.case.title).toMatch(/^待分析的/)
    })

    it('应该同时保存 content 和 materials', async () => {
        // 准备测试数据
        const materials: CaseMaterialParam[] = [
            {
                type: CaseMaterialType.CASE_CONTENT,
                name: '补充材料',
                content: '这是补充的案情材料',
            },
        ]

        // 调用创建案件服务
        const result = await createCaseService({
            title: '测试案件 - content 和 materials',
            content: '这是主要案件描述',
            userId: TEST_USER_ID,
            caseTypeId: TEST_CASE_TYPE_ID,
            materials,
        })

        // 清理标记
        if (createdCaseId === null) {
            createdCaseId = result.caseId
        } else {
            // 如果已有案件，立即清理这个
            await prisma.cases.update({
                where: { id: result.caseId },
                data: { deletedAt: new Date() },
            })
        }

        // 验证材料记录
        const caseMaterials = await findByCaseIdDAO(result.caseId)
        expect(caseMaterials).toBeDefined()
        expect(caseMaterials.length).toBe(2)

        // 验证第一个材料是从 content 转换的
        expect(caseMaterials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(caseMaterials[0].name).toBe('案件描述')
        expect(caseMaterials[0].content).toBe('这是主要案件描述')

        // 验证第二个材料是用户提供的
        expect(caseMaterials[1].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(caseMaterials[1].name).toBe('补充材料')
        expect(caseMaterials[1].content).toBe('这是补充的案情材料')
    })
})

describe('案件创建 - 事务回滚测试', () => {
    it('当材料验证失败时，应该回滚整个事务', async () => {
        // 准备测试数据：包含无效材料（文本材料但没有 content）
        const materials: CaseMaterialParam[] = [
            {
                type: CaseMaterialType.CASE_CONTENT,
                name: '无效材料',
                content: '', // 空内容，应该触发验证失败
            },
        ]

        // 记录创建前的案件数量
        const beforeCount = await prisma.cases.count({
            where: { deletedAt: null },
        })

        // 调用创建案件服务，应该抛出错误
        await expect(
            createCaseService({
                title: '测试案件 - 事务回滚',
                content: '测试案件内容',
                userId: TEST_USER_ID,
                caseTypeId: TEST_CASE_TYPE_ID,
                materials,
            })
        ).rejects.toThrow('文本材料必须包含内容')

        // 验证案件数量没有增加（事务已回滚）
        const afterCount = await prisma.cases.count({
            where: { deletedAt: null },
        })
        expect(afterCount).toBe(beforeCount)
    })

    it('当文件材料的 OSS 文件不存在时，应该回滚整个事务', async () => {
        // 准备测试数据：包含不存在的 OSS 文件 ID
        const materials: CaseMaterialParam[] = [
            {
                type: CaseMaterialType.DOCUMENT,
                name: '不存在的文档',
                ossFileId: 999999999, // 不存在的文件 ID
            },
        ]

        // 记录创建前的案件数量
        const beforeCount = await prisma.cases.count({
            where: { deletedAt: null },
        })

        // 调用创建案件服务，应该抛出错误
        await expect(
            createCaseService({
                title: '测试案件 - OSS 文件不存在',
                content: '测试案件内容',
                userId: TEST_USER_ID,
                caseTypeId: TEST_CASE_TYPE_ID,
                materials,
            })
        ).rejects.toThrow('OSS 文件不存在')

        // 验证案件数量没有增加（事务已回滚）
        const afterCount = await prisma.cases.count({
            where: { deletedAt: null },
        })
        expect(afterCount).toBe(beforeCount)
    })
})

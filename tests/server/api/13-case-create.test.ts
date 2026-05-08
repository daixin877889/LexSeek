/**
 * 案件创建 API 测试
 *
 * **Feature: case-creation-enhancement**
 * **Validates: Requirements 7.5**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestHelper, connectTestDb, disconnectTestDb, testPrisma } from './test-api-helpers'
import { CaseMaterialType } from '../../../shared/types/case'

describe('案件创建 API - materials 参数验证', () => {
    const helper = createTestHelper()
    let testCaseTypeId: number

    beforeAll(async () => {
        await connectTestDb()

        // 使用测试账号登录
        await helper.loginWithPassword('13064768490', 'daixin88')

        // 获取测试案件类型
        const caseType = await testPrisma.caseTypes.findFirst({
            where: { status: 1 },
        })

        if (!caseType) {
            throw new Error('测试数据库中没有可用的案件类型')
        }

        testCaseTypeId = caseType.id
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('应该成功创建带有文本材料的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 文本材料',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
                {
                    type: CaseMaterialType.CASE_CONTENT,
                    name: '案情描述',
                    content: '这是一个测试案件的案情描述内容',
                },
            ],
        })

        expect(response.success).toBe(true)
        expect(response.data).toBeDefined()
        expect(response.data.caseId).toBeGreaterThan(0)
        expect(response.data.sessionId).toBeDefined()

        // 验证材料已创建（content + materials = 2 个材料）
        const materials = await testPrisma.caseMaterials.findMany({
            where: { caseId: response.data.caseId },
            orderBy: { id: 'asc' },
        })

        expect(materials.length).toBe(2)
        // 第一个是从 content 转换的
        expect(materials[0].name).toBe('案件描述')
        expect(materials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(materials[0].content).toBe('测试案件内容')
        // 第二个是用户提供的
        expect(materials[1].name).toBe('案情描述')
        expect(materials[1].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(materials[1].content).toBe('这是一个测试案件的案情描述内容')

        // 清理测试数据
        await testPrisma.cases.update({
            where: { id: response.data.caseId },
            data: { deletedAt: new Date() },
        })
    })

    it('应该成功创建带有多个文本材料的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 多个文本材料',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
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
            ],
        })

        expect(response.success).toBe(true)
        expect(response.data).toBeDefined()

        // 验证材料已创建（content + 2 个 materials = 3 个材料）
        const materials = await testPrisma.caseMaterials.findMany({
            where: { caseId: response.data.caseId },
            orderBy: { id: 'asc' },
        })

        expect(materials.length).toBe(3)
        // 第一个是从 content 转换的
        expect(materials[0].name).toBe('案件描述')
        expect(materials[0].content).toBe('测试案件内容')
        // 其他是用户提供的
        expect(materials[1].name).toBe('案情描述1')
        expect(materials[1].content).toBe('第一段案情描述')
        expect(materials[2].name).toBe('案情描述2')
        expect(materials[2].content).toBe('第二段案情描述')

        // 清理测试数据
        await testPrisma.cases.update({
            where: { id: response.data.caseId },
            data: { deletedAt: new Date() },
        })
    })

    it('应该拒绝无效的材料类型', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 无效材料类型',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
                {
                    type: 999, // 无效的材料类型
                    name: '无效材料',
                    content: '测试内容',
                },
            ],
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('材料类型')
    })

    it('应该拒绝文本材料缺少 content 字段', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 缺少 content',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
                {
                    type: CaseMaterialType.CASE_CONTENT,
                    name: '无效材料',
                    // 缺少 content 字段
                },
            ],
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('content')
    })

    it('应该拒绝文本材料的 content 为空字符串', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 空 content',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
                {
                    type: CaseMaterialType.CASE_CONTENT,
                    name: '无效材料',
                    content: '', // 空字符串
                },
            ],
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('content')
    })

    it('应该拒绝文件材料缺少 ossFileId 字段', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 缺少 ossFileId',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
                {
                    type: CaseMaterialType.DOCUMENT,
                    name: '文档材料',
                    // 缺少 ossFileId 字段
                },
            ],
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('ossFileId')
    })

    it('应该拒绝 ossFileId 不是数字', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - ossFileId 类型错误',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [
                {
                    type: CaseMaterialType.DOCUMENT,
                    name: '文档材料',
                    ossFileId: 'invalid', // 不是数字
                },
            ],
        })

        expect(response.success).toBe(false)
        // zod 会返回类型错误消息
        expect(response.message).toMatch(/number|ossFileId/)
    })

    it('应该成功创建不带材料的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 无材料',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            // 不传 materials 字段
        })

        expect(response.success).toBe(true)
        expect(response.data).toBeDefined()
        expect(response.data.caseId).toBeGreaterThan(0)

        // 验证 content 被保存为材料
        const materials = await testPrisma.caseMaterials.findMany({
            where: { caseId: response.data.caseId },
        })

        expect(materials.length).toBe(1)
        expect(materials[0].name).toBe('案件描述')
        expect(materials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(materials[0].content).toBe('测试案件内容')

        // 清理测试数据
        await testPrisma.cases.update({
            where: { id: response.data.caseId },
            data: { deletedAt: new Date() },
        })
    })

    it('应该成功创建 materials 为空数组的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 空材料数组',
            content: '测试案件内容',
            caseTypeId: testCaseTypeId,
            materials: [], // 空数组
        })

        expect(response.success).toBe(true)
        expect(response.data).toBeDefined()
        expect(response.data.caseId).toBeGreaterThan(0)

        // 验证 content 被保存为材料
        const materials = await testPrisma.caseMaterials.findMany({
            where: { caseId: response.data.caseId },
        })

        expect(materials.length).toBe(1)
        expect(materials[0].name).toBe('案件描述')
        expect(materials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
        expect(materials[0].content).toBe('测试案件内容')

        // 清理测试数据
        await testPrisma.cases.update({
            where: { id: response.data.caseId },
            data: { deletedAt: new Date() },
        })
    })

    it('应该拒绝既没有 content 也没有 materials 的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 无内容无材料',
            caseTypeId: testCaseTypeId,
            // 既不传 content 也不传 materials
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('至少需要提供一个')
    })

    it('应该拒绝 content 为空字符串且没有 materials 的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 空内容无材料',
            content: '   ', // 只有空格
            caseTypeId: testCaseTypeId,
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('至少需要提供一个')
    })

    it('应该拒绝 content 为空且 materials 为空数组的案件', async () => {
        const response = await helper.getClient().post('/api/v1/case/create', {
            title: '测试案件 - 空内容空材料',
            content: '',
            materials: [],
            caseTypeId: testCaseTypeId,
        })

        expect(response.success).toBe(false)
        expect(response.message).toContain('至少需要提供一个')
    })
})

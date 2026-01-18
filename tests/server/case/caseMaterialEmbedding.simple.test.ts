/**
 * 案件材料向量化服务简单测试
 * Requirements: 8.4
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '../../../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

// 加载环境变量
config()

// 创建 Prisma 客户端
function createPrismaClient() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL is not defined')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const prisma = createPrismaClient()

describe('案件材料向量化服务简单测试', () => {
    let testUserId: number
    let testCaseTypeId: number
    let testCaseId: number

    beforeAll(async () => {
        // 创建测试用户
        const user = await prisma.users.create({
            data: {
                username: `test_embed_simple_${Date.now()}`,
                name: `测试用户_${Date.now()}`,
                phone: `1380000${Date.now().toString().slice(-4)}`,
                password: 'test123',
                email: `test_embed_simple_${Date.now()}@test.com`,
            },
        })
        testUserId = user.id

        // 创建测试案件类型
        const caseType = await prisma.caseTypes.create({
            data: {
                name: '测试案件类型',
                status: 1,
            },
        })
        testCaseTypeId = caseType.id

        // 创建测试案件
        const testCase = await prisma.cases.create({
            data: {
                title: '测试案件',
                userId: testUserId,
                caseTypeId: testCaseTypeId,
                status: 1,
            },
        })
        testCaseId = testCase.id
    })

    afterAll(async () => {
        // 清理测试数据
        if (testCaseId) {
            await prisma.caseMaterials.deleteMany({
                where: { caseId: testCaseId },
            })
            await prisma.cases.deleteMany({
                where: { id: testCaseId },
            })
        }
        if (testCaseTypeId) {
            await prisma.caseTypes.deleteMany({
                where: { id: testCaseTypeId },
            })
        }
        if (testUserId) {
            await prisma.users.deleteMany({
                where: { id: testUserId },
            })
        }
    })

    it('应该成功添加 embeddingStatus 字段', async () => {
        // 创建一个测试材料
        const material = await prisma.caseMaterials.create({
            data: {
                caseId: testCaseId,
                name: '测试材料',
                type: 1,
                content: '测试内容',
                status: 1,
                embeddingStatus: 'pending',
            },
        })

        expect(material.embeddingStatus).toBe('pending')

        // 更新状态
        const updated = await prisma.caseMaterials.update({
            where: { id: material.id },
            data: { embeddingStatus: 'completed' },
        })

        expect(updated.embeddingStatus).toBe('completed')

        // 清理
        await prisma.caseMaterials.delete({
            where: { id: material.id },
        })
    })

    it('应该验证 embeddingStatus 字段的默认值', async () => {
        // 创建材料时不指定 embeddingStatus
        const material = await prisma.caseMaterials.create({
            data: {
                caseId: testCaseId,
                name: '测试材料2',
                type: 1,
                content: '测试内容2',
                status: 1,
            },
        })

        // 验证默认值为 'pending'
        expect(material.embeddingStatus).toBe('pending')

        // 清理
        await prisma.caseMaterials.delete({
            where: { id: material.id },
        })
    })
})

/**
 * 节点 outputSchema CRUD 测试
 *
 * **Feature: node-management**
 * **Validates: outputSchema 字段的创建、读取、更新、清空**
 */
import { describe, it, expect, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()
const createdNodeIds: number[] = []
const createdModelIds: number[] = []
const createdProviderIds: number[] = []

// 获取一个可用的 modelId（本测试自建，不依赖 seed status=1）
let testModelId: number

afterAll(async () => {
    // 清理测试数据
    for (const id of createdNodeIds) {
        await testPrisma.nodes.delete({ where: { id } }).catch(() => {})
    }
    for (const id of createdModelIds) {
        await testPrisma.models.delete({ where: { id } }).catch(() => {})
    }
    for (const id of createdProviderIds) {
        await testPrisma.modelProviders.delete({ where: { id } }).catch(() => {})
    }
    await testPrisma.$disconnect()
})

describe('节点 outputSchema CRUD', () => {
    it('准备测试数据：获取可用模型ID', async () => {
        // 自建一条 status=1 的 model（不依赖 seed），保证测试隔离
        const provider = await testPrisma.modelProviders.create({
            data: {
                name: `test_provider_node_output_${Date.now()}`,
                baseUrl: 'https://api.test.com',
                description: 'node-output-schema test provider',
            },
        })
        createdProviderIds.push(provider.id)

        const model = await testPrisma.models.create({
            data: {
                providerId: provider.id,
                name: `test_model_node_output_${Date.now()}`,
                displayName: '测试模型',
                modelType: 'chat',
                status: 1,
            },
        })
        createdModelIds.push(model.id)

        expect(model).not.toBeNull()
        testModelId = model.id
    })

    it('创建节点时应支持设置 outputSchema', async () => {
        const schema = {
            type: 'object',
            properties: {
                title: { type: 'string', description: '案件标题' },
                plaintiff: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
        }

        const node = await testPrisma.nodes.create({
            data: {
                name: `test_output_schema_${Date.now()}`,
                title: '测试节点',
                type: 'extraction',
                modelId: testModelId,
                outputSchema: schema,
            },
        })
        createdNodeIds.push(node.id)

        expect(node.outputSchema).toEqual(schema)
    })

    it('读取节点时应返回 outputSchema', async () => {
        const nodeId = createdNodeIds[0]
        const node = await testPrisma.nodes.findUnique({ where: { id: nodeId } })
        expect(node).not.toBeNull()
        expect(node!.outputSchema).not.toBeNull()
        expect((node!.outputSchema as any).type).toBe('object')
    })

    it('更新节点时应能修改 outputSchema', async () => {
        const nodeId = createdNodeIds[0]
        const newSchema = {
            type: 'object',
            properties: {
                summary: { type: 'string', description: '案件概要' },
            },
            required: ['summary'],
        }

        const updated = await testPrisma.nodes.update({
            where: { id: nodeId },
            data: { outputSchema: newSchema },
        })

        expect(updated.outputSchema).toEqual(newSchema)
    })

    it('更新节点时应能清空 outputSchema 为 null', async () => {
        const nodeId = createdNodeIds[0]
        // Prisma 中使用 DbNull 来将 Json? 字段设为 null
        const { Prisma } = await import('../../../generated/prisma/client')
        const updated = await testPrisma.nodes.update({
            where: { id: nodeId },
            data: { outputSchema: Prisma.DbNull },
        })

        expect(updated.outputSchema).toBeNull()
    })

    it('创建非 extraction/agent 类型节点时 outputSchema 应为 null', async () => {
        const node = await testPrisma.nodes.create({
            data: {
                name: `test_analysis_no_schema_${Date.now()}`,
                title: '分析节点',
                type: 'analysis',
                modelId: testModelId,
                outputSchema: undefined,
            },
        })
        createdNodeIds.push(node.id)

        expect(node.outputSchema).toBeNull()
    })
})

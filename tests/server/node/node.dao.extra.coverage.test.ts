/**
 * 节点 DAO 覆盖率补充测试（额外路径）
 *
 * 覆盖 node.dao.ts 中未被其他测试覆盖的路径：
 * - createNodeGroupDao / findNodeGroupByIdDao / updateNodeGroupDao / softDeleteNodeGroupDao
 * - findManyNodeGroupsDao 关键词搜索
 * - findAllNodeGroupsDao
 * - findNodeByNameDao
 * - findNodesByIdsDao
 * - findNodesByGroupIdDao
 * - updateNodeStatusDao
 * - batchUpdateNodeGroupDao
 * - getNodeConfigByIdDao
 *
 * **Feature: node-management**
 * **Validates: Requirements 14.1, 14.2, 14.3**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
    createNodeGroupDao,
    findNodeGroupByIdDao,
    findManyNodeGroupsDao,
    findAllNodeGroupsDao,
    updateNodeGroupDao,
    softDeleteNodeGroupDao,
    createNodeDao,
    findNodeByIdDao,
    findNodeByNameDao,
    findNodesByIdsDao,
    findNodesByGroupIdDao,
    findManyNodesDao,
    findAllNodesDao,
    updateNodeDao,
    updateNodeStatusDao,
    softDeleteNodeDao,
    batchUpdateNodeGroupDao,
    getNodeConfigDao,
    getNodeConfigByIdDao,
} from '../../../server/services/node/node.dao'

config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

const testIds = {
    nodeIds: [] as number[],
    groupIds: [] as number[],
    modelIds: [] as number[],
    providerIds: [] as number[],
}

const generateTestId = () => `cov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 设置全局变量
;(globalThis as any).prisma = testPrisma
;(globalThis as any).logger = {
    info: (...args: any[]) => {},
    warn: (...args: any[]) => {},
    error: (...args: any[]) => console.error('[ERROR]', ...args),
    debug: (...args: any[]) => {},
}

const createTestModel = async () => {
    const provider = await testPrisma.modelProviders.create({
        data: { name: `cov_provider_${generateTestId()}`, baseUrl: 'https://api.test.com' },
    })
    testIds.providerIds.push(provider.id)
    const model = await testPrisma.models.create({
        data: {
            name: `cov_model_${generateTestId()}`,
            displayName: '覆盖率测试模型',
            providerId: provider.id,
            modelType: 'chat',
            status: 1,
        },
    })
    testIds.modelIds.push(model.id)
    return { model, provider }
}

describe('节点 DAO 额外覆盖率', () => {
    afterAll(async () => {
        // 按依赖顺序清理
        if (testIds.nodeIds.length > 0) {
            await testPrisma.nodes.deleteMany({ where: { id: { in: testIds.nodeIds } } })
        }
        if (testIds.groupIds.length > 0) {
            await testPrisma.nodeGroups.deleteMany({ where: { id: { in: testIds.groupIds } } })
        }
        if (testIds.modelIds.length > 0) {
            await testPrisma.models.deleteMany({ where: { id: { in: testIds.modelIds } } })
        }
        if (testIds.providerIds.length > 0) {
            await testPrisma.modelProviders.deleteMany({ where: { id: { in: testIds.providerIds } } })
        }
        await testPrisma.$disconnect()
    })

    // ==================== 分组 DAO ====================

    describe('节点分组 DAO', () => {
        it('createNodeGroupDao - 应创建分组', async () => {
            const group = await createNodeGroupDao({
                name: `测试分组_${generateTestId()}`,
                description: '覆盖率测试分组',
                priority: 50,
            })
            testIds.groupIds.push(group.id)
            expect(group.name).toContain('测试分组')
            expect(group.priority).toBe(50)
        })

        it('findNodeGroupByIdDao - 应返回分组', async () => {
            const group = await createNodeGroupDao({ name: `查询分组_${generateTestId()}` })
            testIds.groupIds.push(group.id)

            const found = await findNodeGroupByIdDao(group.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(group.id)
        })

        it('findNodeGroupByIdDao - 不存在时返回 null', async () => {
            const found = await findNodeGroupByIdDao(999999)
            expect(found).toBeNull()
        })

        it('findManyNodeGroupsDao - 关键词搜索', async () => {
            const keyword = `unique_grp_${generateTestId()}`
            const group = await createNodeGroupDao({ name: keyword })
            testIds.groupIds.push(group.id)

            const result = await findManyNodeGroupsDao({ keyword })
            expect(result.list.length).toBeGreaterThanOrEqual(1)
        })

        it('findManyNodeGroupsDao - 分页', async () => {
            const result = await findManyNodeGroupsDao({ page: 1, pageSize: 1 })
            expect(result.list.length).toBeLessThanOrEqual(1)
        })

        it('findAllNodeGroupsDao - 应返回所有分组', async () => {
            const groups = await findAllNodeGroupsDao()
            expect(Array.isArray(groups)).toBe(true)
        })

        it('updateNodeGroupDao - 应更新分组', async () => {
            const group = await createNodeGroupDao({ name: `更新分组_${generateTestId()}` })
            testIds.groupIds.push(group.id)

            const updated = await updateNodeGroupDao(group.id, {
                name: '更新后的名称',
                description: '更新后的描述',
                priority: 99,
            })
            expect(updated.name).toBe('更新后的名称')
            expect(updated.priority).toBe(99)
        })

        it('softDeleteNodeGroupDao - 应软删除分组', async () => {
            const group = await createNodeGroupDao({ name: `删除分组_${generateTestId()}` })
            testIds.groupIds.push(group.id)

            await softDeleteNodeGroupDao(group.id)

            const found = await findNodeGroupByIdDao(group.id)
            expect(found).toBeNull()
        })
    })

    // ==================== 节点 DAO ====================

    describe('findNodeByNameDao', () => {
        it('应通过名称查询节点', async () => {
            const { model } = await createTestModel()
            const nodeName = `cov_node_name_${generateTestId()}`
            const node = await createNodeDao({
                name: nodeName,
                title: '名称查询测试',
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)

            const found = await findNodeByNameDao(nodeName)
            expect(found).not.toBeNull()
            expect(found!.name).toBe(nodeName)
        })

        it('不存在的名称应返回 null', async () => {
            const found = await findNodeByNameDao('non_existent_node_name')
            expect(found).toBeNull()
        })
    })

    describe('findNodesByIdsDao', () => {
        it('应批量查询节点', async () => {
            const { model } = await createTestModel()
            const node1 = await createNodeDao({
                name: `cov_batch_1_${generateTestId()}`,
                title: '批量查询 1',
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node1.id)

            const nodes = await findNodesByIdsDao([node1.id])
            expect(nodes.length).toBeGreaterThanOrEqual(1)
        })

        it('空 ID 列表应返回空数组', async () => {
            const nodes = await findNodesByIdsDao([])
            expect(nodes).toEqual([])
        })
    })

    describe('findNodesByGroupIdDao', () => {
        it('应查询分组下的节点', async () => {
            const group = await createNodeGroupDao({ name: `分组节点_${generateTestId()}` })
            testIds.groupIds.push(group.id)

            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `cov_grp_node_${generateTestId()}`,
                title: '分组节点',
                type: 'analysis',
                modelId: model.id,
                groupId: group.id,
            })
            testIds.nodeIds.push(node.id)

            const nodes = await findNodesByGroupIdDao(group.id)
            expect(nodes.length).toBeGreaterThanOrEqual(1)
        })
    })

    describe('updateNodeStatusDao', () => {
        it('应更新节点状态', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `cov_status_${generateTestId()}`,
                title: '状态更新测试',
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)

            const updated = await updateNodeStatusDao(node.id, 0)
            expect(updated.status).toBe(0)
        })
    })

    describe('batchUpdateNodeGroupDao', () => {
        it('应批量更新节点分组', async () => {
            const group = await createNodeGroupDao({ name: `批量分组_${generateTestId()}` })
            testIds.groupIds.push(group.id)

            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `cov_batch_grp_${generateTestId()}`,
                title: '批量分组测试',
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)

            await batchUpdateNodeGroupDao([node.id], group.id)

            const found = await findNodeByIdDao(node.id)
            expect(found!.groupId).toBe(group.id)
        })

        it('应支持设置 groupId 为 null', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `cov_null_grp_${generateTestId()}`,
                title: '空分组测试',
                type: 'analysis',
                modelId: model.id,
            })
            testIds.nodeIds.push(node.id)

            await batchUpdateNodeGroupDao([node.id], null)

            const found = await findNodeByIdDao(node.id)
            expect(found!.groupId).toBeNull()
        })
    })

    describe('getNodeConfigByIdDao', () => {
        it('应返回节点完整配置', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `cov_config_id_${generateTestId()}`,
                title: '配置查询测试',
                type: 'analysis',
                modelId: model.id,
                status: 1,
            })
            testIds.nodeIds.push(node.id)

            const config = await getNodeConfigByIdDao(node.id)
            expect(config).not.toBeNull()
            expect(config!.model).toBeDefined()
        })

        it('禁用节点应返回 null', async () => {
            const { model } = await createTestModel()
            const node = await createNodeDao({
                name: `cov_disabled_${generateTestId()}`,
                title: '禁用配置测试',
                type: 'analysis',
                modelId: model.id,
                status: 0,
            })
            testIds.nodeIds.push(node.id)
            // 软删除使其 status=0
            await updateNodeStatusDao(node.id, 0)

            const config = await getNodeConfigByIdDao(node.id)
            expect(config).toBeNull()
        })
    })

    describe('findAllNodesDao - 筛选组合', () => {
        it('应按 type 和 status 筛选', async () => {
            const nodes = await findAllNodesDao({ type: 'analysis', status: 1 })
            for (const node of nodes) {
                expect(node.type).toBe('analysis')
                expect(node.status).toBe(1)
            }
        })

        it('应按 groupId 筛选', async () => {
            const nodes = await findAllNodesDao({ groupId: 999999 })
            expect(nodes).toEqual([])
        })
    })
})

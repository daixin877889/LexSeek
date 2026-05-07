/**
 * runAssistantChat 集成测试
 *
 * 验证 assistant 主代理能从 assistantMain 节点读取配置并返回 SSE stream。
 * 不消费 stream，避免真正调用模型（测试环境没有有效的外部 API Key）。
 *
 * **Feature: legal-assistant-phase1**
 * **Validates: Task 8, spec §5.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'

describe('runAssistantChat - 集成', () => {
    let testIds: CaseTestIds

    beforeAll(async () => {
        testIds = createEmptyTestIds()

        // 注意：测试库已通过 seedData.sql 注入了 id=15 的 assistantMain 节点。
        // 这里复用 seed 的 assistantMain，只补充测试专用的 model+provider+apiKey 链路并把
        // 它指向 assistantMain；测试结束 afterAll 仅清自己创建的资源，不动 seed。
        const prisma = getTestPrisma()
        const provider = await prisma.modelProviders.create({
            data: {
                name: `测试提供商_assistant_${Date.now()}`,
                baseUrl: 'https://api.test.com',
                description: 'integration test provider',
            },
        })
        testIds.modelProviderIds.push(provider.id)

        await prisma.modelApiKeys.create({
            data: {
                providerId: provider.id,
                name: `测试密钥_assistant_${Date.now()}`,
                apiKey: `sk-test-assistant-${Date.now()}`,
                isDefault: true, // node DAO 仅查 isDefault=true 的 key
                status: 1,
            },
        })

        const model = await prisma.models.create({
            data: {
                providerId: provider.id,
                name: `test-model-assistant-${Date.now()}`,
                displayName: '测试模型',
                modelType: 'chat',
                sdkType: 'openai',
                contextWindow: 128_000,
                maxOutputTokens: 8192,
                status: 1,
            },
        })
        testIds.modelIds.push(model.id)

        // upsert：seed 中如已有 assistantMain（生产 seedData 一致），把 modelId 切到测试 model；
        // 没有则按测试值创建。afterAll 里只删自己创建的（testIds.nodeIds），不动 seed 节点。
        const node = await prisma.nodes.upsert({
            where: { name: 'assistantMain' },
            update: { modelId: model.id, status: 1 },
            create: {
                name: 'assistantMain',
                title: '通用法律助手主Agent',
                description: '无案件上下文的法律问答与工具调用',
                type: 'agent',
                modelId: model.id,
                tools: [],
                status: 1,
            },
        })
        // 仅追踪本测试创建的节点；如命中已有 seed 节点则不删，避免污染其他测试
        const wasSeedNode = await prisma.nodes.count({
            where: { id: node.id, createdAt: { lt: new Date(Date.now() - 60_000) } },
        })
        if (wasSeedNode === 0) {
            testIds.nodeIds.push(node.id)
        }

        // ★ Phase 6 改造：prompts.nodeId 字段已删，节点关联通过 node_prompts 表维护。
        // 系统 prompt 没有 name 唯一约束，先查后建避免重复，再补 node_prompts 关联。
        const existingPrompt = await prisma.prompts.findFirst({
            where: {
                name: 'assistantMain_system',
                status: 1,
                nodePrompts: { some: { nodeId: node.id } },
            },
        })
        if (!existingPrompt) {
            const created = await prisma.prompts.create({
                data: {
                    name: 'assistantMain_system',
                    title: '通用法律助手系统提示词 v1',
                    content: '你是 LexSeek 的通用法律助手。',
                    version: '1.0',
                    type: 'system',
                    status: 1,
                },
            })
            await prisma.node_prompts.create({
                data: { nodeId: node.id, promptId: created.id, displayOrder: 100 },
            })
        }
    })

    afterEach(async () => {
        // 清理每个用例产生的 session，避免残留
        const prisma = getTestPrisma()
        if (testIds.sessionIds.length > 0) {
            await prisma.caseSessions.deleteMany({
                where: { sessionId: { in: testIds.sessionIds } },
            })
            testIds.sessionIds = []
        }
    })

    afterAll(async () => {
        const prisma = getTestPrisma()
        // prompts 引用 nodes，必须先清理 prompts 才能让 cleanupTestData 删 nodes
        if (testIds.nodeIds.length > 0) {
            await prisma.prompts.deleteMany({
                where: { nodeId: { in: testIds.nodeIds } },
            })
        }
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('从 assistantMain 节点读取配置并返回 SSE stream', async () => {
        const { runAssistantChat } = await import(
            '~~/server/services/workflow/agents/assistantAgent'
        )

        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const sessionId = `integ-assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const prisma = getTestPrisma()
        await prisma.caseSessions.create({
            data: {
                sessionId,
                scope: 'assistant',
                userId: user.id,
                caseId: null,
                status: 1,
                type: 1,
            },
        })
        testIds.sessionIds.push(sessionId)

        const stream = await runAssistantChat(sessionId, '你好', {
            userId: user.id,
            thinking: false,
        })

        // 只验证形态：返回 ReadableStream；不消费内容避免真调模型
        expect(stream).toBeInstanceOf(ReadableStream)

        // 主动取消 stream，释放底层 reader/连接
        if (typeof (stream as any).cancel === 'function') {
            await (stream as any).cancel().catch(() => undefined)
        }
    }, 30_000)
})

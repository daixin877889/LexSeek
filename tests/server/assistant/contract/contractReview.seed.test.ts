import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import '../../case/test-setup'
import { disconnectTestDb, getTestPrisma } from '../../case/test-db-helper'

describe('合同审查 seed 函数', () => {
    const prisma = getTestPrisma()
    let seedContractReviewMainNode: (p: typeof prisma) => Promise<void>
    let seedContractReviewTokenRule: (p: typeof prisma) => Promise<void>

    beforeAll(async () => {
        const seedModule = await import('~~/prisma/seed')
        seedContractReviewMainNode = seedModule.seedContractReviewMainNode
        seedContractReviewTokenRule = seedModule.seedContractReviewTokenRule
        expect(typeof seedContractReviewMainNode).toBe('function')
        expect(typeof seedContractReviewTokenRule).toBe('function')
    })

    afterAll(async () => {
        await prisma.prompts.deleteMany({
            where: { name: 'contractReview_system' },
        })
        await prisma.nodes.deleteMany({
            where: { name: 'contractReviewMain' },
        })
        await prisma.pointConsumptionItems.deleteMany({
            where: { key: 'contract_review_token' },
        })
        await disconnectTestDb()
    })

    it('seedContractReviewMainNode 幂等写入节点与提示词', async () => {
        await seedContractReviewMainNode(prisma as any)
        await seedContractReviewMainNode(prisma as any)

        const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
        expect(node).not.toBeNull()
        expect(node?.type).toBe('agent')
        expect(node?.priority).toBe(40)
        expect(node?.tools).toEqual(['parseAndAskStance'])
        expect(node?.status).toBe(1)
        expect(node?.modelId).not.toBeNull()

        const prompts = await prisma.prompts.findMany({
            where: { nodeId: node!.id, type: 'system', version: 'v1', deletedAt: null },
        })
        expect(prompts).toHaveLength(1)
        expect(prompts[0].name).toBe('contractReview_system')
    })

    it('seedContractReviewTokenRule 幂等写入积分规则', async () => {
        await seedContractReviewTokenRule(prisma as any)
        await seedContractReviewTokenRule(prisma as any)

        const row = await prisma.pointConsumptionItems.findUnique({
            where: { key: 'contract_review_token' },
        })
        expect(row).not.toBeNull()
        expect(row?.group).toBe('agentToken')
        expect(row?.unit).toBe('千tokens')
        expect(row?.status).toBe(1)
    })
})

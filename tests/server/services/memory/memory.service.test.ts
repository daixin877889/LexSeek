import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

describe('memory.service - calculation 扩展', () => {
    const createdIds: string[] = []
    let testCaseId = 0
    let testUserId = 0
    let testCaseTypeId = 0

    beforeAll(async () => {
        const suffix = Date.now().toString().slice(-8)

        const user = await prisma.users.create({
            data: {
                name: `calc_mem_user_${suffix}`,
                phone: `188${suffix}`,
                password: 'test_hash',
                status: 1,
            },
        })
        testUserId = user.id

        const caseType = await prisma.caseTypes.create({
            data: {
                name: `计算记忆测试类型_${suffix}_${Math.random().toString(36).slice(2, 8)}`,
                priority: 999,
                status: 1,
            },
        })
        testCaseTypeId = caseType.id

        const c = await prisma.cases.create({
            data: {
                title: '[test] calc memory',
                userId: testUserId,
                caseTypeId: testCaseTypeId,
                status: 1,
            },
        })
        testCaseId = c.id
    })

    afterAll(async () => {
        // 先删记忆，再删案件
        await prisma.$executeRawUnsafe(
            `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
            testCaseId.toString(),
        )
        await prisma.cases.delete({ where: { id: testCaseId } }).catch(() => {})
        await prisma.caseTypes.delete({ where: { id: testCaseTypeId } }).catch(() => {})
        await prisma.users.delete({ where: { id: testUserId } }).catch(() => {})
    })

    afterEach(async () => {
        // 精确清理本 case 产生的记忆（版本链中旧记录也会被 afterAll 清理，这里做增量保护）
        if (createdIds.length > 0) {
            await prisma.$executeRawUnsafe(
                `DELETE FROM case_memories WHERE id = ANY($1::uuid[])`,
                createdIds,
            )
            createdIds.length = 0
        }
    })

    it('writeMemoryService extraMetadata.calculation 透传到 metadata JSONB', async () => {
        const { id } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 测试',
            subjectKey: 'calculation:test_tool',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_tool',
                    input: { foo: 1 },
                    output: { bar: 2 },
                    calculatedAt: '2026-05-14T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id)

        const rows = await prisma.$queryRaw<Array<{ metadata: any }>>`
            SELECT metadata FROM case_memories WHERE id = ${id}::uuid
        `
        expect(rows[0]?.metadata?.calculation?.tool).toBe('test_tool')
        expect(rows[0]?.metadata?.calculation?.input).toEqual({ foo: 1 })
    })

    it('findLastCalculationByCase 通过版本链返回最新一条', async () => {
        const { id: id1 } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 旧',
            subjectKey: 'calculation:test_find',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_find',
                    input: { v: 100 },
                    output: { t: 100 },
                    calculatedAt: '2026-05-13T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id1)

        const { id: id2 } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 新',
            subjectKey: 'calculation:test_find',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_find',
                    input: { v: 200 },
                    output: { t: 200 },
                    calculatedAt: '2026-05-14T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id2)

        const last = await findLastCalculationByCase(testCaseId, 'test_find')
        expect(last?.input).toEqual({ v: 200 })
    })

    it('findLastCalculationByCase 无记录时返回 null', async () => {
        const r = await findLastCalculationByCase(testCaseId, 'definitely_not_exist')
        expect(r).toBeNull()
    })
})

/**
 * GET /api/v1/cases/active · service 集成测试（真实 DB）
 *
 * 阶段 5 · 法律助手关联案件 Dialog（CaseLinkerDialog）依赖此接口拉取
 * 用户名下进行中（非归档、非软删）案件列表。
 *
 * **Feature: ai-unify-stage-5**
 * **Validates: Task 8 · 用户端「我的进行中案件」列表 API**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CaseStatus } from '#shared/types/case'
import { getActiveCasesService } from '~~/server/services/case/case.service'
import { createTestUser, createTestCaseType } from './test-db-helper'

// 测试用户 / 案件类型 id 在 worker DB 中并非固定 1/2/1，运行前动态创建（对齐其他 case 测试）
let TEST_USER_ID: number
let OTHER_USER_ID: number
let TEST_CASE_TYPE_ID: number
const createdUserIds: number[] = []
const createdCaseTypeIds: number[] = []

interface CleanupRow { id: number }

const created: CleanupRow[] = []

async function createCase(
    userId: number,
    title: string,
    status: CaseStatus,
    overrides: { deletedAt?: Date | null } = {},
): Promise<number> {
    const row = await prisma.cases.create({
        data: {
            title,
            content: null,
            userId,
            caseTypeId: TEST_CASE_TYPE_ID,
            status,
            ...(overrides.deletedAt !== undefined ? { deletedAt: overrides.deletedAt } : {}),
        },
        select: { id: true },
    })
    created.push(row)
    return row.id
}

describe('GET /api/v1/cases/active · 进行中案件列表（service 层）', () => {
    let activeId1: number
    let activeId2: number
    let archivedId: number
    let deletedId: number
    let otherUserCaseId: number

    beforeAll(async () => {
        // 动态创建用户/案件类型，避免硬编码 id（worker DB 自增）
        const me = await createTestUser()
        const other = await createTestUser()
        TEST_USER_ID = me.id
        OTHER_USER_ID = other.id
        createdUserIds.push(me.id, other.id)

        const ct = await createTestCaseType()
        TEST_CASE_TYPE_ID = ct.id
        createdCaseTypeIds.push(ct.id)

        // 当前用户名下：2 个进行中（咨询 + 一审）
        activeId1 = await createCase(TEST_USER_ID, 'Stage5活跃_合同纠纷_咨询', CaseStatus.CONSULTING)
        activeId2 = await createCase(TEST_USER_ID, 'Stage5活跃_劳动争议_一审', CaseStatus.FIRST_TRIAL)
        // 已归档（应被排除）
        archivedId = await createCase(TEST_USER_ID, 'Stage5归档_测试', CaseStatus.ARCHIVED)
        // 已软删（应被排除）
        deletedId = await createCase(
            TEST_USER_ID,
            'Stage5软删_测试',
            CaseStatus.CONSULTING,
            { deletedAt: new Date() },
        )
        // 他人案件（应被排除）
        otherUserCaseId = await createCase(OTHER_USER_ID, 'Stage5他人_测试', CaseStatus.CONSULTING)
    })

    afterAll(async () => {
        if (created.length > 0) {
            await prisma.cases.deleteMany({
                where: { id: { in: created.map(r => r.id) } },
            })
        }
        if (createdCaseTypeIds.length > 0) {
            await prisma.caseTypes.deleteMany({ where: { id: { in: createdCaseTypeIds } } })
        }
        if (createdUserIds.length > 0) {
            await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        }
    })

    it('owner-only：仅返回当前用户名下的案件', async () => {
        const items = await getActiveCasesService(TEST_USER_ID)
        const ids = items.map(i => i.id)
        expect(ids).toContain(activeId1)
        expect(ids).toContain(activeId2)
        expect(ids).not.toContain(otherUserCaseId)
    })

    it('排除已软删案件', async () => {
        const items = await getActiveCasesService(TEST_USER_ID)
        const ids = items.map(i => i.id)
        expect(ids).not.toContain(deletedId)
    })

    it('排除已归档案件（status=ARCHIVED）', async () => {
        const items = await getActiveCasesService(TEST_USER_ID)
        const ids = items.map(i => i.id)
        expect(ids).not.toContain(archivedId)
    })

    it('q 关键词模糊匹配 title', async () => {
        const items = await getActiveCasesService(TEST_USER_ID, { q: '劳动争议' })
        const ids = items.map(i => i.id)
        expect(ids).toContain(activeId2)
        expect(ids).not.toContain(activeId1)
    })

    it('返回字段精简：只含 id 和 title', async () => {
        const items = await getActiveCasesService(TEST_USER_ID, { q: '合同纠纷' })
        const hit = items.find(i => i.id === activeId1)
        expect(hit).toBeDefined()
        expect(Object.keys(hit!).sort()).toEqual(['id', 'title'])
    })
})

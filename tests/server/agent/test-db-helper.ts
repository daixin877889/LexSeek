/**
 * Agent 模块测试数据库辅助
 *
 * 提供测试数据的创建和清理功能
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL 环境变量未设置')
  }
  const pool = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter: pool })
}

let _testPrisma: ReturnType<typeof createTestPrismaClient> | null = null

export const getTestPrisma = () => {
  if (!_testPrisma) {
    _testPrisma = createTestPrismaClient()
  }
  return _testPrisma
}

export const testPrisma = new Proxy({} as ReturnType<typeof createTestPrismaClient>, {
  get(_, prop) {
    return (getTestPrisma() as any)[prop]
  },
})

/** 测试用户手机号前缀 */
export const TEST_PHONE_PREFIX = '198'

/** 追踪测试数据 ID */
export interface AgentTestIds {
  userIds: number[]
  caseIds: number[]
  sessionIds: string[]
  caseTypeIds: number[]
  agentRunIds: string[]
}

export const createEmptyTestIds = (): AgentTestIds => ({
  userIds: [],
  caseIds: [],
  sessionIds: [],
  caseTypeIds: [],
  agentRunIds: [],
})

/** 创建测试用户 */
export async function createTestUser(phone?: string) {
  const p = getTestPrisma()
  return p.users.create({
    data: {
      phone: phone ?? `${TEST_PHONE_PREFIX}${Date.now().toString().slice(-8)}`,
      name: `测试用户_${Date.now()}`,
      password: 'test_hash',
      status: 1,
    },
  })
}

/** 创建测试案件类型 */
export async function createTestCaseType() {
  const p = getTestPrisma()
  return p.caseTypes.create({
    data: {
      name: `测试类型_${Date.now()}`,
      status: 1,
    },
  })
}

/** 创建测试案件 */
export async function createTestCase(userId: number, caseTypeId: number) {
  const p = getTestPrisma()
  return p.cases.create({
    data: {
      title: `测试案件_${Date.now()}`,
      userId,
      caseTypeId,
      status: 1,
    },
  })
}

/** 创建测试会话 */
export async function createTestSession(caseId: number) {
  const p = getTestPrisma()
  const sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const session = await p.caseSessions.create({
    data: {
      sessionId,
      caseId,
      status: 1,
    },
  })
  return { ...session, sessionId }
}

/** 清理测试数据（按依赖顺序删除） */
export async function cleanupTestData(ids: AgentTestIds) {
  const p = getTestPrisma()

  if (ids.agentRunIds.length > 0) {
    await p.agentRuns.deleteMany({ where: { id: { in: ids.agentRunIds } } })
  }
  if (ids.sessionIds.length > 0) {
    // caseAnalyses 通过 sessionId 引用 caseSessions，需先删除
    await p.caseAnalyses.deleteMany({ where: { sessionId: { in: ids.sessionIds } } })
    await p.caseSessions.deleteMany({ where: { sessionId: { in: ids.sessionIds } } })
  }
  if (ids.caseIds.length > 0) {
    await p.caseAnalyses.deleteMany({ where: { caseId: { in: ids.caseIds } } })
    // 删除所有 case_materials（无论是通过 case_id 还是 draft_id 引用的）
    await p.caseMaterials.deleteMany({ where: { caseId: { in: ids.caseIds } } })
    // 删除所有引用这些 document_drafts 的 case_materials（以防有其他方式的引用）
    await (p as any).$executeRaw`DELETE FROM case_materials WHERE draft_id IN (SELECT id FROM document_drafts WHERE case_id = ANY(${ids.caseIds}::integer[]))`
    await p.caseSessions.deleteMany({ where: { caseId: { in: ids.caseIds } } })

    // 删除与案件关联的 document_drafts
    await (p as any).$executeRaw`DELETE FROM document_draft_snapshots WHERE draft_id IN (SELECT id FROM document_drafts WHERE case_id = ANY(${ids.caseIds}::integer[]))`
    await (p as any).$executeRaw`DELETE FROM document_draft_versions WHERE draft_id IN (SELECT id FROM document_drafts WHERE case_id = ANY(${ids.caseIds}::integer[]))`
    await (p as any).$executeRaw`DELETE FROM document_drafts WHERE case_id = ANY(${ids.caseIds}::integer[])`

    await p.cases.deleteMany({ where: { id: { in: ids.caseIds } } })
  }
  if (ids.caseTypeIds.length > 0) {
    await p.caseTypes.deleteMany({ where: { id: { in: ids.caseTypeIds } } })
  }
  if (ids.userIds.length > 0) {
    // 删除用户关联的 document_templates
    await (p as any).$executeRaw`DELETE FROM document_templates WHERE user_id = ANY(${ids.userIds}::integer[])`
    await p.users.deleteMany({ where: { id: { in: ids.userIds } } })
  }
}

/** 断开测试数据库连接 */
export async function disconnectTestDb() {
  if (_testPrisma) {
    await _testPrisma.$disconnect()
    _testPrisma = null
  }
}

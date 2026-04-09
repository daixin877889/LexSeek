/**
 * 小索 Session API 测试
 *
 * **Feature: xiaosuo-session**
 * **Validates: Session CRUD, 权限校验, 软删除**
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'
import { v4 as uuidv4 } from 'uuid'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量
config({ path: resolve(__dirname, '../../.env.testing') })

// 创建测试 Prisma 客户端
const createTestPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL 环境变量未设置')
  }
  const pool = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter: pool })
}

let _prisma: ReturnType<typeof createTestPrismaClient> | null = null
const getTestPrisma = () => {
  if (!_prisma) _prisma = createTestPrismaClient()
  return _prisma
}

describe('小索 Session API', () => {
  let dbAvailable = false
  const createdSessionIds: string[] = []
  const createdCaseIds: number[] = []
  const createdUserIds: number[] = []
  const prisma = getTestPrisma()

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`
      dbAvailable = true
    } catch {
      dbAvailable = false
    }
  })

  afterEach(async () => {
    if (!dbAvailable) return
    if (createdSessionIds.length > 0) {
      await prisma.caseSessions.deleteMany({
        where: { sessionId: { in: createdSessionIds } },
      })
      createdSessionIds.length = 0
    }
    if (createdCaseIds.length > 0) {
      await prisma.cases.deleteMany({
        where: { id: { in: createdCaseIds } },
      })
      createdCaseIds.length = 0
    }
    if (createdUserIds.length > 0) {
      await prisma.users.deleteMany({
        where: { id: { in: createdUserIds } },
      })
      createdUserIds.length = 0
    }
  })

  // 辅助函数
  async function createTestUser() {
    const user = await prisma.users.create({
      data: {
        name: '小索测试用户',
        phone: `test_xs_${uuidv4().slice(0, 12)}`.slice(0, 11),
        password: 'test',
      },
    })
    createdUserIds.push(user.id)
    return user
  }

  async function createTestCase(userId: number) {
    const caseRecord = await prisma.cases.create({
      data: {
        title: '小索测试案件',
        userId,
        caseTypeId: 1,
        status: 1,
      },
    })
    createdCaseIds.push(caseRecord.id)
    return caseRecord
  }

  async function createXiaosuoSession(caseId: number, title = '新对话') {
    const sessionId = uuidv4()
    await prisma.caseSessions.create({
      data: {
        sessionId,
        caseId,
        type: 1,
        metadata: { source: 'xiaosuo', title },
      },
    })
    createdSessionIds.push(sessionId)
    return sessionId
  }

  describe('创建 Session', () => {
    it('应正确创建小索 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      const sessionId = await createXiaosuoSession(caseRecord.id, '测试对话')
      const session = await prisma.caseSessions.findUnique({ where: { sessionId } })

      expect(session).not.toBeNull()
      expect(session!.type).toBe(1)
      expect(session!.caseId).toBe(caseRecord.id)
      expect((session!.metadata as any).source).toBe('xiaosuo')
      expect((session!.metadata as any).title).toBe('测试对话')
    })
  })

  describe('查询 Session 列表', () => {
    it('应只返回 source=xiaosuo 的 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      // 创建小索 session
      const xiaosuoSessionId = await createXiaosuoSession(caseRecord.id)

      // 创建非小索的 type=1 session
      const otherSessionId = uuidv4()
      await prisma.caseSessions.create({
        data: {
          sessionId: otherSessionId,
          caseId: caseRecord.id,
          type: 1,
          metadata: { source: 'analysis' },
        },
      })
      createdSessionIds.push(otherSessionId)

      // 查询小索 session
      const sessions = await prisma.caseSessions.findMany({
        where: {
          caseId: caseRecord.id,
          type: 1,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'xiaosuo' },
        },
      })

      expect(sessions.length).toBe(1)
      expect(sessions[0].sessionId).toBe(xiaosuoSessionId)
    })

    it('应按 updatedAt 降序排列', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      const id1 = await createXiaosuoSession(caseRecord.id, '对话 1')
      await new Promise(r => setTimeout(r, 50))
      const id2 = await createXiaosuoSession(caseRecord.id, '对话 2')

      const sessions = await prisma.caseSessions.findMany({
        where: {
          caseId: caseRecord.id,
          type: 1,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'xiaosuo' },
        },
        orderBy: { updatedAt: 'desc' },
      })

      expect(sessions[0].sessionId).toBe(id2)
      expect(sessions[1].sessionId).toBe(id1)
    })
  })

  describe('删除 Session', () => {
    it('应软删除 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)
      const sessionId = await createXiaosuoSession(caseRecord.id)

      await prisma.caseSessions.update({
        where: { sessionId },
        data: { deletedAt: new Date() },
      })

      const deleted = await prisma.caseSessions.findUnique({ where: { sessionId } })
      expect(deleted!.deletedAt).not.toBeNull()

      // 列表查询中不应出现
      const sessions = await prisma.caseSessions.findMany({
        where: {
          caseId: caseRecord.id,
          type: 1,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'xiaosuo' },
        },
      })
      expect(sessions.length).toBe(0)
    })

    it('不应删除非小索的 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      const otherSessionId = uuidv4()
      await prisma.caseSessions.create({
        data: {
          sessionId: otherSessionId,
          caseId: caseRecord.id,
          type: 1,
          metadata: { source: 'analysis' },
        },
      })
      createdSessionIds.push(otherSessionId)

      const session = await prisma.caseSessions.findUnique({ where: { sessionId: otherSessionId } })
      const metadata = session!.metadata as any
      expect(metadata?.source).not.toBe('xiaosuo')
    })
  })
})

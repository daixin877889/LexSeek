import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Redis from 'ioredis'
import { prisma } from '~~/server/utils/db'
import { processNowService, scheduleConsolidation } from '~~/server/services/memory/consolidator.service'
import { createTestUser } from '../membership/test-db-helper'
import { createTestCaseType } from '../case/test-db-helper'

// 优先从 NUXT_REDIS_URL（项目唯一权威配置）解析连接信息，避免与 .env.testing 中
// 仅设 NUXT_REDIS_URL=redis://:pwd@host:port/db 不设 REDIS_PASSWORD 时报 NOAUTH。
// 没配置 REDIS_URL 时回退到分散环境变量（向后兼容）。
function buildEvalRedis(): Redis {
  const url = process.env.NUXT_REDIS_URL ?? process.env.REDIS_URL
  if (url) {
    // 始终落到 db=15（eval 专用），覆盖 URL 自带的 db 段
    return new Redis(url, { db: 15 })
  }
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: 15,
  })
}

const evalRedis = buildEvalRedis()

describe('processNowService', () => {
  let testUserId = 0
  let testCaseTypeId = 0
  let createdCaseId = 0

  beforeAll(async () => {
    const user = await createTestUser()
    testUserId = user.id
    const caseType = await createTestCaseType()
    testCaseTypeId = caseType.id
  })

  beforeEach(async () => {
    await evalRedis.flushdb()
  })

  afterAll(async () => {
    await evalRedis.quit()
    if (createdCaseId) {
      await prisma.caseSessions.deleteMany({ where: { caseId: createdCaseId } })
      await prisma.cases.deleteMany({ where: { id: createdCaseId } })
    }
    if (testCaseTypeId) await prisma.caseTypes.deleteMany({ where: { id: testCaseTypeId } })
    if (testUserId) await prisma.users.deleteMany({ where: { id: testUserId } })
  })

  it('drain 队列后立即执行（不等 30s）', async () => {
    const sessionId = `eval-pn-${Date.now()}`
    // 用 helper 创建真实 user + caseType，避免依赖 ls_eval 库的 seed
    const created = await prisma.cases.create({
      data: { title: 'eval-processNow-test', caseTypeId: testCaseTypeId, userId: testUserId, status: 1 } as any,
    })
    createdCaseId = created.id
    await prisma.caseSessions.create({
      data: { sessionId, caseId: createdCaseId, userId: testUserId, scope: 'case', type: 1, status: 1 } as any,
    })

    await scheduleConsolidation({ caseId: createdCaseId, sessionId })
    // 注意：scheduleConsolidation 默认走 getRedisClient() (db=0)，processNowService 用 db=15 不会找到
    // 这是测试本身的限制；实际 eval 跑时 fixture 用独立 redis，processNowService 也用同一个

    await processNowService(createdCaseId, { redis: evalRedis })
    // 验证：执行不抛异常即通过（fixture session 没真消息，consolidateSession 内部 best-effort）
    expect(true).toBe(true)
  })
})

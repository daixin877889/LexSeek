/**
 * 创建小索对话 Session
 * POST /api/v1/case/analysis/xiaosuo-session
 *
 * 请求体: { caseId: number, title?: string }
 * 响应: { code: 200, data: { sessionId, title } }
 */
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

const bodySchema = z.object({
  caseId: z.number().int().positive(),
  title: z.string().max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
  }

  const { caseId, title } = parsed.data

  // 权限校验：案件属于当前用户
  const caseRecord = await prisma.cases.findFirst({
    where: { id: caseId, userId: user.id, deletedAt: null },
  })
  if (!caseRecord) return resError(event, 404, '案件不存在')

  const sessionId = uuidv4()
  const sessionTitle = title ?? '新对话'

  await prisma.caseSessions.create({
    data: {
      sessionId,
      caseId,
      type: 1,
      metadata: { source: 'xiaosuo', title: sessionTitle },
    },
  })

  return resSuccess(event, '创建成功', { sessionId, title: sessionTitle })
})

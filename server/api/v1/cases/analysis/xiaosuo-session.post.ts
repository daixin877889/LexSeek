/**
 * 创建小索对话 Session
 * POST /api/v1/cases/analysis/xiaosuo-session
 *
 * 请求体: { caseId: number, title?: string }
 * 响应: { code: 200, data: { sessionId, title } }
 *
 * 标题策略：数据库只存时间戳部分（YYMMDDHHmm），"小索"前缀由前端 UI
 * （SessionListPopover 的 titlePrefix）负责显示。重命名时只修改时间戳部分。
 */
import { z } from 'zod'
import dayjs from 'dayjs'
import { createSessionDAO } from '~~/server/services/case/session.dao'

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
  // 默认标题：纯时间戳 YYMMDDHHmm（前缀由 UI 负责）
  const sessionTitle = title ?? dayjs().format('YYMMDDHHmm')

  const result = await createSessionDAO({
    caseId,
    userId: user.id,
    type: 1,
    metadata: { source: 'xiaosuo', title: sessionTitle },
    dedupeKey: `${user.id}:${caseId}:xiaosuo`,
  })
  if (!result) return resError(event, 404, '案件不存在')

  return resSuccess(event, '创建成功', { sessionId: result.sessionId, title: sessionTitle })
})

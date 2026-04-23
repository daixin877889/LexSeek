/**
 * 更新案件状态（含归档）
 *
 * PATCH /api/v1/case/[caseId]
 *
 * 仅允许更新 status 字段；归档（status=999）后案件变为只读。
 * updateCaseService 内置 ARCHIVED 守卫，归档后再次调用会返回 403。
 */
import { z } from 'zod'
import { CaseStatus } from '#shared/types/case'
import { validateCaseAccessService, updateCaseService } from '~~/server/services/case/case.service'

const bodySchema = z.object({
  status: z.nativeEnum(CaseStatus),
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const caseIdStr = getRouterParam(event, 'caseId')
  const caseId = Number.parseInt(caseIdStr || '', 10)
  if (Number.isNaN(caseId) || caseId <= 0) return resError(event, 400, '无效的案件 ID')

  const body = await readBody(event)
  const result = bodySchema.safeParse(body)
  if (!result.success) return resError(event, 400, result.error.issues[0]?.message ?? '参数校验失败')

  try {
    await validateCaseAccessService(caseId, user.id)
    await updateCaseService(caseId, { status: result.data.status })
    return resSuccess(event, '更新成功', { id: caseId })
  }
  catch (error: any) {
    logger.error('更新案件状态失败', { caseId, error: error.message })
    if (error.message === '无权访问该案件') return resError(event, 403, error.message)
    if (error.message === '案件已归档，不可编辑') return resError(event, 403, error.message)
    return resError(event, 500, '更新失败')
  }
})

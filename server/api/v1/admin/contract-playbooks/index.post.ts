/**
 * POST /api/v1/admin/contract-playbooks
 *
 * 管理端新增清单要点。defaultLevel / stancePreference 走 zod 枚举校验。
 * (contractType, code) 唯一；重复会被 Prisma unique 约束拦截 → 返回 409。
 */
import { z } from 'zod'
import { CONTRACT_TYPE_OPTIONS } from '#shared/types/contract'
import { createPlaybookDAO } from '~~/server/services/assistant/contract/contractPlaybook.dao'

const BodySchema = z.object({
    contractType: z.enum(CONTRACT_TYPE_OPTIONS),
    code: z.string().min(1).max(20).regex(/^[a-z0-9_]+$/, 'code 仅支持小写字母数字下划线'),
    title: z.string().min(1).max(30),
    defaultLevel: z.enum(['high', 'medium', 'low']),
    stancePreference: z.enum(['strict', 'balanced', 'lenient']).default('balanced'),
    checkContent: z.string().min(1).max(500),
    legalBasis: z.string().max(300).optional(),
    suggestion: z.string().max(500).optional(),
    enabled: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const row = await createPlaybookDAO(parsed.data)
        return resSuccess(event, '新增要点成功', row)
    } catch (error: unknown) {
        const prismaError = error as { code?: string; message?: string }
        if (prismaError?.code === 'P2002') {
            return resError(event, 409, '该合同类型下已存在相同 code 的要点')
        }
        const msg = error instanceof Error ? error.message : '未知错误'
        logger.error('[admin] 新增清单要点失败', { userId: user.id, error: msg })
        return resError(event, 500, msg || '新增要点失败')
    }
})

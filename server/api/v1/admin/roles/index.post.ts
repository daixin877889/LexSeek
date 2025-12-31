/**
 * 创建角色
 * POST /api/v1/admin/roles
 */
import { z } from 'zod'

const bodySchema = z.object({
    name: z.string().min(1, '角色名称不能为空').max(50),
    code: z.string().min(1, '角色代码不能为空').max(50).regex(/^[a-z_]+$/, '角色代码只能包含小写字母和下划线'),
    description: z.string().max(200).optional(),
    status: z.number().int().min(0).max(1).default(1),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { name, code, description, status } = result.data

    // 检查角色代码是否已存在
    const existing = await prisma.roles.findFirst({
        where: { code, deletedAt: null },
    })
    if (existing) {
        return resError(event, 400, '角色代码已存在')
    }

    // 创建角色
    const role = await prisma.roles.create({
        data: { name, code, description, status },
    })

    // 记录审计日志
    await logRoleCreate(event, user.id, role.id, { name, code, description, status })

    return resSuccess(event, '创建成功', role)
})

/**
 * 创建角色
 * POST /api/v1/admin/roles
 *
 * 安全模型：仅超管可调用——只有超管能扩张系统的角色枚举。
 * code 限定为小写字母 + 下划线，禁止显式创建 super_admin（系统保留代码）。
 */
import { z } from 'zod'
import { logRoleCreate } from '~~/server/services/rbac/auditLog.service'
import { requireSuperAdminGuard } from '~~/server/services/rbac/guard.service'

const bodySchema = z.object({
    name: z.string({ message: '角色名称不能为空' }).min(1, '角色名称不能为空').max(50, '角色名称不能超过50个字符'),
    code: z.string({ message: '角色代码不能为空' })
        .min(1, '角色代码不能为空')
        .max(50, '角色代码不能超过50个字符')
        .regex(/^[a-z_]+$/, '角色代码只能包含小写字母和下划线'),
    description: z.string().max(200, '描述不能超过200个字符').optional(),
    status: z.number({ message: '状态必须是数字' }).int('状态必须是整数').min(0, '状态值无效').max(1, '状态值无效').default(1),
})

export default defineEventHandler(async (event) => {
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response
    const operatorId = guard.userId

    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { name, code, description, status } = result.data

    // 系统保留代码：禁止用户用接口创建 super_admin
    if (code === 'super_admin') {
        return resError(event, 400, 'super_admin 是系统保留代码，禁止使用')
    }

    // 检查代码 / 名称唯一（包括已软删的，避免 (code, deletedAt:null) 唯一索引冲突）
    const existing = await prisma.roles.findFirst({
        where: {
            OR: [{ code }, { name }],
            deletedAt: null,
        },
    })
    if (existing) {
        return resError(event, 400, existing.code === code ? '角色代码已存在' : '角色名称已存在')
    }

    const role = await prisma.roles.create({
        data: { name, code, description, status },
    })

    await logRoleCreate(event, operatorId, role.id, { name, code, description, status })

    return resSuccess(event, '创建成功', role)
})

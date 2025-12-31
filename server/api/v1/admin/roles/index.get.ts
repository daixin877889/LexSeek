/**
 * 获取角色列表
 * GET /api/v1/admin/roles
 */
import { z } from 'zod'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误')
    }

    const { page, pageSize, keyword, status } = result.data

    // 构建查询条件
    const where: any = { deletedAt: null }
    if (keyword) {
        where.OR = [
            { name: { contains: keyword } },
            { code: { contains: keyword } },
            { description: { contains: keyword } },
        ]
    }
    if (status !== undefined) {
        where.status = status
    }

    // 查询数据
    const [items, total] = await Promise.all([
        prisma.roles.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { userRoles: true, roleApiPermissions: true },
                },
            },
        }),
        prisma.roles.count({ where }),
    ])

    return resSuccess(event, '获取成功', {
        items: items.map(item => ({
            ...item,
            userCount: item._count.userRoles,
            apiPermissionCount: item._count.roleApiPermissions,
            _count: undefined,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    })
})

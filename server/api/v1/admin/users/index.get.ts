/**
 * 获取用户列表（含角色信息）
 * GET /api/v1/admin/users
 */
import { z } from 'zod'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    roleId: z.coerce.number().int().optional(),
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

    const { page, pageSize, keyword, roleId, status } = result.data

    // 构建查询条件
    const where: any = {}
    if (keyword) {
        where.OR = [
            { name: { contains: keyword } },
            { phone: { contains: keyword } },
        ]
    }
    if (status !== undefined) {
        where.status = status
    }
    if (roleId !== undefined) {
        where.userRoles = {
            some: { roleId },
        }
    }

    // 查询数据
    const [items, total] = await Promise.all([
        prisma.users.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                phone: true,
                status: true,
                createdAt: true,
                userRoles: {
                    include: {
                        role: {
                            select: { id: true, name: true, code: true },
                        },
                    },
                },
            },
        }),
        prisma.users.count({ where }),
    ])

    return resSuccess(event, '获取成功', {
        items: items.map(item => ({
            ...item,
            roles: item.userRoles.map(ur => ur.role),
            userRoles: undefined,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    })
})

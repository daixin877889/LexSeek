/**
 * 获取角色列表
 * GET /api/v1/admin/roles
 *
 * 注意：_count 必须叠加 deletedAt:null，否则会把已撤销的关联也算进去，
 * 导致后台展示"该角色还有 N 个用户绑定"为脏数据，进一步影响"删除前检查"。
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
                    select: {
                        // 必须过滤软删，否则计数失真
                        userRoles: { where: { deletedAt: null } },
                        roleApiPermissions: { where: { deletedAt: null } },
                    },
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

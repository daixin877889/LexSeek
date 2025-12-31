/**
 * 获取路由权限列表
 * GET /api/v1/admin/routers
 */
import { z } from 'zod'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    groupId: z.coerce.number().int().optional(),
    isMenu: z.enum(['true', 'false']).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const query = getQuery(event)
    const parsed = querySchema.safeParse(query)
    if (!parsed.success) {
        return resError(event, 400, '参数错误')
    }

    const { page, pageSize, keyword, groupId, isMenu } = parsed.data

    // 构建查询条件
    const where: any = {
        deletedAt: null,
    }

    if (keyword) {
        where.OR = [
            { name: { contains: keyword, mode: 'insensitive' } },
            { title: { contains: keyword, mode: 'insensitive' } },
            { path: { contains: keyword, mode: 'insensitive' } },
        ]
    }

    if (groupId !== undefined) {
        where.groupId = groupId
    }

    if (isMenu !== undefined) {
        where.isMenu = isMenu === 'true'
    }

    // 查询总数
    const total = await prisma.routers.count({ where })

    // 查询列表
    const items = await prisma.routers.findMany({
        where,
        include: {
            routerGroups: {
                select: { id: true, name: true },
            },
            parent: {
                select: { id: true, name: true, title: true },
            },
        },
        orderBy: [{ groupId: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
    })

    return resSuccess(event, '获取成功', {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    })
})

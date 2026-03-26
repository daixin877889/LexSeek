/**
 * 更新路由权限
 * PUT /api/v1/admin/routers/:id
 */
import { z } from 'zod'

const bodySchema = z.object({
    isMenu: z.boolean().optional(),
    sort: z.number({ message: '排序值必须是数字' }).int('排序值必须是整数').min(0, '排序值必须为非负整数').optional(),
    title: z.string().min(1, '标题不能为空').max(100, '标题不能超过100个字符').optional(),
    icon: z.string().max(100, '图标不能超过100个字符').nullable().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的路由 ID')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
    }

    // 查询现有路由
    const existing = await prisma.routers.findFirst({
        where: { id, deletedAt: null },
    })
    if (!existing) {
        return resError(event, 404, '路由不存在')
    }

    const updateData = result.data

    // 更新路由
    const router = await prisma.routers.update({
        where: { id },
        data: {
            ...updateData,
            updatedAt: new Date(),
        },
        include: {
            routerGroups: {
                select: { id: true, name: true },
            },
            parent: {
                select: { id: true, name: true, title: true },
            },
        },
    })

    return resSuccess(event, '更新成功', router)
})

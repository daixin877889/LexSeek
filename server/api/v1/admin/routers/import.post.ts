/**
 * 批量导入路由权限
 * 
 * POST /api/v1/admin/routers/import
 */

import { z } from 'zod'

const importSchema = z.object({
    items: z.array(z.object({
        path: z.string({ message: '路径不能为空' }).min(1, '路径不能为空'),
        name: z.string({ message: '名称不能为空' }).min(1, '名称不能为空'),
        title: z.string({ message: '标题不能为空' }).min(1, '标题不能为空'),
        group: z.string().optional(),
        isMenu: z.boolean().optional().default(false),
    })).min(1, '至少选择一个路由'),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const body = await readBody(event)
    const result = importSchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
    }

    const { items } = result.data

    try {
        // 查询已存在的路由路径
        const existingRouters = await prisma.routers.findMany({
            where: {
                path: { in: items.map(i => i.path) },
                deletedAt: null,
            },
            select: { path: true },
        })
        const existingPaths = new Set(existingRouters.map(r => r.path))

        // 过滤出新路由
        const newItems = items.filter(item => !existingPaths.has(item.path))

        if (newItems.length === 0) {
            return resSuccess(event, '没有新路由需要导入', { imported: 0, skipped: items.length })
        }

        // 获取或创建路由组（批量查询 + 批量创建，避免 N+1）
        const groupNames = [...new Set(newItems.map(i => i.group).filter(Boolean))] as string[]
        const groupMap = new Map<string, number>()

        if (groupNames.length > 0) {
            const existingGroups = await prisma.routerGroups.findMany({
                where: { name: { in: groupNames }, deletedAt: null },
                select: { id: true, name: true },
            })
            for (const g of existingGroups) groupMap.set(g.name, g.id)

            const missingNames = groupNames.filter(name => !groupMap.has(name))
            if (missingNames.length > 0) {
                await prisma.routerGroups.createMany({
                    data: missingNames.map(name => ({ name, description: name })),
                    skipDuplicates: true,
                })
                const created = await prisma.routerGroups.findMany({
                    where: { name: { in: missingNames }, deletedAt: null },
                    select: { id: true, name: true },
                })
                for (const g of created) groupMap.set(g.name, g.id)
            }
        }

        // 批量创建路由
        const createData = newItems.map(item => ({
            name: item.name,
            title: item.title,
            path: item.path,
            isMenu: item.isMenu,
            groupId: item.group ? groupMap.get(item.group) || 0 : 0,
        }))

        await prisma.routers.createMany({
            data: createData,
            skipDuplicates: true,
        })

        return resSuccess(event, '导入成功', {
            imported: newItems.length,
            skipped: items.length - newItems.length,
        })
    } catch (error) {
        logger.error('导入路由失败:', error)
        return resError(event, 500, '导入失败')
    }
})

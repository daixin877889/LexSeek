/**
 * 批量导入路由权限
 * 
 * POST /api/v1/admin/routers/import
 */

import { z } from 'zod'

const importSchema = z.object({
    items: z.array(z.object({
        path: z.string().min(1),
        name: z.string().min(1),
        title: z.string().min(1),
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
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
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

        // 获取或创建路由组
        const groupNames = [...new Set(newItems.map(i => i.group).filter(Boolean))] as string[]
        const groupMap = new Map<string, number>()

        for (const groupName of groupNames) {
            // 查找或创建分组
            let group = await prisma.routerGroups.findFirst({
                where: { name: groupName, deletedAt: null },
            })

            if (!group) {
                group = await prisma.routerGroups.create({
                    data: { name: groupName, description: groupName },
                })
            }

            groupMap.set(groupName, group.id)
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
        console.error('导入路由失败:', error)
        return resError(event, 500, '导入失败')
    }
})

/**
 * 获取 Admin 菜单路由
 * 
 * 返回所有 Admin 菜单路由数据（isMenu=true 且 path 以 /admin 开头）
 * 用于 Admin 后台侧边栏菜单显示
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取所有 Admin 菜单路由
        const routers = await prisma.routers.findMany({
            where: {
                path: { startsWith: '/admin' },
                isMenu: true,
                deletedAt: null,
            },
            select: {
                id: true,
                name: true,
                title: true,
                path: true,
                icon: true,
                isMenu: true,
                sort: true,
                menuGroup: true,
                menuGroupSort: true,
            },
            orderBy: [
                { menuGroupSort: 'asc' },
                { sort: 'asc' },
            ],
        })

        return resSuccess(event, '获取成功', routers)
    } catch (error) {
        logger.error('获取 Admin 菜单路由失败:', error)
        return resError(event, 500, '获取菜单失败')
    }
})

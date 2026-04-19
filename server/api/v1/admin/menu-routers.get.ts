/**
 * 获取 Admin 菜单路由
 *
 * 返回所有 Admin 菜单路由数据（isMenu=true 且 path 以 /admin 开头）
 * 用于 Admin 后台侧边栏菜单显示
 *
 * 超管兜底（all-pass fallback）：
 *   即使 DB 里没有对应 router 行，只要磁盘上存在 `app/pages/admin/**\/index.vue`，
 *   都会作为临时菜单项合并返回，避免新增 admin 页面因漏建 router 行对超管不可见。
 *   非超管仍严格按 DB 控制。
 */
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'

interface AdminRouterItem {
    id: number
    name: string
    title: string
    path: string
    icon: string | null
    isMenu: boolean
    sort: number
    menuGroup: string | null
    menuGroupSort: number
}

/**
 * 递归扫描 `app/pages/admin` 下的 `*\/index.vue` 页面，把静态目录作为菜单项吐出。
 * 动态段（`[id]`）与以 `_` 开头的目录会被跳过。
 */
async function discoverAdminMenuPages(): Promise<Array<{ path: string; name: string }>> {
    const pagesRoot = resolve(process.cwd(), 'app/pages/admin')
    const results: Array<{ path: string; name: string }> = []

    async function walk(dir: string, urlPrefix: string) {
        let entries
        try {
            entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        // 当前目录下有 index.vue → 目录本身就是一个菜单项
        const hasIndex = entries.some(e => e.isFile() && e.name === 'index.vue')
        if (hasIndex && urlPrefix !== '') {
            results.push({
                path: `/admin${urlPrefix}`,
                // 用 `admin-xxx-yyy` 的命名风格，和 seedData.sql 保持一致
                name: `admin${urlPrefix.replace(/\//g, '-')}`,
            })
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            if (entry.name.startsWith('[')) continue
            if (entry.name.startsWith('_')) continue
            await walk(resolve(dir, entry.name), `${urlPrefix}/${entry.name}`)
        }
    }

    await walk(pagesRoot, '')
    return results
}

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 1. 取 DB 中所有标记为菜单的 admin 路由
        const dbRouters = await prisma.routers.findMany({
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

        // 2. 非超管到此为止
        const isSuperAdmin = await checkIsSuperAdmin(user.id)
        if (!isSuperAdmin) {
            return resSuccess(event, '获取成功', dbRouters)
        }

        // 3. 超管兜底：磁盘上的 admin 页面若 DB 没有对应 path，合并为临时菜单项
        const fsPages = await discoverAdminMenuPages()
        const dbPaths = new Set(dbRouters.map(r => r.path))
        const extras: AdminRouterItem[] = fsPages
            .filter(p => !dbPaths.has(p.path))
            .map((p, idx) => ({
                // 用负数 id 避免和 DB 行冲突；前端仅用于 key
                id: -(idx + 1),
                name: p.name,
                // 没有标题就回退成路径尾段，提醒超管补 router 行
                title: p.path.split('/').pop() || p.name,
                path: p.path,
                icon: null,
                isMenu: true,
                sort: 999,
                menuGroup: '未归组（请补录 router）',
                menuGroupSort: 999,
            }))

        if (extras.length > 0) {
            logger.warn('admin 菜单兜底：以下路径缺少 router 行，已为超管临时展示', {
                paths: extras.map(e => e.path),
            })
        }

        return resSuccess(event, '获取成功', [...dbRouters, ...extras])
    } catch (error) {
        logger.error('获取 Admin 菜单路由失败:', error)
        return resError(event, 500, '获取菜单失败')
    }
})

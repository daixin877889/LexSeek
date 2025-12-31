/**
 * 路由权限扫描接口
 * 
 * 扫描 app/pages 目录下的所有页面文件，生成待导入的路由列表
 * 从 definePageMeta 中提取 title 作为路由名称
 * 
 * POST /api/v1/admin/routers/scan
 */

import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

/** 扫描结果项 */
interface ScannedRouterItem {
    /** 路由路径 */
    path: string
    /** 路由名称（从文件路径生成） */
    name: string
    /** 路由标题（从 definePageMeta 提取） */
    title: string
    /** 布局（从 definePageMeta 提取） */
    layout: string | null
    /** 推断的分组 */
    group: string
    /** 是否已存在 */
    exists: boolean
    /** 已存在的路由 ID */
    existingId?: number
}

/**
 * 从 Vue 文件内容中提取 definePageMeta 的 title
 */
const extractPageMeta = (content: string): { title: string | null; layout: string | null } => {
    // 匹配 definePageMeta({ ... }) 的内容
    const metaMatch = content.match(/definePageMeta\s*\(\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)/s)
    if (!metaMatch) {
        return { title: null, layout: null }
    }

    const metaContent = metaMatch[1]

    // 提取 title
    const titleMatch = metaContent.match(/title\s*:\s*["'`]([^"'`]+)["'`]/)
    const title = titleMatch ? titleMatch[1] : null

    // 提取 layout
    const layoutMatch = metaContent.match(/layout\s*:\s*["'`]([^"'`]+)["'`]/)
    const layout = layoutMatch ? layoutMatch[1] : null

    return { title, layout }
}

/**
 * 从文件路径生成路由名称
 */
const generateRouteName = (filePath: string): string => {
    // 移除 .vue 扩展名
    let name = filePath.replace(/\.vue$/, '')

    // 处理 index 文件
    name = name.replace(/\/index$/, '')

    // 处理动态路由参数 [id] -> :id
    name = name.replace(/\[([^\]]+)\]/g, ':$1')

    // 将路径转换为名称格式
    const parts = name.split('/').filter(Boolean)
    return parts.join('-') || 'home'
}

/**
 * 从文件路径生成路由路径
 */
const generateRoutePath = (filePath: string): string => {
    // 移除 .vue 扩展名
    let path = filePath.replace(/\.vue$/, '')

    // 处理 index 文件
    path = path.replace(/\/index$/, '')

    // 处理动态路由参数 [id] -> :id
    path = path.replace(/\[([^\]]+)\]/g, ':$1')

    // 确保以 / 开头
    return path ? `/${path}` : '/'
}

/**
 * 从路径推断分组
 */
const inferGroup = (routePath: string): string => {
    const parts = routePath.split('/').filter(Boolean)
    if (parts.length === 0) return '首页'

    const groupMap: Record<string, string> = {
        'admin': '管理后台',
        'dashboard': '用户中心',
        'landing': '落地页',
    }

    return groupMap[parts[0]] || '公共页面'
}

/**
 * 递归扫描目录
 */
const scanDirectory = (dir: string, basePath: string = ''): ScannedRouterItem[] => {
    const results: ScannedRouterItem[] = []

    try {
        const entries = readdirSync(dir)

        for (const entry of entries) {
            const fullPath = join(dir, entry)
            const stat = statSync(fullPath)

            if (stat.isDirectory()) {
                // 跳过隐藏目录和特殊目录
                if (entry.startsWith('.') || entry.startsWith('_')) continue
                // 递归扫描子目录
                const subPath = basePath ? `${basePath}/${entry}` : entry
                results.push(...scanDirectory(fullPath, subPath))
            } else if (entry.endsWith('.vue')) {
                // 解析 Vue 页面文件
                const filePath = basePath ? `${basePath}/${entry}` : entry
                const routePath = generateRoutePath(filePath)
                const routeName = generateRouteName(filePath)

                // 读取文件内容提取 meta
                let title: string | null = null
                let layout: string | null = null
                try {
                    const content = readFileSync(fullPath, 'utf-8')
                    const meta = extractPageMeta(content)
                    title = meta.title
                    layout = meta.layout
                } catch (err) {
                    console.error(`读取文件失败: ${fullPath}`, err)
                }

                results.push({
                    path: routePath,
                    name: routeName,
                    title: title || routeName,
                    layout,
                    group: inferGroup(routePath),
                    exists: false,
                })
            }
        }
    } catch (error) {
        console.error(`扫描目录失败: ${dir}`, error)
    }

    return results
}

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取 app/pages 目录路径
        const pagesDir = join(process.cwd(), 'app', 'pages')

        // 扫描所有页面文件
        const scannedRouters = scanDirectory(pagesDir)

        // 查询已存在的路由
        const existingRouters = await prisma.routers.findMany({
            where: { deletedAt: null },
            select: { id: true, path: true },
        })

        // 构建路径映射
        const pathMap = new Map<string, number>()
        for (const router of existingRouters) {
            pathMap.set(router.path, router.id)
        }

        // 标记已存在的路由
        const results: ScannedRouterItem[] = scannedRouters.map(router => {
            const existingId = pathMap.get(router.path)
            return {
                ...router,
                exists: !!existingId,
                existingId,
            }
        })

        // 按路径排序
        results.sort((a, b) => a.path.localeCompare(b.path))

        // 统计信息
        const stats = {
            total: results.length,
            existing: results.filter(r => r.exists).length,
            new: results.filter(r => !r.exists).length,
        }

        return resSuccess(event, '扫描完成', { items: results, stats })
    } catch (error) {
        console.error('扫描路由失败:', error)
        return resError(event, 500, '扫描失败')
    }
})

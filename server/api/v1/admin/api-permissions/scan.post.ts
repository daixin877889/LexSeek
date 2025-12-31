/**
 * API 权限扫描接口
 * 
 * 扫描 server/api 目录下的所有 API 文件，生成待导入的权限列表
 * 
 * POST /api/v1/admin/api-permissions/scan
 */

import { readdirSync, statSync } from 'fs'
import { join } from 'path'

/** 扫描结果项 */
interface ScannedApiItem {
    path: string
    method: string
    name: string
    exists: boolean
    existingId?: number
}

/** HTTP 方法映射 */
const METHOD_MAP: Record<string, string> = {
    get: 'GET',
    post: 'POST',
    put: 'PUT',
    delete: 'DELETE',
    patch: 'PATCH',
}

/**
 * 从文件名解析 HTTP 方法
 * 返回 null 表示文件不是 API 文件
 * 返回 '*' 表示处理所有方法（无方法后缀的文件）
 */
const parseMethodFromFileName = (fileName: string): string | null => {
    // 移除 .ts 扩展名
    const baseName = fileName.replace(/\.ts$/, '')

    // 处理 .get、.post 等格式（Nuxt index 路由简写）
    for (const [suffix, method] of Object.entries(METHOD_MAP)) {
        if (baseName === `.${suffix}`) {
            return method
        }
    }

    // 查找方法后缀（如 user.get.ts）
    for (const [suffix, method] of Object.entries(METHOD_MAP)) {
        if (baseName.endsWith(`.${suffix}`)) {
            return method
        }
    }

    // 没有方法后缀的 .ts 文件，默认处理所有方法
    if (!baseName.startsWith('.') && !baseName.includes('.')) {
        return '*'
    }

    return null
}

/**
 * 从文件名解析路由段
 */
const parseRouteSegment = (fileName: string): string => {
    // 移除 .ts 扩展名
    let segment = fileName.replace(/\.ts$/, '')

    // 处理 .get、.post 等格式（Nuxt index 路由简写）
    for (const suffix of Object.keys(METHOD_MAP)) {
        if (segment === `.${suffix}`) {
            return ''
        }
    }

    // 移除方法后缀
    for (const suffix of Object.keys(METHOD_MAP)) {
        segment = segment.replace(new RegExp(`\\.${suffix}$`), '')
    }

    // 处理动态路由参数 [id] -> :id
    segment = segment.replace(/\[([^\]]+)\]/g, ':$1')

    // index 文件不添加路由段
    if (segment === 'index') {
        return ''
    }

    return segment
}

/**
 * 递归扫描目录
 */
const scanDirectory = (dir: string, basePath: string = ''): ScannedApiItem[] => {
    const results: ScannedApiItem[] = []

    try {
        const entries = readdirSync(dir)

        for (const entry of entries) {
            const fullPath = join(dir, entry)
            const stat = statSync(fullPath)

            if (stat.isDirectory()) {
                // 跳过隐藏目录（如 .git）
                if (entry.startsWith('.')) continue
                // 递归扫描子目录
                const subPath = basePath ? `${basePath}/${entry}` : entry
                results.push(...scanDirectory(fullPath, subPath))
            } else if (entry.endsWith('.ts')) {
                // 解析 API 文件（包括 .get.ts、.post.ts 等格式）
                const method = parseMethodFromFileName(entry)
                if (!method) continue

                const segment = parseRouteSegment(entry)
                const apiPath = segment
                    ? `/api/${basePath}/${segment}`.replace(/\/+/g, '/')
                    : `/api/${basePath}`.replace(/\/+/g, '/')

                // 生成权限名称
                const pathParts = apiPath.split('/').filter(Boolean)
                const name = pathParts.slice(1).join(' - ') || 'root'

                results.push({
                    path: apiPath,
                    method,
                    name: `${method} ${name}`,
                    exists: false,
                })
            }
        }
    } catch (error) {
        console.error(`扫描目录失败: ${dir}`, error)
    }

    return results
}

/**
 * 生成权限名称
 */
const generatePermissionName = (path: string, method: string): string => {
    // 移除 /api 前缀和版本号
    const cleanPath = path.replace(/^\/api\/v\d+\//, '')

    // 将路径转换为可读名称
    const parts = cleanPath.split('/').filter(Boolean)
    const readableParts = parts.map(part => {
        // 处理动态参数
        if (part.startsWith(':')) {
            return `[${part.slice(1)}]`
        }
        // 转换 kebab-case 为空格分隔
        return part.replace(/-/g, ' ')
    })

    return `${method} ${readableParts.join(' / ')}`
}


export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取 server/api 目录路径
        const apiDir = join(process.cwd(), 'server', 'api')

        // 扫描所有 API 文件
        const scannedApis = scanDirectory(apiDir)

        // 查询已存在的 API 权限
        const existingPermissions = await findApiPermissionsDao({}, { page: 1, pageSize: 1000 })

        // 构建匹配映射：支持精确匹配和通配符匹配
        const exactMap = new Map<string, number>()  // method:path -> id
        const wildcardMap = new Map<string, number>()  // path -> id (method = '*')

        for (const perm of existingPermissions.items) {
            if (perm.method === '*') {
                wildcardMap.set(perm.path, perm.id)
            } else {
                exactMap.set(`${perm.method}:${perm.path}`, perm.id)
            }
        }

        // 标记已存在的权限（支持通配符匹配）
        const results: ScannedApiItem[] = scannedApis.map(api => {
            const exactKey = `${api.method}:${api.path}`
            const existingId = exactMap.get(exactKey) || wildcardMap.get(api.path)
            return {
                ...api,
                name: generatePermissionName(api.path, api.method),
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
        console.error('扫描 API 权限失败:', error)
        return resError(event, 500, '扫描失败')
    }
})

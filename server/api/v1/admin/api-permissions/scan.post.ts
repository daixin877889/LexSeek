/**
 * API 权限扫描接口
 *
 * 扫描 server/api 目录下的所有 API 文件，生成待导入的权限列表。
 *
 * POST /api/v1/admin/api-permissions/scan
 *
 * 安全模型：
 * 1) 仅超管可调用——会列出系统全部内部 API 路径，对低权限角色属于信息泄露（H6）；
 * 2) 不再 fallback 到 method='*'：没有方法后缀的 .ts 文件不当 API 处理（H4），
 *    避免把 utility/types 误注册成全方法权限；
 * 3) 路径全部用 :param 协议，不留 [xxx] 字面字符（C4）。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { findApiPermissionsDao } from '~~/server/services/rbac/apiPermission.dao'
import {
    normalizeApiPath,
    requireSuperAdminGuard,
    validateApiPathFormat,
} from '~~/server/services/rbac/guard.service'

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
 * 从文件名解析 HTTP 方法。
 *
 * 修复 H4：以前对没有方法后缀的 .ts 文件返回 '*'，会把非 API 工具文件误注册成
 * "全方法权限"。改为：找不到明确方法后缀就返回 null（不是 API 文件）。
 */
const parseMethodFromFileName = (fileName: string): string | null => {
    const baseName = fileName.replace(/\.ts$/, '')

    // .get / .post 这种 Nuxt index 路由简写
    for (const [suffix, method] of Object.entries(METHOD_MAP)) {
        if (baseName === `.${suffix}`) {
            return method
        }
    }

    // xxx.get / xxx.post 这种带方法后缀
    for (const [suffix, method] of Object.entries(METHOD_MAP)) {
        if (baseName.endsWith(`.${suffix}`)) {
            return method
        }
    }

    return null
}

/**
 * 把 Nuxt 文件命名约定中的动态参数 [xxx] 转成 :xxx，与 RBAC pathMatcher 协议一致。
 * 注意：必须用 normalizeApiPath（来自 guard.service），保证 path 段中折叠斜杠 / 去尾随。
 */

/**
 * 从文件名解析路由段（去掉方法后缀 + 动态参数转换）。
 */
const parseRouteSegment = (fileName: string): string => {
    let segment = fileName.replace(/\.ts$/, '')

    // 处理 .get / .post 等 Nuxt index 简写
    for (const suffix of Object.keys(METHOD_MAP)) {
        if (segment === `.${suffix}`) {
            return ''
        }
    }

    // 移除方法后缀
    for (const suffix of Object.keys(METHOD_MAP)) {
        segment = segment.replace(new RegExp(`\\.${suffix}$`), '')
    }

    // 动态参数 [id] -> :id（最终路径还会经过 normalizeApiPath 兜底）
    segment = segment.replace(/\[([^\]]+)\]/g, ':$1')

    if (segment === 'index') {
        return ''
    }

    return segment
}

/**
 * 异步递归扫描目录（H4 配套：把同步 readdirSync 替换为 fs/promises，避免阻塞事件循环）。
 */
async function scanDirectory(dir: string, basePath: string = ''): Promise<ScannedApiItem[]> {
    const results: ScannedApiItem[] = []

    let entries
    try {
        entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
        logger.warn('[RBAC scan] 扫描目录失败', { dir, error: (error as Error)?.message })
        return results
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry.name)

        if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue
            const dirSegment = entry.name.replace(/\[([^\]]+)\]/g, ':$1')
            const subPath = basePath ? `${basePath}/${dirSegment}` : dirSegment
            results.push(...await scanDirectory(fullPath, subPath))
            continue
        }

        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue

        const method = parseMethodFromFileName(entry.name)
        if (!method) continue

        const segment = parseRouteSegment(entry.name)
        const rawPath = segment
            ? `/api/${basePath}/${segment}`
            : `/api/${basePath}`
        const apiPath = normalizeApiPath(rawPath)

        // 兜底校验：理论上不会触发，但万一文件名出现 [/]，立即跳过并打 warn
        const reason = validateApiPathFormat(apiPath)
        if (reason) {
            logger.warn('[RBAC scan] 跳过格式异常路径', { rawPath, reason })
            continue
        }

        const pathParts = apiPath.split('/').filter(Boolean)
        const name = pathParts.slice(1).join(' - ') || 'root'

        results.push({
            path: apiPath,
            method,
            name: `${method} ${name}`,
            exists: false,
        })
    }

    return results
}

/**
 * 生成权限名称
 */
const generatePermissionName = (path: string, method: string): string => {
    const cleanPath = path.replace(/^\/api\/v\d+\//, '')
    const parts = cleanPath.split('/').filter(Boolean)
    const readableParts = parts.map(part => {
        if (part.startsWith(':')) {
            return `[${part.slice(1)}]`
        }
        return part.replace(/-/g, ' ')
    })
    return `${method} ${readableParts.join(' / ')}`
}


export default defineEventHandler(async (event) => {
    // H6：仅超管可触发，避免内部 API 列表被低权限角色枚举
    const guard = await requireSuperAdminGuard(event)
    if (!guard.ok) return guard.response

    try {
        const apiDir = join(process.cwd(), 'server', 'api')

        const scannedApis = await scanDirectory(apiDir)

        // H3：必须 all:true 一次性拿全，否则超过 1000 条时会重复导入
        const existingPermissions = await findApiPermissionsDao({}, { all: true })

        // 构建匹配映射：精确匹配 + 通配符匹配
        const exactMap = new Map<string, number>()
        const wildcardMap = new Map<string, number>()

        for (const perm of existingPermissions.items) {
            if (perm.method === '*') {
                wildcardMap.set(perm.path, perm.id)
            } else {
                exactMap.set(`${perm.method}:${perm.path}`, perm.id)
            }
        }

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

        results.sort((a, b) => a.path.localeCompare(b.path))

        const stats = {
            total: results.length,
            existing: results.filter(r => r.exists).length,
            new: results.filter(r => !r.exists).length,
        }

        return resSuccess(event, '扫描完成', { items: results, stats })
    } catch (error) {
        logger.error('[RBAC scan] 扫描失败', error)
        return resError(event, 500, '扫描失败')
    }
})

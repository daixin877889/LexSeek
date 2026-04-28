/**
 * RBAC 公共防护工具
 *
 * 这一层的职责是把"敏感操作前必须做的安全校验"集中下沉，让 admin 各 handler
 * 不再各自实现「超管校验 / 自我操作禁止 / 路径与方法规范化」等防御逻辑——这是
 * 之前 RBAC 审查发现的最大类问题：handler 写得越多越容易遗漏。
 *
 * 重点：
 * 1) requireSuperAdminGuard：所有"会扩散权限边界"的接口（分配用户角色、修改
 *    角色权限映射、扫描/导入/批量删除 API 权限等）必须先过这个闸口；
 * 2) forbidSelfTargetGuard：禁止操作人对自己执行高危操作，避免单点提权；
 * 3) ensureSuperAdminRemainingGuard：在批量调整角色绑定 / 删除超管角色后，
 *    保证系统始终至少保留一名启用且非软删的超管，防止"最后一把钥匙丢了"；
 * 4) normalizeApiPath / normalizeApiMethod / validateApiPathFormat：API 权限
 *    入库前的格式校验，根除 [xxx] 字面字符与大小写/尾斜杠不一致问题。
 */
import type { H3Event } from 'h3'
import { checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'

/**
 * 强制要求当前请求是超管发起。任何"能横向放大权限"的接口都应在 handler 顶部调用。
 * 校验失败直接返回结构化错误响应；调用处统一 `return await requireSuperAdminGuard(event)`。
 *
 * 返回值约定：
 * - 通过：返回 `{ ok: true, user }`，调用处可继续；
 * - 不通过：返回 `{ ok: false, response }`，调用处直接 `return response`。
 *
 * 这种返回结构比抛异常更适合 H3 handler——避免外层 try/catch 把 401/403 吞掉。
 */
export const requireSuperAdminGuard = async (
    event: H3Event,
): Promise<
    | { ok: true; userId: number }
    | { ok: false; response: ReturnType<typeof resError> }
> => {
    const user = event.context.auth?.user
    if (!user) {
        return { ok: false, response: resError(event, 401, '请先登录') }
    }

    const isSuperAdmin = await checkIsSuperAdmin(user.id)
    if (!isSuperAdmin) {
        // 拒绝时不告诉调用方"差在哪"，避免泄露内部角色结构
        logger.warn(`[RBAC] 非超管尝试调用超管专属接口 userId=${user.id} path=${event.path}`)
        return { ok: false, response: resError(event, 403, '无权限访问该接口') }
    }

    return { ok: true, userId: user.id }
}

/**
 * 禁止操作人对自己做高危调整（如改自己的角色 / 权限 / 状态）。
 * 单一职责：仅做 self 检查；调用方在 requireSuperAdminGuard 之后调用即可。
 */
export const forbidSelfTargetGuard = (
    event: H3Event,
    operatorUserId: number,
    targetUserId: number,
    actionLabel: string,
): { ok: true } | { ok: false; response: ReturnType<typeof resError> } => {
    if (operatorUserId === targetUserId) {
        logger.warn(
            `[RBAC] 拒绝 self 操作 userId=${operatorUserId} action=${actionLabel}`,
        )
        return {
            ok: false,
            response: resError(event, 403, `不能${actionLabel}自己的账号`),
        }
    }
    return { ok: true }
}

/**
 * 保证调整后系统仍至少保留一名启用且未软删的超管。
 * 适用于：1) 用户角色变更后；2) 删除/禁用 super_admin 角色行；3) 删除超管用户。
 *
 * 实现策略：count(*) 直接用 where 过滤所有维度，避免 JS 层 some() 漏一层。
 *
 * @param tx 可选事务，用于在事务回滚前预检查
 * @param excludeUserId 可选，把这个用户当作"已经被剥离超管"再做计数（用于 update 之后的校验）
 */
export const ensureSuperAdminRemainingGuard = async (
    tx?: any,
    excludeUserId?: number,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const client = tx || prisma
    const remaining = await client.userRoles.count({
        where: {
            deletedAt: null,
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
            role: {
                code: 'super_admin',
                status: 1,
                deletedAt: null,
            },
            user: {
                status: 1,
                deletedAt: null,
            },
        },
    })

    if (remaining <= 0) {
        return {
            ok: false,
            reason: '系统至少需要保留一名超级管理员，无法继续操作',
        }
    }
    return { ok: true }
}

// ==================== 路径与方法规范化 ====================

const VALID_HTTP_METHODS = new Set([
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', '*',
])

/**
 * 规范化 API 路径：
 * 1) 把 Nuxt 文件命名遗留的 [xxx] 转成 RBAC 协议的 :xxx；
 * 2) 折叠多余斜杠；
 * 3) 去掉尾随 /（根路径 / 保留）。
 */
export const normalizeApiPath = (raw: string): string => {
    let path = String(raw).trim()
    // [xxx] -> :xxx
    path = path.replace(/\[([^\]]+)\]/g, ':$1')
    // 多斜杠折叠
    path = path.replace(/\/+/g, '/')
    // 去尾随 /（保留单 /）
    if (path.length > 1 && path.endsWith('/')) {
        path = path.replace(/\/+$/, '')
    }
    return path
}

/**
 * 规范化 HTTP 方法：去空白 + 强制大写。校验失败抛错，由调用处转成 400。
 */
export const normalizeApiMethod = (raw: string): string => {
    const method = String(raw).trim().toUpperCase()
    if (!VALID_HTTP_METHODS.has(method)) {
        throw new Error(`无效的 HTTP 方法: ${raw}`)
    }
    return method
}

/**
 * 校验 API 路径格式：
 * - 必须以 / 开头
 * - 不允许出现 Nuxt 文件命名残留的 [/]（已经过 normalizeApiPath 应该不会再出现）
 * - 不允许包含查询字符串 / 锚点
 *
 * 返回 null 表示通过；返回字符串表示不通过原因（直接当 message 返回 400）。
 */
export const validateApiPathFormat = (path: string): string | null => {
    if (!path.startsWith('/')) {
        return '路径必须以 / 开头'
    }
    if (path.includes('[') || path.includes(']')) {
        return '路径不能包含 [ 或 ]，动态参数请使用 :param 形式'
    }
    if (path.includes('?') || path.includes('#')) {
        return '路径不能包含查询字符串或锚点'
    }
    return null
}

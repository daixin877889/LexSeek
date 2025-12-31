/**
 * 权限审计日志服务
 * 
 * 封装审计日志的记录逻辑
 */
import type { Prisma } from "#shared/types/prisma"
import type { H3Event } from "h3"

// ==================== 辅助函数 ====================

/**
 * 从请求事件中获取客户端 IP
 */
const getClientIp = (event: H3Event): string | null => {
    // 优先从 X-Forwarded-For 获取（代理场景）
    const forwarded = getHeader(event, 'x-forwarded-for')
    if (forwarded) {
        return forwarded.split(',')[0].trim()
    }

    // 从 X-Real-IP 获取
    const realIp = getHeader(event, 'x-real-ip')
    if (realIp) {
        return realIp
    }

    // 从连接信息获取
    return event.node.req.socket?.remoteAddress ?? null
}

// ==================== 角色相关日志 ====================

/**
 * 记录角色创建日志
 */
export const logRoleCreate = async (
    event: H3Event,
    operatorId: number,
    roleId: number,
    roleData: Record<string, unknown>,
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.ROLE_CREATE,
        targetType: 'role',
        targetId: roleId,
        operatorId,
        newValue: roleData,
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录角色更新日志
 */
export const logRoleUpdate = async (
    event: H3Event,
    operatorId: number,
    roleId: number,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.ROLE_UPDATE,
        targetType: 'role',
        targetId: roleId,
        operatorId,
        oldValue: oldData,
        newValue: newData,
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录角色删除日志
 */
export const logRoleDelete = async (
    event: H3Event,
    operatorId: number,
    roleId: number,
    roleData: Record<string, unknown>,
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.ROLE_DELETE,
        targetType: 'role',
        targetId: roleId,
        operatorId,
        oldValue: roleData,
        ip: getClientIp(event),
    }, tx)
}

// ==================== 角色权限相关日志 ====================

/**
 * 记录角色 API 权限分配日志
 */
export const logRoleAssignApiPermission = async (
    event: H3Event,
    operatorId: number,
    roleId: number,
    permissionIds: number[],
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.ROLE_ASSIGN_API_PERMISSION,
        targetType: 'role',
        targetId: roleId,
        operatorId,
        newValue: { permissionIds },
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录角色 API 权限移除日志
 */
export const logRoleRemoveApiPermission = async (
    event: H3Event,
    operatorId: number,
    roleId: number,
    permissionIds: number[],
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.ROLE_REMOVE_API_PERMISSION,
        targetType: 'role',
        targetId: roleId,
        operatorId,
        oldValue: { permissionIds },
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录角色路由权限分配日志
 */
export const logRoleAssignRoutePermission = async (
    event: H3Event,
    operatorId: number,
    roleId: number,
    routes: string[],
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.ROLE_ASSIGN_ROUTE_PERMISSION,
        targetType: 'role',
        targetId: roleId,
        operatorId,
        newValue: { routes },
        ip: getClientIp(event),
    }, tx)
}

// ==================== 用户角色相关日志 ====================

/**
 * 记录用户角色分配日志
 */
export const logUserAssignRole = async (
    event: H3Event,
    operatorId: number,
    userId: number,
    roleIds: number[],
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.USER_ASSIGN_ROLE,
        targetType: 'user',
        targetId: userId,
        operatorId,
        newValue: { roleIds },
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录用户角色移除日志
 */
export const logUserRemoveRole = async (
    event: H3Event,
    operatorId: number,
    userId: number,
    roleIds: number[],
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.USER_REMOVE_ROLE,
        targetType: 'user',
        targetId: userId,
        operatorId,
        oldValue: { roleIds },
        ip: getClientIp(event),
    }, tx)
}

// ==================== API 权限相关日志 ====================

/**
 * 记录 API 权限创建日志
 */
export const logApiPermissionCreate = async (
    event: H3Event,
    operatorId: number,
    permissionId: number,
    permissionData: Record<string, unknown>,
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.API_PERMISSION_CREATE,
        targetType: 'api_permission',
        targetId: permissionId,
        operatorId,
        newValue: permissionData,
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录 API 权限更新日志
 */
export const logApiPermissionUpdate = async (
    event: H3Event,
    operatorId: number,
    permissionId: number,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.API_PERMISSION_UPDATE,
        targetType: 'api_permission',
        targetId: permissionId,
        operatorId,
        oldValue: oldData,
        newValue: newData,
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录 API 权限删除日志
 */
export const logApiPermissionDelete = async (
    event: H3Event,
    operatorId: number,
    permissionId: number,
    permissionData: Record<string, unknown>,
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.API_PERMISSION_DELETE,
        targetType: 'api_permission',
        targetId: permissionId,
        operatorId,
        oldValue: permissionData,
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录批量更新 API 权限公开状态日志
 */
export const logApiPermissionBatchPublic = async (
    event: H3Event,
    operatorId: number,
    permissionIds: number[],
    isPublic: boolean,
    tx?: Prisma.TransactionClient
) => {
    // 使用第一个权限 ID 作为目标 ID（批量操作）
    return createAuditLogDao({
        action: AuditLogAction.API_PERMISSION_BATCH_PUBLIC,
        targetType: 'api_permission',
        targetId: permissionIds[0] || 0,
        operatorId,
        newValue: { permissionIds, isPublic },
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录批量删除 API 权限日志
 */
export const logApiPermissionBatchDelete = async (
    event: H3Event,
    operatorId: number,
    permissionIds: number[],
    tx?: Prisma.TransactionClient
) => {
    return createAuditLogDao({
        action: AuditLogAction.API_PERMISSION_BATCH_DELETE,
        targetType: 'api_permission',
        targetId: permissionIds[0] || 0,
        operatorId,
        oldValue: { permissionIds },
        ip: getClientIp(event),
    }, tx)
}

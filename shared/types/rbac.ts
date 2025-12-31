/**
 * RBAC 权限管理相关类型定义
 */

/** 分页参数 */
export interface PaginationParams {
    page?: number
    pageSize?: number
}

/** 分页结果 */
export interface PaginatedResult<T> {
    items: T[]
    total: number
    page: number
    pageSize: number
    totalPages: number
}

/** API 权限 */
export interface ApiPermission {
    id: number
    path: string
    method: string
    name: string
    description?: string | null
    groupId?: number | null
    isPublic: boolean
    status: number
    createdAt: Date
    updatedAt: Date
}

/** API 权限分组 */
export interface ApiPermissionGroup {
    id: number
    name: string
    description?: string | null
    sort: number
}

/** 角色 */
export interface Role {
    id: number
    name: string
    code: string
    description?: string | null
    status: number
    createdAt: Date
    updatedAt: Date
}

/** 用户权限信息 */
export interface UserPermissions {
    apiPermissions: Array<{
        id: number
        path: string
        method: string
    }>
    routePermissions: string[]
    isSuperAdmin: boolean
}

/** 审计日志操作类型 */
export enum AuditLogAction {
    ROLE_CREATE = 'role_create',
    ROLE_UPDATE = 'role_update',
    ROLE_DELETE = 'role_delete',
    ROLE_ASSIGN_API_PERMISSION = 'role_assign_api_permission',
    ROLE_REMOVE_API_PERMISSION = 'role_remove_api_permission',
    ROLE_ASSIGN_ROUTE_PERMISSION = 'role_assign_route_permission',
    ROLE_REMOVE_ROUTE_PERMISSION = 'role_remove_route_permission',
    USER_ASSIGN_ROLE = 'user_assign_role',
    USER_REMOVE_ROLE = 'user_remove_role',
    API_PERMISSION_CREATE = 'api_permission_create',
    API_PERMISSION_UPDATE = 'api_permission_update',
    API_PERMISSION_DELETE = 'api_permission_delete',
    API_PERMISSION_BATCH_PUBLIC = 'api_permission_batch_public',
    API_PERMISSION_BATCH_DELETE = 'api_permission_batch_delete',
}

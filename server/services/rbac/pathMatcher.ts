/**
 * 路径匹配工具
 * 
 * 支持以下路径模式：
 * - `:param` 匹配单个路径段（动态参数，如 :id）
 * - `*` 匹配单个路径段
 * - `**` 匹配任意路径段（包含 /）
 * 
 * 示例：
 * - `/api/v1/users/:id` 匹配 `/api/v1/users/123`
 * - `/api/v1/files/oss/:id` 匹配 `/api/v1/files/oss/456`
 * - `/api/v1/admin/**` 匹配 `/api/v1/admin/roles/1/permissions`
 */

/**
 * 检查请求路径是否匹配权限路径模式
 * 
 * @param pattern 权限路径模式（可包含 :param、* 或 **）
 * @param path 请求路径
 * @returns 是否匹配
 */
export const matchPath = (pattern: string, path: string): boolean => {
    // 完全相等
    if (pattern === path) {
        return true
    }

    // 不包含通配符和动态参数，直接比较
    if (!pattern.includes('*') && !pattern.includes(':')) {
        return pattern === path
    }

    // 将模式转换为正则表达式
    const regex = patternToRegex(pattern)
    return regex.test(path)
}

/**
 * 将路径模式转换为正则表达式
 */
const patternToRegex = (pattern: string): RegExp => {
    // 转义正则特殊字符（除了 * 和 :）
    let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

    // 处理 ** 通配符（匹配任意路径段）
    regexStr = regexStr.replace(/\*\*/g, '<<<DOUBLE_STAR>>>')

    // 处理 * 通配符（匹配单个路径段）
    regexStr = regexStr.replace(/\*/g, '[^/]+')

    // 还原 ** 通配符
    regexStr = regexStr.replace(/<<<DOUBLE_STAR>>>/g, '.*')

    // 处理动态参数 :param（匹配单个路径段）
    regexStr = regexStr.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '[^/]+')

    return new RegExp(`^${regexStr}$`)
}

/**
 * 检查请求方法是否匹配权限方法
 * 
 * @param permissionMethod 权限方法（可以是 * 表示所有方法）
 * @param requestMethod 请求方法
 * @returns 是否匹配
 */
export const matchMethod = (permissionMethod: string, requestMethod: string): boolean => {
    // * 匹配所有方法
    if (permissionMethod === '*') {
        return true
    }

    // 不区分大小写比较
    return permissionMethod.toUpperCase() === requestMethod.toUpperCase()
}

/**
 * 检查请求是否匹配权限
 * 
 * @param permission 权限配置
 * @param requestPath 请求路径
 * @param requestMethod 请求方法
 * @returns 是否匹配
 */
export const matchPermission = (
    permission: { path: string; method: string },
    requestPath: string,
    requestMethod: string
): boolean => {
    return matchPath(permission.path, requestPath) && matchMethod(permission.method, requestMethod)
}


/**
 * 在权限列表中查找匹配的权限
 * 
 * @param permissions 权限列表
 * @param requestPath 请求路径
 * @param requestMethod 请求方法
 * @returns 匹配的权限，未找到返回 null
 */
export const findMatchingPermission = <T extends { path: string; method: string }>(
    permissions: T[],
    requestPath: string,
    requestMethod: string
): T | null => {
    for (const permission of permissions) {
        if (matchPermission(permission, requestPath, requestMethod)) {
            return permission
        }
    }
    return null
}

/**
 * 检查路径是否以指定前缀开头
 * 
 * @param path 路径
 * @param prefix 前缀
 * @returns 是否匹配
 */
export const pathStartsWith = (path: string, prefix: string): boolean => {
    // 确保前缀以 / 结尾或完全匹配
    if (path === prefix) {
        return true
    }
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
    return path.startsWith(normalizedPrefix)
}

/**
 * MinerU Token 服务层
 *
 * 提供 MinerU API Token 的管理功能
 * Requirements: 3.1.1.1-3.1.1.7
 */

import type { mineruTokens } from '~~/generated/prisma/client'
import {
    createMineruTokenDao,
    findMineruTokenByIdDao,
    findMineruTokenByIdRawDao,
    findMineruTokenByNameDao,
    findManyMineruTokensDao,
    findActiveTokenDao,
    pickLeastRecentlyUsedActiveTokenDao,
    updateMineruTokenDao,
    softDeleteMineruTokenDao,
} from './mineruToken.dao'

/** MinerU Token 状态枚举 */
export enum MineruTokenStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 创建 MinerU Token 输入 */
export interface CreateMineruTokenInput {
    name: string
    token: string
    remark?: string | null
    status?: number
    /** 到期时间；未传或传 null 表示永不过期 */
    expiresAt?: Date | null
}

/** 更新 MinerU Token 输入 */
export interface UpdateMineruTokenInput {
    name?: string
    token?: string
    remark?: string | null
    status?: number
    /** 到期时间；undefined=不修改、null=清空（永不过期）、Date=设置 */
    expiresAt?: Date | null
}

/** MinerU Token 列表查询参数 */
export interface MineruTokenListParams {
    page?: number
    pageSize?: number
    status?: number
    keyword?: string
    orderBy?: 'id' | 'name' | 'status' | 'createdAt'
    orderDir?: 'asc' | 'desc'
}

/** MinerU Token 脱敏显示 */
export interface MineruTokenMasked extends Omit<mineruTokens, 'token'> {
    /** 脱敏后的 Token（只显示前4位和后4位） */
    tokenMasked: string
    /** 是否已过期（expiresAt 非空且早于当前时间） */
    expired: boolean
}

// ==================== 工具函数 ====================

/**
 * Token 脱敏处理
 * 只显示前4位和后4位，中间用 **** 替代
 */
const maskToken = (token: string): string => {
    if (!token || token.length <= 8) {
        return '****'
    }
    return `${token.slice(0, 4)}****${token.slice(-4)}`
}

/**
 * 将 Token 转换为脱敏格式
 */
const toMaskedToken = (token: mineruTokens): MineruTokenMasked => {
    const { token: rawToken, ...rest } = token
    const expired = !!rest.expiresAt && rest.expiresAt.getTime() <= Date.now()
    return {
        ...rest,
        tokenMasked: maskToken(rawToken),
        expired,
    }
}

// ==================== 服务层 ====================

/**
 * 创建 MinerU Token
 * Requirements: 3.1.1.2
 */
export const createMineruTokenService = async (
    data: CreateMineruTokenInput
): Promise<MineruTokenMasked> => {
    // 检查名称是否已存在
    const existing = await findMineruTokenByNameDao(data.name)
    if (existing) {
        throw new Error('Token 名称已存在')
    }

    const token = await createMineruTokenDao(data)
    return toMaskedToken(token)
}

/**
 * 获取 MinerU Token 详情（脱敏）
 * Requirements: 3.1.1.1
 */
export const getMineruTokenByIdService = async (
    id: number
): Promise<MineruTokenMasked | null> => {
    const token = await findMineruTokenByIdDao(id)
    return token ? toMaskedToken(token) : null
}

/**
 * 获取 MinerU Token 列表（分页，脱敏显示）
 * Requirements: 3.1.1.1
 */
export const getMineruTokensService = async (
    options: MineruTokenListParams = {}
): Promise<{ list: MineruTokenMasked[]; total: number }> => {
    const { list, total } = await findManyMineruTokensDao(options)
    return {
        list: list.map(toMaskedToken),
        total,
    }
}

/**
 * 获取一个当前可用的 Token（完整对象）
 *
 * "可用"= 未删除 + 启用 + 未过期。
 * 仅用于"无 task 上下文"的兜底（不进行 LRU 选取也不更新 lastUsedAt）。
 * 创建新任务请用 pickTokenForNewTaskService 走 LRU 负载均衡。
 */
export const getActiveTokenService = async (): Promise<mineruTokens | null> => {
    return await findActiveTokenDao()
}

/**
 * 获取一个当前可用的 Token 值
 *
 * 仅用于无 task 上下文的兜底（如旧任务轮询时找不到绑定 token 的退路）。
 * @returns Token 值，没有可用 Token 则返回 null
 */
export const getActiveTokenValueService = async (): Promise<string | null> => {
    const token = await findActiveTokenDao()
    return token?.token ?? null
}

/**
 * 通过 ID 获取 Token 值（不过滤 status / expiresAt，仅过滤 deletedAt）
 *
 * 用于轮询正在跑的任务时，按创建任务时绑定的 token id 反查同一 token。
 * 即使该 token 已被禁用或过期，正在跑的任务仍需用同一 token 才能在 MinerU 平台查到结果。
 *
 * @returns Token 值，token 不存在或已被物理删除返回 null
 */
export const getTokenByIdService = async (id: number): Promise<string | null> => {
    const token = await findMineruTokenByIdRawDao(id)
    return token?.token ?? null
}

/**
 * LRU 负载均衡选择一个可用 Token 用于新任务
 *
 * "可用"= 未删除 + 启用 + 未过期。从所有可用 token 中选 lastUsedAt 最久的一条，
 * 同时原子更新 lastUsedAt = now()，使得多 token 配置下负载真正均匀分摊。
 *
 * @returns { id, token } 用于发起 MinerU API 请求并把 id 写入 mineruTasks.mineruTokenId；
 *          没有可用 token 时返回 null（调用方决定是 throw 还是返回业务错误）
 */
export const pickTokenForNewTaskService = async (): Promise<{ id: number; token: string } | null> => {
    const picked = await pickLeastRecentlyUsedActiveTokenDao()
    return picked ? { id: picked.id, token: picked.token } : null
}

/**
 * 获取 task 进行后续 MinerU API 调用应使用的 token
 *
 * 优先使用 task 创建时绑定的 token（保证与 MinerU 平台 task_id 的归属一致）；
 * 旧任务（mineruTokenId 为空）或绑定 token 已被物理删除时回退到当前可用 token，
 * 并打 warn 日志方便排查"轮询失败"类问题。
 */
export const getTokenForExistingTaskService = async (
    task: { id: number; mineruTokenId: number | null },
): Promise<string | null> => {
    if (task.mineruTokenId) {
        const bound = await getTokenByIdService(task.mineruTokenId)
        if (bound) return bound
        logger.warn(
            `MinerU token 反查：task #${task.id} 绑定的 token (id=${task.mineruTokenId}) 不可用，回退到当前可用 token`,
        )
    } else {
        logger.warn(`MinerU token 反查：task #${task.id} 未绑定 token（旧任务），回退到当前可用 token`)
    }
    return await getActiveTokenValueService()
}

/**
 * 更新 MinerU Token
 * Requirements: 3.1.1.3
 */
export const updateMineruTokenService = async (
    id: number,
    data: UpdateMineruTokenInput
): Promise<MineruTokenMasked> => {
    // 检查 Token 是否存在
    const existing = await findMineruTokenByIdDao(id)
    if (!existing) {
        throw new Error('Token 不存在')
    }

    // 如果更新名称，检查名称是否已存在
    if (data.name && data.name !== existing.name) {
        const nameExists = await findMineruTokenByNameDao(data.name)
        if (nameExists) {
            throw new Error('Token 名称已存在')
        }
    }

    const token = await updateMineruTokenDao(id, data)
    return toMaskedToken(token)
}

/**
 * 切换 MinerU Token 状态
 * Requirements: 3.1.1.5
 */
export const toggleMineruTokenStatusService = async (
    id: number
): Promise<MineruTokenMasked> => {
    // 检查 Token 是否存在
    const existing = await findMineruTokenByIdDao(id)
    if (!existing) {
        throw new Error('Token 不存在')
    }

    // 切换状态
    const newStatus = existing.status === MineruTokenStatus.ENABLED
        ? MineruTokenStatus.DISABLED
        : MineruTokenStatus.ENABLED

    const token = await updateMineruTokenDao(id, { status: newStatus })
    return toMaskedToken(token)
}

/**
 * 删除 MinerU Token（软删除）
 * Requirements: 3.1.1.4
 */
export const deleteMineruTokenService = async (id: number): Promise<void> => {
    // 检查 Token 是否存在
    const existing = await findMineruTokenByIdDao(id)
    if (!existing) {
        throw new Error('Token 不存在')
    }

    await softDeleteMineruTokenDao(id)
}

/**
 * 检查是否有可用的 Token（启用 + 未过期 + 未删除）
 * Requirements: 3.1.1.7
 */
export const hasActiveTokenService = async (): Promise<boolean> => {
    const token = await findActiveTokenDao()
    return token !== null
}

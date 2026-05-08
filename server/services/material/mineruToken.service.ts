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
    findMineruTokenByNameDao,
    findManyMineruTokensDao,
    findActiveTokenDao,
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
}

/** 更新 MinerU Token 输入 */
export interface UpdateMineruTokenInput {
    name?: string
    token?: string
    remark?: string | null
    status?: number
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
    return {
        ...rest,
        tokenMasked: maskToken(rawToken),
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
 * 获取当前启用的 Token（完整值，供内部调用）
 * Requirements: 3.1.1.6
 */
export const getActiveTokenService = async (): Promise<mineruTokens | null> => {
    return await findActiveTokenDao()
}

/**
 * 获取当前启用的 Token 值
 * Requirements: 3.1.1.6, 3.1.1.7
 * @returns Token 值，如果没有启用的 Token 则返回 null
 */
export const getActiveTokenValueService = async (): Promise<string | null> => {
    const token = await findActiveTokenDao()
    return token?.token ?? null
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
 * 检查是否有可用的 Token
 * Requirements: 3.1.1.7
 * @returns 是否有启用的 Token
 */
export const hasActiveTokenService = async (): Promise<boolean> => {
    const token = await findActiveTokenDao()
    return token !== null
}

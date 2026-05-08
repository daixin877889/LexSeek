/**
 * MinerU Token DAO 层
 *
 * 提供 MinerU API Token 的数据访问功能
 * Requirements: 3.1.1.1-3.1.1.7
 */

import type { mineruTokens, Prisma } from '~~/generated/prisma/client'
import { MineruTokenStatus, type CreateMineruTokenInput, type UpdateMineruTokenInput, type MineruTokenListParams } from './mineruToken.service'

/**
 * 创建 MinerU Token
 */
export const createMineruTokenDao = async (data: CreateMineruTokenInput): Promise<mineruTokens> => {
    try {
        const token = await prisma.mineruTokens.create({
            data: {
                name: data.name,
                token: data.token,
                remark: data.remark,
                status: data.status ?? MineruTokenStatus.ENABLED,
                expiresAt: data.expiresAt ?? null,
            },
        })
        return token
    } catch (error) {
        logger.error('创建 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 MinerU Token
 */
export const findMineruTokenByIdDao = async (id: number): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: { id, deletedAt: null },
        })
        return token
    } catch (error) {
        logger.error('通过 ID 查询 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 通过名称查询 MinerU Token
 */
export const findMineruTokenByNameDao = async (name: string): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: { name, deletedAt: null },
        })
        return token
    } catch (error) {
        logger.error('通过名称查询 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 查询 MinerU Token 列表（分页）
 */
export const findManyMineruTokensDao = async (
    options: MineruTokenListParams = {}
): Promise<{ list: mineruTokens[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        status,
        keyword,
        orderBy = 'createdAt',
        orderDir = 'desc',
    } = options

    try {
        const where: any = { deletedAt: null }

        if (status !== undefined) {
            where.status = status
        }

        if (keyword) {
            where.OR = [
                { name: { contains: keyword, mode: 'insensitive' } },
                { remark: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [list, total] = await Promise.all([
            prisma.mineruTokens.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            prisma.mineruTokens.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询 MinerU Token 列表失败：', error)
        throw error
    }
}

/**
 * "可用 token" 的 where 条件：未删除 + 启用 + 未过期（NULL 表示永不过期）
 */
const usableTokenWhere = (now: Date): Prisma.mineruTokensWhereInput => ({
    deletedAt: null,
    status: MineruTokenStatus.ENABLED,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
})

/**
 * 获取一个当前可用的 Token（启用 + 未过期 + 未删除）
 *
 * 仅用于"无 task 上下文"的兜底（如旧任务 mineruTokenId=null 或绑定 token 已物理删除时的轮询退路）。
 * 创建新任务请用 pickLeastRecentlyUsedActiveTokenDao 走 LRU 负载均衡。
 */
export const findActiveTokenDao = async (): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: usableTokenWhere(new Date()),
            orderBy: { createdAt: 'desc' },
        })
        return token
    } catch (error) {
        logger.error('获取启用的 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 MinerU Token（不过滤 status / expiresAt）
 *
 * 用于轮询正在跑的任务时，按创建任务时绑定的 token id 反查 token 值。
 * 即使该 token 已被禁用或过期，正在跑的任务仍需用同一 token 才能查到结果，因此这里不过滤。
 * deletedAt 仍然过滤——已物理删除的 token 字段 token 值不可信，调用方应走兜底。
 */
export const findMineruTokenByIdRawDao = async (id: number): Promise<mineruTokens | null> => {
    try {
        const token = await prisma.mineruTokens.findFirst({
            where: { id, deletedAt: null },
        })
        return token
    } catch (error) {
        logger.error('通过 ID 反查 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * LRU 负载均衡选择一个可用 Token，并原子更新其 lastUsedAt
 *
 * 选择规则：status=启用 + 未删除 + (expiresAt IS NULL 或 expiresAt > NOW())
 * 排序规则：lastUsedAt asc nulls first（最久未用 / 从未用过的优先），同 lastUsedAt 时按 createdAt asc
 *
 * 用 `FOR UPDATE SKIP LOCKED` 让并发请求各自挑到不同 token（参考 agentRun.dao.ts claimPendingRunDAO）；
 * 否则两个并发选取的 SELECT 会读到同一行 → 都 UPDATE lastUsedAt → 短时间内同一 token 被打多次，负载分摊失效。
 */
export const pickLeastRecentlyUsedActiveTokenDao = async (): Promise<mineruTokens | null> => {
    try {
        return await prisma.$transaction(async (tx) => {
            // 只取 id：$queryRaw 返回的是 snake_case 列，与 mineruTokens 的 camelCase 类型不一致；
            // 后续 update 返回的才是 Prisma 标准对象。
            const rows = await tx.$queryRaw<Array<{ id: number }>>`
                SELECT id FROM mineru_tokens
                WHERE deleted_at IS NULL
                  AND status = ${MineruTokenStatus.ENABLED}
                  AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY last_used_at ASC NULLS FIRST, created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            `
            const candidate = rows[0]
            if (!candidate) {
                return null
            }
            return tx.mineruTokens.update({
                where: { id: candidate.id },
                data: { lastUsedAt: new Date() },
            })
        })
    } catch (error) {
        logger.error('LRU 选取 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 更新 MinerU Token
 */
export const updateMineruTokenDao = async (
    id: number,
    data: UpdateMineruTokenInput
): Promise<mineruTokens> => {
    try {
        const { expiresAt, ...rest } = data
        // expiresAt 显式区分 undefined（不修改）/ null（清空，永不过期）/ Date（设置）
        const updateData: Prisma.mineruTokensUpdateInput = {
            ...rest,
            updatedAt: new Date(),
        }
        if (expiresAt !== undefined) {
            updateData.expiresAt = expiresAt
        }
        const token = await prisma.mineruTokens.update({
            where: { id },
            data: updateData,
        })
        return token
    } catch (error) {
        logger.error('更新 MinerU Token 失败：', error)
        throw error
    }
}

/**
 * 软删除 MinerU Token
 */
export const softDeleteMineruTokenDao = async (id: number): Promise<void> => {
    try {
        await prisma.mineruTokens.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除 MinerU Token 失败：', error)
        throw error
    }
}

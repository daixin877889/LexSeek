/**
 * 提示词数据访问层
 *
 * 提供提示词的 CRUD 操作。Phase 6 改造：删除 prompts.nodeId 单值字段后，
 *  - 创建/更新/查询不再写入或读取 nodeId 列；
 *  - "节点维度"的查询统一通过 node_prompts 关联表 join；
 *  - 版本/激活/停用按 (name, type) 维度判定（一段提示词可被多节点引用）。
 */

import type {
    CreatePromptInput,
    UpdatePromptInput,
    PromptListParams,
    PromptType,
} from '#shared/types/node'
import type { Prisma } from '~~/generated/prisma/client'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 从版本号字符串中提取首个数字 token 作为排序权重
 * 适配 'v1' / 'v10' / '1.0.0' / '2.0.0' 等多种历史格式
 * 无数字时返回 -1，排在最后
 */
const extractVersionNumber = (version: string): number => {
    const match = version.match(/(\d+)/)
    return match ? parseInt(match[1]!, 10) : -1
}

/**
 * 版本号降序比较：先按数字大小，相同时按字符串字典序兜底
 * 修复 VarChar 字段直接 ORDER BY 导致 'v9' > 'v10' 的字典序卡死问题
 */
const compareVersionDesc = (a: string, b: string): number => {
    const na = extractVersionNumber(a)
    const nb = extractVersionNumber(b)
    if (na !== nb) return nb - na
    return b.localeCompare(a)
}

/**
 * 创建提示词
 *
 * Phase 6 改造：不再写入 prompts.nodeId（字段已删除）。
 * 节点关联通过单独调用 prisma.node_prompts.create 完成（由调用方决定）。
 *
 * @param data 提示词创建数据（CreatePromptInput.nodeId 字段已废弃，写入时被忽略）
 * @param version 版本号
 * @param tx 事务客户端（可选）
 * @returns 创建的提示词
 */
export const createPromptDao = async (
    data: CreatePromptInput,
    version: string,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.create({
            data: {
                name: data.name,
                title: data.title,
                content: data.content,
                variables: data.variables ?? [],
                version,
                type: data.type,
                status: 0, // 新创建的提示词默认未生效
            },
        })
        return prompt
    } catch (error) {
        logger.error('创建提示词失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询提示词
 *
 * 阶段 F 改造：node_prompts 关联键改为 (promptName, promptType) 业务身份，
 * prisma 不再有 prompts ↔ node_prompts 反向关系。这里改成两步查询：先拿 prompt 本身，
 * 再用 (name, type) 反查所有引用它的节点链接。
 *
 * @param id 提示词 ID
 * @param tx 事务客户端（可选）
 * @returns 提示词或 null（包含 nodePrompts 数组以兼容老调用方）
 */
export const findPromptByIdDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        const db = tx || prisma
        const prompt = await db.prompts.findUnique({
            where: { id, deletedAt: null },
        })
        if (!prompt) return null

        const links = await db.node_prompts.findMany({
            where: { promptName: prompt.name, promptType: prompt.type },
            orderBy: { displayOrder: 'asc' },
            include: { node: { select: { id: true, name: true, title: true } } },
        })

        // 与原 prisma 反向 include 的字段结构保持兼容：返回 prompt + nodePrompts 数组
        return Object.assign(prompt, { nodePrompts: links })
    } catch (error) {
        logger.error('通过 ID 查询提示词失败：', error)
        throw error
    }
}

/**
 * 查询提示词列表
 *
 * 阶段 F 改造：node_prompts 关联改为 (promptName, promptType) 业务身份。
 *  - `nodeId` 过滤：先查节点关联的 (name, type) 集合，再 OR 进 prompts where
 *  - `_count.nodePrompts` 走不通了：改为按 (name, type) groupBy 出每段身份的引用数，再补回每条 prompt
 *
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 提示词列表和总数
 */
export const findManyPromptsDao = async (
    options: PromptListParams = {},
    tx?: PrismaClient
) => {
    try {
        const {
            page = 1,
            pageSize = 10,
            nodeId,
            type,
            status,
            keyword,
            orderBy = 'createdAt',
            orderDir = 'desc',
        } = options
        const skip = (page - 1) * pageSize
        const db = tx || prisma

        // nodeId 过滤：先查该节点关联的所有 (name, type) 业务身份
        let nodeIdentityFilter: Prisma.promptsWhereInput | undefined
        if (nodeId !== undefined) {
            const nodeLinks = await db.node_prompts.findMany({
                where: { nodeId },
                select: { promptName: true, promptType: true },
            })
            if (nodeLinks.length === 0) {
                // 该节点没挂任何 prompt → 直接返回空集
                return { list: [], total: 0 }
            }
            nodeIdentityFilter = {
                OR: nodeLinks.map(l => ({ name: l.promptName, type: l.promptType })),
            }
        }

        // 构建查询条件
        const where: Prisma.promptsWhereInput = {
            deletedAt: null,
            ...(nodeIdentityFilter ?? {}),
            ...(type !== undefined && { type }),
            ...(status !== undefined && { status }),
            ...(keyword && {
                OR: [
                    { name: { contains: keyword, mode: 'insensitive' } },
                    { title: { contains: keyword, mode: 'insensitive' } },
                ],
            }),
        }

        // 并行查询列表和总数
        const [rawList, total] = await Promise.all([
            db.prompts.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            db.prompts.count({ where }),
        ])

        // 给每条 prompt 补 _count.nodePrompts（按 (name, type) groupBy 一次拉齐 → 内存映射）
        const referenceCounts = await db.node_prompts.groupBy({
            by: ['promptName', 'promptType'],
            where: {
                OR: rawList.map(p => ({ promptName: p.name, promptType: p.type })),
            },
            _count: { _all: true },
        })
        const countByKey = new Map(
            referenceCounts.map(rc => [`${rc.promptName}::${rc.promptType}`, rc._count._all]),
        )
        const list = rawList.map(p => ({
            ...p,
            _count: { nodePrompts: countByKey.get(`${p.name}::${p.type}`) ?? 0 },
        }))

        return { list, total }
    } catch (error) {
        logger.error('查询提示词列表失败：', error)
        throw error
    }
}

/**
 * 查询节点的所有提示词
 *
 * 阶段 F 改造：node_prompts 关联改为 (promptName, promptType) 业务身份，无 prisma 反向关系。
 * 这里先查节点的所有链接拿到 (name, type) 集合，再用 OR 拉所有匹配 prompts；
 * 排序保持原语义（type 升序 + version 降序）。
 *
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 提示词列表
 */
export const findPromptsByNodeIdDao = async (
    nodeId: number,
    tx?: PrismaClient
) => {
    try {
        const db = tx || prisma
        const links = await db.node_prompts.findMany({
            where: { nodeId },
            select: { promptName: true, promptType: true },
        })
        if (links.length === 0) return []

        const prompts = await db.prompts.findMany({
            where: {
                deletedAt: null,
                OR: links.map(l => ({ name: l.promptName, type: l.promptType })),
            },
            orderBy: { type: 'asc' },
        })
        return prompts.sort((a, b) => {
            if (a.type !== b.type) return a.type < b.type ? -1 : 1
            return compareVersionDesc(a.version, b.version)
        })
    } catch (error) {
        logger.error('查询节点提示词失败：', error)
        throw error
    }
}

/**
 * 查询节点指定类型的生效提示词
 *
 * 阶段 F 改造：node_prompts 按 (promptName, promptType) 业务身份关联。
 * 先查节点该类型的所有链接拿到 name 集合（同类型同节点理论上只挂一条，
 * 但兜底支持多条 → 按 displayOrder 升序取第一条），再按 (name, type) 拉取激活版本。
 *
 * @param nodeId 节点 ID
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 * @returns 提示词或 null
 */
export const findActivePromptDao = async (
    nodeId: number,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        const db = tx || prisma
        const links = await db.node_prompts.findMany({
            where: { nodeId, promptType: type },
            orderBy: { displayOrder: 'asc' },
            select: { promptName: true, promptType: true },
        })
        if (links.length === 0) return null

        for (const link of links) {
            const prompt = await db.prompts.findFirst({
                where: {
                    name: link.promptName,
                    type: link.promptType,
                    status: 1,
                    deletedAt: null,
                },
            })
            if (prompt) return prompt
        }
        return null
    } catch (error) {
        logger.error('查询生效提示词失败：', error)
        throw error
    }
}

/**
 * 查询提示词版本历史
 *
 * Phase 6 改造：版本范围由 (nodeId, name, type) 改为 (name, type)。
 * 一段提示词可以被多个节点引用，但版本历史只取决于其自身 (name, type) 标识。
 *
 * @param name 提示词名称
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 * @returns 版本列表
 */
export const findPromptVersionsDao = async (
    name: string,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        const prompts = await (tx || prisma).prompts.findMany({
            where: {
                name,
                type,
                deletedAt: null,
            },
        })
        return prompts.sort((a, b) => compareVersionDesc(a.version, b.version))
    } catch (error) {
        logger.error('查询提示词版本历史失败：', error)
        throw error
    }
}

/**
 * 获取提示词最新版本号
 *
 * Phase 6 改造：版本范围由 (nodeId, name, type) 改为 (name, type)。
 *
 * @param name 提示词名称
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 * @returns 最新版本号或 null
 */
export const getLatestVersionDao = async (
    name: string,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        const versions = await (tx || prisma).prompts.findMany({
            where: {
                name,
                type,
                deletedAt: null,
            },
            select: { version: true },
        })
        if (versions.length === 0) return null
        const sorted = versions
            .map(v => v.version)
            .sort(compareVersionDesc)
        return sorted[0] ?? null
    } catch (error) {
        logger.error('获取提示词最新版本号失败：', error)
        throw error
    }
}

/**
 * 更新提示词
 * @param id 提示词 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的提示词
 */
export const updatePromptDao = async (
    id: number,
    data: UpdatePromptInput,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.update({
            where: { id },
            data: {
                ...(data.title !== undefined && { title: data.title }),
                ...(data.content !== undefined && { content: data.content }),
                ...(data.variables !== undefined && { variables: data.variables }),
                updatedAt: new Date(),
            },
        })
        return prompt
    } catch (error) {
        logger.error('更新提示词失败：', error)
        throw error
    }
}

/**
 * 更新提示词状态
 * @param id 提示词 ID
 * @param status 状态
 * @param tx 事务客户端（可选）
 * @returns 更新后的提示词
 */
export const updatePromptStatusDao = async (
    id: number,
    status: number,
    tx?: PrismaClient
) => {
    try {
        const prompt = await (tx || prisma).prompts.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return prompt
    } catch (error) {
        logger.error('更新提示词状态失败：', error)
        throw error
    }
}

/**
 * 停用同一 (name, type) 下的所有生效提示词
 *
 * Phase 6 改造：作用域从"节点内同类型"改为"全局同 (name, type)"。
 * 因一段提示词可被多个节点引用，"激活某版本"语义改为：同 name+type 仅允许一条 status=1。
 *
 * @param name 提示词名称
 * @param type 提示词类型
 * @param tx 事务客户端（可选）
 */
export const deactivatePromptsByTypeDao = async (
    name: string,
    type: PromptType,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).prompts.updateMany({
            where: {
                name,
                type,
                status: 1,
                deletedAt: null,
            },
            data: {
                status: 0,
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('停用提示词失败：', error)
        throw error
    }
}

/**
 * 软删除提示词
 * @param id 提示词 ID
 * @param tx 事务客户端（可选）
 */
export const softDeletePromptDao = async (
    id: number,
    tx?: PrismaClient
) => {
    try {
        await (tx || prisma).prompts.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除提示词失败：', error)
        throw error
    }
}

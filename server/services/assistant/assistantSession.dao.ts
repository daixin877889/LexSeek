/**
 * AssistantSession DAO
 *
 * 操作 case_sessions 表的 scope='assistant' 子集。
 * 与 case 域 session.dao.ts 保持独立（不复用）——因为 case 域依赖 allowedTypes /
 * activeRun 取消等 case 语义，assistant 域更简单且不牵扯 case 关联。
 *
 * 所有写入路径经 Zod 前置校验，强制 scope='assistant' / caseId=null / type=1。
 * 参见 spec §4.10, §5.6.1-3。
 */

import { randomUUID } from 'node:crypto'
import {
    CreateAssistantSessionSchema,
    UpdateAssistantSessionSchema,
    ListAssistantSessionsSchema,
    type CreateAssistantSessionInput,
    type UpdateAssistantSessionInput,
    type ListAssistantSessionsInput,
} from './types'

/**
 * 创建 scope=assistant 的会话。
 *
 * - sessionId 由服务端生成 UUIDv4
 * - scope 固定为 'assistant'
 * - caseId 固定为 null
 * - type 固定为 1（普通对话）
 * - status 固定为 1（进行中）
 */
export async function createAssistantSessionDAO(input: CreateAssistantSessionInput) {
    const parsed = CreateAssistantSessionSchema.parse(input)
    return prisma.caseSessions.create({
        data: {
            sessionId: randomUUID(),
            scope: 'assistant',
            userId: parsed.userId,
            caseId: null,
            type: 1,
            status: 1,
            title: parsed.title ?? null,
        },
    })
}

/**
 * 按 sessionId + userId 取单个 assistant 会话。
 *
 * 过滤条件：scope='assistant'、deletedAt IS NULL、userId 匹配。
 * 跨用户或 scope=case 的 session 返回 null。
 */
export async function getAssistantSessionDAO(sessionId: string, userId: number) {
    return prisma.caseSessions.findFirst({
        where: {
            sessionId,
            scope: 'assistant',
            userId,
            deletedAt: null,
        },
    })
}

/**
 * 列表：当前用户的 assistant 会话，按 updatedAt desc 分页。
 */
export async function listAssistantSessionsDAO(input: ListAssistantSessionsInput) {
    const parsed = ListAssistantSessionsSchema.parse(input)
    const where = {
        scope: 'assistant',
        userId: parsed.userId,
        deletedAt: null,
    }
    const [list, total] = await Promise.all([
        prisma.caseSessions.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: (parsed.page - 1) * parsed.pageSize,
            take: parsed.pageSize,
            select: {
                sessionId: true,
                title: true,
                updatedAt: true,
                createdAt: true,
            },
        }),
        prisma.caseSessions.count({ where }),
    ])
    return {
        list: list.map(r => ({
            sessionId: r.sessionId,
            title: r.title,
            updatedAt: r.updatedAt.toISOString(),
            createdAt: r.createdAt.toISOString(),
        })),
        total,
        page: parsed.page,
        pageSize: parsed.pageSize,
    }
}

/**
 * 重命名（仅允许所有者）。
 *
 * updateMany 的 count=0 表示 session 不存在或 userId 不匹配，返回 success=false。
 */
export async function renameAssistantSessionDAO(
    input: UpdateAssistantSessionInput,
): Promise<{ success: boolean; error?: string }> {
    const parsed = UpdateAssistantSessionSchema.parse(input)
    const result = await prisma.caseSessions.updateMany({
        where: {
            sessionId: parsed.sessionId,
            scope: 'assistant',
            userId: parsed.userId,
            deletedAt: null,
        },
        data: {
            title: parsed.title,
            updatedAt: new Date(),
        },
    })
    if (result.count === 0) {
        return { success: false, error: '会话不存在或无权操作' }
    }
    return { success: true }
}

/**
 * 软删（仅允许所有者）。
 *
 * updateMany 的 count=0 表示 session 不存在、已删除或 userId 不匹配。
 */
export async function softDeleteAssistantSessionDAO(
    sessionId: string,
    userId: number,
): Promise<{ success: boolean; error?: string }> {
    const result = await prisma.caseSessions.updateMany({
        where: {
            sessionId,
            scope: 'assistant',
            userId,
            deletedAt: null,
        },
        data: { deletedAt: new Date() },
    })
    if (result.count === 0) {
        return { success: false, error: '会话不存在或无权操作' }
    }
    return { success: true }
}

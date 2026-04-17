/**
 * Session CRUD DAO 抽象层
 *
 * 从 xiaosuo-session*.ts 和 module-session*.ts 四个 API 中提取的公共逻辑。
 */

import { getRedisClient } from '~~/server/lib/redis'
import { v4 as uuidv4 } from 'uuid'

export interface SessionListItem {
    sessionId: string
    type: number
    metadata: Record<string, any>
    hasActiveRun: boolean
    createdAt: Date
    updatedAt: Date
}

interface ListSessionsParams {
    caseId: number
    userId: number
    type: number
    metadataFilter?: { path: string[]; equals: any }
    orderBy?: Record<string, 'asc' | 'desc'>
}

interface CreateSessionParams {
    caseId: number
    userId: number
    type: number
    metadata: Record<string, any>
    dedupeKey?: string
    dedupeTtlMs?: number
}

interface SoftDeleteParams {
    sessionId: string
    userId: number
    allowedTypes: number[]
}

interface RenameParams {
    sessionId: string
    userId: number
    newTitle: string
}

/**
 * 验证案件属于指定用户。
 * @returns 案件记录，若不存在或不属于该用户则返回 null
 */
export async function validateCaseOwnershipDAO(caseId: number, userId: number) {
    return prisma.cases.findFirst({
        where: { id: caseId, userId, deletedAt: null },
    })
}

/**
 * 查询 session 列表并附带 activeRun 状态。
 * @returns session 列表，若案件不属于该用户则返回 null
 */
export async function listSessionsWithActiveRunDAO(
    params: ListSessionsParams,
): Promise<SessionListItem[] | null> {
    const caseRecord = await validateCaseOwnershipDAO(params.caseId, params.userId)
    if (!caseRecord) return null

    const where: Record<string, any> = {
        caseId: params.caseId,
        type: params.type,
        deletedAt: null,
    }
    if (params.metadataFilter) {
        where.metadata = params.metadataFilter
    }

    const sessions = await prisma.caseSessions.findMany({
        where,
        orderBy: params.orderBy ?? { updatedAt: 'desc' },
    })

    return Promise.all(
        sessions.map(async (session) => {
            const activeRun = await getActiveRunService(session.sessionId)
            return {
                sessionId: session.sessionId,
                type: session.type,
                metadata: session.metadata as Record<string, any>,
                hasActiveRun: !!activeRun,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            }
        }),
    )
}

/**
 * 创建新 session，支持 Redis 并发防重。
 * @returns { sessionId, isNew } 或 null（案件不属于用户）
 */
export async function createSessionDAO(
    params: CreateSessionParams,
): Promise<{ sessionId: string; isNew: boolean } | null> {
    const caseRecord = await validateCaseOwnershipDAO(params.caseId, params.userId)
    if (!caseRecord) return null

    const { dedupeKey, dedupeTtlMs = 3000 } = params

    if (dedupeKey) {
        let lockAcquired = true
        try {
            const redis = getRedisClient()
            const result = await redis.set(
                `session_dedupe:${dedupeKey}`,
                'locked',
                'PX',
                dedupeTtlMs,
                'NX',
            )
            lockAcquired = result === 'OK'
        } catch (err) {
            logger.warn('Redis 防重锁异常，降级直接创建 session', err)
            lockAcquired = true
        }

        if (!lockAcquired) {
            const recent = await prisma.caseSessions.findFirst({
                where: { caseId: params.caseId, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            })
            if (recent) return { sessionId: recent.sessionId, isNew: false }
            // 极端情况：防重锁存在但 session 已被删除，降级创建
        }
    }

    const sessionId = uuidv4()
    await prisma.caseSessions.create({
        data: {
            sessionId,
            caseId: params.caseId,
            type: params.type,
            metadata: params.metadata,
        },
    })

    return { sessionId, isNew: true }
}

/**
 * 查找未删除的 session 并校验权限（内部公共逻辑）。
 *
 * 兼容 scope=case（存量 userId 可能为 NULL，回退 session.case.userId）
 * 与 scope=assistant（session.case 为 null，只能用 session.userId）。
 */
async function findSessionWithOwnershipCheck(sessionId: string, userId: number) {
    const session = await prisma.caseSessions.findFirst({
        where: { sessionId, deletedAt: null },
        include: { case: { select: { userId: true } } },
    })
    if (!session) return { session: null, error: 'Session 不存在' as const }

    const ownerId = session.userId ?? session.case?.userId
    if (ownerId == null || ownerId !== userId) {
        return { session: null, error: '无权操作该 Session' as const }
    }
    return { session, error: null }
}

/**
 * 软删除 session，支持类型校验和 activeRun 取消。
 * @returns { success, error? }
 */
export async function softDeleteSessionDAO(
    params: SoftDeleteParams,
): Promise<{ success: boolean; error?: string }> {
    const { sessionId, userId, allowedTypes } = params

    const { session, error } = await findSessionWithOwnershipCheck(sessionId, userId)
    if (!session) return { success: false, error }

    if (!allowedTypes.includes(session.type)) {
        return { success: false, error: `Session 类型 ${session.type} 不允许删除` }
    }

    const activeRun = await getActiveRunService(sessionId)
    if (activeRun) {
        await cancelRunService(activeRun.id)
    }

    await prisma.caseSessions.update({
        where: { sessionId },
        data: { deletedAt: new Date() },
    })

    return { success: true }
}

/**
 * 重命名 session（通过 jsonb_set 原子更新 metadata.title）。
 * @returns { success, error? }
 */
export async function renameSessionDAO(
    params: RenameParams,
): Promise<{ success: boolean; error?: string }> {
    const { sessionId, userId, newTitle } = params

    const { session, error } = await findSessionWithOwnershipCheck(sessionId, userId)
    if (!session) return { success: false, error }

    await prisma.$queryRaw`
        UPDATE case_sessions
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{title}',
            ${JSON.stringify(newTitle)}::jsonb
        ),
        updated_at = now()
        WHERE session_id = ${sessionId}
    `

    return { success: true }
}

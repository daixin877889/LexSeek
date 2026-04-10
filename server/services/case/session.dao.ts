/**
 * Session CRUD DAO 抽象层
 *
 * 从 xiaosuo-session*.ts 和 module-session*.ts 四个 API 中提取的公共逻辑。
 */

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

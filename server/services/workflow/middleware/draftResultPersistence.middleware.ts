/**
 * 文书草稿结果持久化中间件
 *
 * beforeAgent: 将 draft.status 置为 'filling'，表示 Agent 开始填写
 * afterAgent:
 *   - structuredResponse 有值 → 写入 values + metadata.suggestions，status='ready'
 *   - structuredResponse 缺失 → status='failed'
 */

import { createMiddleware } from 'langchain'
import { updateDocumentDraftDAO } from '../../assistant/document/documentDraft.dao'

/** 中间件参数 */
interface DraftResultPersistenceOptions {
    /** 草稿 ID */
    draftId: number
    /**
     * 会话 ID（LangGraph thread_id）
     * 当前仅记录，Task 3.10 补齐 sessionId 关联查询后使用
     */
    sessionId: string
}

export const draftResultPersistenceMiddleware = (options: DraftResultPersistenceOptions) => {
    const { draftId } = options

    return createMiddleware({
        name: 'DraftResultPersistenceMiddleware',

        beforeAgent: {
            hook: async (_state: any) => {
                try {
                    await updateDocumentDraftDAO(draftId, { status: 'filling' })
                    logger.info('draft 持久化：置 filling', { draftId })
                } catch (error) {
                    logger.error('draft 持久化 beforeAgent 失败', { draftId, error })
                }
            },
        },

        afterAgent: {
            hook: async (state: any) => {
                try {
                    const structured = state.structuredResponse
                    if (!structured) {
                        await updateDocumentDraftDAO(draftId, { status: 'failed' })
                        logger.warn('draft 持久化：structuredResponse 缺失，置 failed', { draftId })
                        return
                    }
                    const values = structured.values ?? {}
                    const suggestions = structured.suggestions
                    await updateDocumentDraftDAO(draftId, {
                        values,
                        metadata: suggestions ? { suggestions } : undefined,
                        status: 'ready',
                    })
                    logger.info('draft 持久化：置 ready', { draftId, fieldCount: Object.keys(values).length })
                } catch (error) {
                    logger.error('draft 持久化 afterAgent 失败', { draftId, error })
                    try {
                        await updateDocumentDraftDAO(draftId, { status: 'failed' })
                    } catch { /* 主错误已记录日志 */ }
                }
            },
        },
    })
}

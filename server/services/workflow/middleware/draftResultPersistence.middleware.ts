/**
 * 文书草稿结果持久化中间件
 *
 * beforeAgent: 将 draft.status 置为 'filling'，表示 Agent 开始填写
 * afterAgent:
 *   - structuredResponse 有值 → 写入 values + metadata.suggestions，status='ready'
 *   - structuredResponse 缺失 → fallback：尝试从最后一条 AIMessage 文本中解析 ```json 代码块
 *     （部分模型未严格走 responseFormat 工具调用，会把 JSON 写在消息体里）
 *   - fallback 仍失败 → status='failed'
 */

import { createMiddleware } from 'langchain'
import { updateDocumentDraftDAO } from '../../assistant/document/documentDraft.dao'
import { createSnapshotService } from '../../assistant/document/documentDraftSnapshot.service'
import { applyAITitleIfAllowedService } from '../../assistant/document/documentDraft.service'
import { extractFirstJsonObject } from '../../assistant/contract/utils/llmJson'
import { extractLastAIMessageContent } from './analysisResultPersistence.middleware'
import type { DocumentDraftStructured } from '#shared/types/document'

/**
 * 从 AI 消息文本里兜底解析 JSON：
 *  1. 优先匹配 ```json ... ``` 代码块
 *  2. 退化用 extractFirstJsonObject 平衡括号扫描首个 JSON 对象
 *
 * 解析失败返回 null，让上层走 failed 分支。
 */
function tryParseStructuredFromText(text: string): DocumentDraftStructured | null {
    if (!text || typeof text !== 'string') return null

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidates: string[] = []
    if (fenceMatch?.[1]) candidates.push(fenceMatch[1])
    const fallback = extractFirstJsonObject(text)
    if (fallback) candidates.push(fallback)

    for (const raw of candidates) {
        try {
            const parsed = JSON.parse(raw.trim()) as DocumentDraftStructured
            if (parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object') {
                return parsed
            }
        } catch {
            // 继续尝试下一个候选
        }
    }
    return null
}

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
                    let structured: DocumentDraftStructured | null = state.structuredResponse ?? null

                    // fallback：模型把 JSON 写到消息体里时尝试解析最后一条 AI 消息
                    if (!structured) {
                        const messages = Array.isArray(state.messages) ? state.messages : []
                        const lastAiContent = extractLastAIMessageContent(messages)
                        if (lastAiContent) {
                            structured = tryParseStructuredFromText(lastAiContent)
                            if (structured) {
                                logger.info('draft 持久化：从消息体解析 JSON 兜底成功', { draftId })
                            }
                        }
                    }

                    if (!structured) {
                        await updateDocumentDraftDAO(draftId, { status: 'failed' })
                        logger.warn('draft 持久化：structuredResponse 缺失且消息体无可解析 JSON，置 failed', { draftId })
                        return
                    }

                    const values = structured.values ?? {}
                    const suggestions = structured.suggestions
                    const aiTitle = typeof structured.aiTitle === 'string' ? structured.aiTitle.trim() : ''

                    // 先写 ai-extract 快照（失败仅 warn 不阻塞）
                    try {
                        await createSnapshotService(draftId, 'ai-extract', {
                            values,
                            aiTitle: aiTitle || null,
                        })
                    } catch (err) {
                        logger.warn('draft 持久化：写 ai-extract 快照失败（不阻塞）', { draftId, error: err })
                    }

                    // 主写入 —— 这一步是必须成功的，失败走外层 catch
                    await updateDocumentDraftDAO(draftId, {
                        values,
                        metadata: suggestions ? { suggestions } : undefined,
                        status: 'ready',
                    })

                    // 有 aiTitle 则尝试应用（仅 titleOverridden=false 生效；失败仅 warn）
                    if (aiTitle) {
                        try {
                            await applyAITitleIfAllowedService(draftId, aiTitle)
                        } catch (err) {
                            logger.warn('draft 持久化：应用 AI 标题失败（不阻塞）', { draftId, error: err })
                        }
                    }

                    logger.info('draft 持久化：置 ready', {
                        draftId,
                        fieldCount: Object.keys(values).length,
                        hasAITitle: !!aiTitle,
                    })
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

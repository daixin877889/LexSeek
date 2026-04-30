/**
 * 文书草稿结果持久化中间件
 *
 * beforeAgent: 将 draft.status 置为 'filling'，表示 Agent 开始填写
 * afterAgent:
 *   - structuredResponse 有值 → 写入 values + metadata.suggestions，status='ready'
 *   - structuredResponse 缺失 → 多层 fallback：
 *      1) 从最后一条 AIMessage 的 tool_use blocks 提取 input（用 jsonrepair 容错）
 *      2) 从最后一条 AIMessage 文本中解析 ```json``` 代码块
 *   - 全部失败 → status='failed'
 */

import { createMiddleware } from 'langchain'
import { jsonrepair } from 'jsonrepair'
import { updateDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import { createSnapshotService } from '~~/server/services/assistant/document/documentDraftSnapshot.service'
import { applyAITitleIfAllowedService } from '~~/server/services/assistant/document/documentDraft.service'
import { extractFirstJsonObject } from '~~/server/services/assistant/contract/utils/llmJson'
import { extractLastAIMessageContent } from '~~/server/agents/case-module/middleware/analysisResultPersistence.middleware'
import type { DocumentDraftStructured } from '#shared/types/document'

/**
 * 从最后一条 AIMessage 的 tool_use blocks 中提取 toolStrategy 注入的 final tool input。
 *
 * 真根因实证：deepseek-v4-flash 等模型在长 JSON 输出中可能不正确转义内嵌引号
 * （如 `"原告"犯错"扣款"` 中间双引号没转义为 `\"`）。LangChain 的 toolStrategy 拿到
 * 无效 JSON 后**静默不创建 structuredResponse 通道**，graph 自然 done →
 * structuredResponse 为 undefined → hook 走 failed 分支。
 *
 * 这里直接从 messages 里找最后一条 AIMessage 的 tool_use block，用 jsonrepair 修复
 * broken JSON（自动补 escape、引号、逗号），再 JSON.parse 拿到 LLM 原始填充结果。
 *
 * 解析失败返回 null。
 */
function tryParseStructuredFromToolUse(state: unknown): DocumentDraftStructured | null {
    const messages = (state as { messages?: unknown[] })?.messages
    if (!Array.isArray(messages) || messages.length === 0) return null

    // 倒序找最后一条带 tool_use 的 AI message
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as { content?: unknown; type?: string; _getType?: () => string } | null | undefined
        if (!msg) continue
        const msgType = msg._getType?.() ?? msg.type
        if (msgType !== 'ai' && msgType !== 'AIMessageChunk') continue
        const content = msg.content
        if (!Array.isArray(content)) continue

        for (const block of content) {
            if (!block || typeof block !== 'object') continue
            const b = block as { type?: string; name?: string; input?: unknown }
            if (b.type !== 'tool_use') continue
            const inputStr = typeof b.input === 'string'
                ? b.input
                : (b.input != null ? JSON.stringify(b.input) : '')
            if (!inputStr) continue
            try {
                // 优先直接 parse；失败的话用 jsonrepair 容错修复
                let parsed: unknown
                try {
                    parsed = JSON.parse(inputStr)
                } catch {
                    parsed = JSON.parse(jsonrepair(inputStr))
                }
                if (parsed && typeof parsed === 'object'
                    && (parsed as { values?: unknown }).values
                    && typeof (parsed as { values?: unknown }).values === 'object') {
                    return parsed as DocumentDraftStructured
                }
            } catch {
                // 当前 block 无法解析，尝试下一条 tool_use block
            }
        }
        // 找到 AI message 就停止（即使没解出来也不再往前找——避免拿到中间步骤的 tool 调用）
        break
    }
    return null
}

/**
 * 从 AI 消息文本里兜底解析 JSON：
 *  1. 优先匹配 ```json ... ``` 代码块
 *  2. 退化用 extractFirstJsonObject 平衡括号扫描首个 JSON 对象
 *  3. 如果普通 JSON.parse 失败，用 jsonrepair 容错修复（同样是模型转义不当问题）
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
            let parsed: DocumentDraftStructured
            try {
                parsed = JSON.parse(raw.trim()) as DocumentDraftStructured
            } catch {
                parsed = JSON.parse(jsonrepair(raw.trim())) as DocumentDraftStructured
            }
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

                    // Fallback A: 从最后一条 AIMessage 的 tool_use blocks 提取（jsonrepair 容错）
                    // 真根因：deepseek-v4-flash 等模型生成长 JSON 时未转义内嵌引号，
                    // toolStrategy 静默拒绝 → structuredResponse 通道不创建，但 LLM 真填的数据
                    // 留在 tool_use.input 字符串里。此 fallback 是核心修复路径。
                    if (!structured) {
                        structured = tryParseStructuredFromToolUse(state)
                        if (structured) {
                            logger.info('draft 持久化：从 tool_use.input 修复 JSON 兜底成功', {
                                draftId,
                                fieldCount: Object.keys(structured.values ?? {}).length,
                            })
                        }
                    }

                    // Fallback B: 模型把 JSON 写到消息体 text 里（部分模型走 prompt 路径）
                    if (!structured) {
                        const messages = Array.isArray(state.messages) ? state.messages : []
                        const lastAiContent = extractLastAIMessageContent(messages)
                        if (lastAiContent) {
                            structured = tryParseStructuredFromText(lastAiContent)
                            if (structured) {
                                logger.info('draft 持久化：从消息体 text 解析 JSON 兜底成功', { draftId })
                            }
                        }
                    }

                    if (!structured) {
                        await updateDocumentDraftDAO(draftId, { status: 'failed' })
                        logger.warn('draft 持久化：structuredResponse / tool_use / 消息体均无可解析 JSON，置 failed', { draftId })
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

/**
 * 调用 DB 配置的节点 LLM 并解析为 typed JSON 的统一入口。
 *
 * 吸收 analyzeSingleClause / summarizeOverview 等"节点配置 → invoke → JSON 解析 → schema 校验"
 * 的全部样板（约 80 行 ×N 处）。调用方只需提供 nodeName / temperature / schema /
 * buildPrompt(template) / errorPrefix，后续全部走统一逻辑。
 */
import type { z } from 'zod'
import { logger } from '#shared/utils/logger'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { logContextOverflow } from '~~/server/services/agent-platform/context/contextErrorLogger'
import { extractFirstJsonObject, summarizeJsonShape } from '~~/server/services/assistant/contract/utils/llmJson'

export interface InvokeNodeJsonOptions<T> {
    /** nodes 表 name 字段 */
    nodeName: string
    /** sampling temperature */
    temperature: number
    /** Zod schema，用于校验 LLM 输出形状 */
    schema: z.ZodType<T>
    /**
     * 渲染 system prompt：从 DB 拿到的 template 字符串 → 已渲染好的 prompt。
     * 调用方负责具体变量替换；本 helper 不关心模板细节。
     */
    buildPrompt: (template: string) => string
    /** 日志/异常前缀（如 `条款 #${clauseIndex}` / `summarizeOverview`） */
    errorPrefix: string
    /** 透传到 logger.warn / logContextOverflow.extra 的诊断字段 */
    logContext?: Record<string, unknown>
}

/**
 * 加载节点配置 → 渲染 prompt → invoke → extractFirstJsonObject → JSON.parse → schema.safeParse。
 *
 * 任何步骤失败都先 `logger.warn` 携带完整诊断信息（path/issues/rawShape/rawContent 预览），
 * 再抛出带 `errorPrefix` 的 Error，方便上层 SSE 错误事件直接透传。
 */
export async function invokeNodeJson<T>(opts: InvokeNodeJsonOptions<T>): Promise<T> {
    const { nodeName, temperature, schema, buildPrompt, errorPrefix, logContext = {} } = opts

    const config = await getValidNodeConfig(nodeName)
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error(`${nodeName}: 无可用 API 密钥`)

    const template = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
    if (!template) {
        throw new Error(`${nodeName}: DB 未配置 system 类型的启用态提示词`)
    }

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature,
        // streaming:false 强制底层 LLM 请求走非流式协议。invokeNodeJson 内部
        // 等待完整响应再 JSON.parse，本来就是非流式语义；显式关掉避免
        // afterAgent fire-and-forget 调用时 LLM token chunks 通过 callback
        // 链泄漏到主 SSE 通道（用户在小索消息流里看到孤立 JSON 代码块的根因）
        streaming: false,
    })

    const prompt = buildPrompt(template)

    let response
    try {
        // 双层 tag 防止后台 LLM 调用泄漏到主 SSE 通道：
        //   1) langsmith:nostream — LangGraph 内置 TAG_NOSTREAM 短路，
        //      StreamMessagesHandler 不记录 metadatas[runId]，
        //      handleChatModelStart/handleLLMNewToken/handleLLMEnd 均静默退出，
        //      事件从源头不进 SSE 流（@langchain/langgraph/dist/pregel/messages.cjs:55-72）。
        //   2) internal — 项目约定（同 intentClassifier.service.ts），
        //      若上游 contract 失效，agentWorker.stripSystemMessages 仍可在
        //      SSE 转发层兜底过滤（agentWorker.ts:isInternalLLMEvent）。
        // 注意：streaming:false 单独不够，因为非流式时 LangGraph 的 handleLLMEnd
        // 会把完整响应一次性 emit 出去（messages.cjs:67-70），用户看到的孤立
        // JSON 代码块就是这条路径泄漏的，必须靠 tag 阻断。
        response = await model.invoke(prompt, { tags: ['langsmith:nostream', 'internal'] })
    } catch (err) {
        logContextOverflow(err, {
            source: nodeName,
            modelName: config.modelName,
            sdkType: config.modelSdkType,
            contextWindow: config.modelContextWindow,
            extra: { ...logContext, promptLength: prompt.length },
        })
        throw err
    }

    const content = typeof response.content === 'string' ? response.content : ''

    const jsonText = extractFirstJsonObject(content)
    if (!jsonText) {
        logger.warn(`${errorPrefix}: LLM 未返回 JSON`, {
            ...logContext,
            rawContent: content.slice(0, 500),
        })
        throw new Error(`${errorPrefix} LLM 未返回 JSON`)
    }

    let rawJson: unknown
    try {
        rawJson = JSON.parse(jsonText)
    } catch (err) {
        logger.warn(`${errorPrefix}: JSON.parse 失败`, {
            ...logContext,
            jsonText: jsonText.slice(0, 500),
            errMessage: err instanceof Error ? err.message : String(err),
        })
        throw new Error(`${errorPrefix} JSON 解析失败`)
    }

    const parsed = schema.safeParse(rawJson)
    if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(i => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
            code: i.code,
        }))
        logger.warn(`${errorPrefix}: schema 校验失败`, {
            ...logContext,
            rawShape: summarizeJsonShape(rawJson),
            issues,
            rawJsonPreview: JSON.stringify(rawJson).slice(0, 500),
            rawContentPreview: content.slice(0, 300),
        })
        const firstIssue = parsed.error.issues[0]
        const pretty = firstIssue
            ? `${firstIssue.path.join('.') || '(root)'}: ${firstIssue.message}`
            : 'unknown'
        throw new Error(`${errorPrefix} schema 校验失败: ${pretty}`)
    }

    return parsed.data
}

/**
 * 渲染后的 prompt 仍含 `{{var}}` 占位符时打 warn（不抛错）。
 *
 * 各 service 的 renderPromptTemplate 都需做这件事，统一收口避免散点。
 */
export function warnUnreplacedTemplateVars(
    rendered: string,
    source: string,
    extra?: Record<string, unknown>,
): void {
    const unreplaced = rendered.match(/\{\{(\w+)\}\}/g)
    if (unreplaced) {
        logger.warn(`${source}: 提示词存在未替换的模板变量`, {
            ...(extra ?? {}),
            unreplacedVars: unreplaced,
        })
    }
}

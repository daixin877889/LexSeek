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
import { assembleSystemPromptTemplate } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import { withLangfuseContext } from '~~/server/lib/langfuse'

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

/** 顶部 const，不暴露 API（spec §2.2 YAGNI 原则） */
const MAX_RETRIES = 3

/**
 * 加载节点配置 → 渲染 prompt → invoke → extractFirstJsonObject → JSON.parse → schema.safeParse。
 *
 * **PR8 升级**：schema safeParse fail 时自动 retry 最多 3 次。retry prompt 用
 * 「重新渲染 base prompt + 拼接 `## 上次输出违反 schema：${path}: ${message}` 段」方式，
 * 不堆叠、不走 multi-turn history。
 *
 * **为什么手写 retry 而不用 LangChain `Runnable.withRetry`**：
 *   - withRetry / modelRetryMiddleware 都基于 throw Error 触发（签名 `retryOn: (e: Error) => boolean`）；
 *     本场景 schema fail 是 `safeParse` 业务校验，不抛异常进 retry boundary
 *   - withRetry 的 `onFailedAttempt(error, input)` 签名只读 input 不返回新 input，无法实现
 *     "retry 时把上次错误带回 prompt" 这种 input mutation
 *   - 框架 retry 适合 transport 层（429 / timeout / 5xx），业务级条件 retry 必须手写
 *   - 项目内既有先例：`server/services/material/ocr.service.ts:38-55` 同样手写 for loop + 条件判断
 *
 * **不 retry 的场景（spec §3 决定）**：
 *   - LLM invoke 抛错（网络/超时/context overflow）→ 直接 throw（既有 logContextOverflow 路径不变）
 *   - extractFirstJsonObject 返回 null（LLM 输出连 JSON 格式都没出）
 *   - JSON.parse 失败（同上）
 * 这些场景 retry 大概率仍失败，浪费 token。
 *
 * **三态 logger.warn 埋点**（运维监控 retry 有效率，spec §3.4，全中文与项目 `ocr.service.ts` 风格一致）：
 *   - `${errorPrefix}: schema 校验失败，触发重试` — 每次 schema fail 且未达 MAX_RETRIES 时
 *   - `${errorPrefix}: 第 N 次重试成功` — attempt > 1 且 PASS 时
 *   - `${errorPrefix}: 重试 MAX_RETRIES 次仍失败` — 三次都 fail 时
 *
 * 任何步骤失败都先 `logger.warn` 携带完整诊断信息，再抛出带 `errorPrefix` 的 Error。
 */
export async function invokeNodeJson<T>(opts: InvokeNodeJsonOptions<T>): Promise<T> {
    return withLangfuseContext({ vertical: 'invoke-node-json' }, () => invokeNodeJsonInner(opts))
}

async function invokeNodeJsonInner<T>(opts: InvokeNodeJsonOptions<T>): Promise<T> {
    const { nodeName, temperature, schema, buildPrompt, errorPrefix, logContext = {} } = opts

    const config = await getValidNodeConfig(nodeName)
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error(`${nodeName}: 无可用 API 密钥`)

    // 拼接所有启用的 system prompt（反越狱护栏 + 业务 prompt 等），调用方 buildPrompt 负责业务变量替换
    const template = assembleSystemPromptTemplate(config.prompts)
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

    // basePrompt 在所有 attempt 中相同（buildPrompt 是纯函数 + template 不变），
    // 提到循环外只调用一次，避免 retry 时重复渲染大模板。
    const basePrompt = buildPrompt(template)
    let lastFirstIssue = ''

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const currentPrompt = attempt === 1
            ? basePrompt
            : `${basePrompt}\n\n## 上次输出违反 schema：\n${lastFirstIssue}\n请重新生成符合 schema 的 JSON。`

        let response
        try {
            // 三层 tag 防止后台 LLM 调用泄漏到主 SSE 通道：
            //   1) langsmith:nostream — LangGraph StreamMessagesHandler 唯二识别的 tag
            //      之一（messages.cjs:56 严格相等匹配，无前缀匹配）。命中后
            //      handleChatModelStart 不记录 metadatas[runId]，
            //      handleLLMNewToken/handleLLMEnd 静默退出，事件从源头不进 SSE 流。
            //      历史教训：项目曾只挂 'langfuse:nostream' 自定义 tag，langgraph
            //      根本不识别 → afterAgentMemoryMiddleware fire-and-forget 调用
            //      在主流关闭后仍 fire newToken，写已关 controller 抛 ERR_INVALID_STATE。
            //   2) langfuse:nostream — Langfuse SDK 自身识别的非导出标记，OTel 模式
            //      下由 LangfuseSpanProcessor.shouldExportSpan 统一豁免，避免内部
            //      JSON 节点 trace 进 Langfuse。
            //   3) internal — 项目约定（同 intentClassifier.service.ts），
            //      若上游 contract 失效，agentWorker.stripSystemMessages 仍可在
            //      SSE 转发层兜底过滤（agentWorker.ts:isInternalLLMEvent）。
            // 注意：streaming:false 单独不够，因为非流式时 LangGraph 的 handleLLMEnd
            // 会把完整响应一次性 emit 出去（messages.cjs:67-70），用户看到的孤立
            // JSON 代码块就是这条路径泄漏的，必须靠 tag 阻断。
            response = await model.invoke(currentPrompt, {
                tags: ['langsmith:nostream', 'langfuse:nostream', 'internal'],
            })
        } catch (err) {
            // LLM invoke 抛错：不 retry，直接抛
            logContextOverflow(err, {
                source: nodeName,
                modelName: config.modelName,
                sdkType: config.modelSdkType,
                contextWindow: config.modelContextWindow,
                extra: { ...logContext, promptLength: currentPrompt.length, attempt },
            })
            throw err
        }

        const content = typeof response.content === 'string' ? response.content : ''

        const jsonText = extractFirstJsonObject(content)
        if (!jsonText) {
            // JSON 提取 fail：不 retry，直接抛
            logger.warn(`${errorPrefix}: LLM 未返回 JSON`, {
                ...logContext,
                rawContent: content.slice(0, 500),
                attempt,
            })
            throw new Error(`${errorPrefix} LLM 未返回 JSON`)
        }

        let rawJson: unknown
        try {
            rawJson = JSON.parse(jsonText)
        } catch (err) {
            // JSON.parse fail：不 retry，直接抛
            logger.warn(`${errorPrefix}: JSON.parse 失败`, {
                ...logContext,
                jsonText: jsonText.slice(0, 500),
                errMessage: err instanceof Error ? err.message : String(err),
                attempt,
            })
            throw new Error(`${errorPrefix} JSON 解析失败`)
        }

        const parsed = schema.safeParse(rawJson)
        if (parsed.success) {
            if (attempt > 1) {
                logger.warn(`${errorPrefix}: 第 ${attempt} 次重试成功`, {
                    ...logContext,
                    attempt,
                })
            }
            return parsed.data
        }

        // schema fail：拼 firstIssue 准备下一次 retry，或最终 throw
        const firstIssue = parsed.error.issues[0]
        const pretty = firstIssue
            ? `${firstIssue.path.join('.') || '(root)'}: ${firstIssue.message}`
            : 'unknown'
        lastFirstIssue = pretty

        if (attempt < MAX_RETRIES) {
            logger.warn(`${errorPrefix}: schema 校验失败，触发重试`, {
                ...logContext,
                attempt,
                firstIssue: pretty,
                rawShape: summarizeJsonShape(rawJson),
            })
        }
    }

    // 3 次都 fail
    logger.warn(`${errorPrefix}: 重试 ${MAX_RETRIES} 次仍失败`, {
        ...logContext,
        totalAttempts: MAX_RETRIES,
        firstIssue: lastFirstIssue,
    })
    throw new Error(`${errorPrefix} schema 校验失败: ${lastFirstIssue}`)
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

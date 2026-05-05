/**
 * defineDomainAgent 工厂运行时
 *
 * runDomainAgent 主流程：
 * 1. 加载 NodeConfig（带缓存）
 * 2. 创建 chatModel
 * 3. 构建 system prompt（plain text）
 * 4. 构建 skillsMiddleware（按节点动态挂载，null 则跳过）
 * 5. 组装中间件栈（通用平台中间件 + skillsMiddleware + 业务私有中间件）
 * 6. 组装工具（节点工具 + customTools + 4 个 skill 工具，仅当 skillsMw 存在时）
 * 7. 创建 agent（checkpointer + store）
 * 8. hooks.beforeRun → agent.stream → 包装 afterRun 到流关闭时调用
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 11
 */

import { createAgent, summarizationMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import type { StructuredToolInterface } from '@langchain/core/tools'

import { getNodeConfigCached } from '~~/server/services/agent-platform/nodeConfig/loader'
import { renderSystemPrompt } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import { buildSystemPromptForAgent } from '~~/server/services/agent-platform/context/moduleContextBuilder'
import { createChatModel } from '~~/server/services/agent-platform/modelFactory'
import { resolveThinkingFromNodeConfig } from '~~/server/services/node/node.service'
import { getCheckpointer, getStore } from '~~/server/services/agent-platform/checkpointer'
import { getToolInstancesService } from '~~/server/services/agent-platform/tools/index'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
import { resolveContextWindow } from '~~/server/services/agent-platform/context/messageCompressor'

import {
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    createScopeGuardMiddleware,
    createAuditMiddleware,
    createToolCallLimitMiddlewares,
    createMessageIntegrityMiddleware,
} from '~~/server/services/agent-platform/middleware/index'

import { createTool as createReadSkillFileTool } from '~~/server/services/agent-platform/tools/readSkillFile.tool'
import { createTool as createWriteSkillFileTool } from '~~/server/services/agent-platform/tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '~~/server/services/agent-platform/tools/runSkillScript.tool'
import { createTool as createRunSkillCommandTool } from '~~/server/services/agent-platform/tools/runSkillCommand.tool'

import { createCustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'

import { buildLangfuseTopLevelConfig, withLangfuseContext } from '~~/server/lib/langfuse'
import type { LangfuseVertical } from '~~/server/lib/langfuse'

import { SessionScope } from '#shared/types/agentEvent'
import type { DomainAgentDefinition, StateGraphAgentContext } from './types'
import type { AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import type { ToolContext } from '~~/server/services/agent-platform/tools/types'

/**
 * SessionScope → 默认 LangfuseVertical 映射。
 * 业务子节点（case-analysis / case-module / init-analysis 等）由更内层的
 * withLangfuseContext 覆盖（merge 语义：内层补字段 + 覆盖 vertical）。
 */
function deriveDefaultVertical(scope: SessionScope): LangfuseVertical {
    switch (scope) {
        case SessionScope.CASE: return 'case-main'
        case SessionScope.ASSISTANT: return 'legal-assistant'
        case SessionScope.DOCUMENT: return 'document'
        case SessionScope.CONTRACT: return 'contract'
        default: return 'case-main'
    }
}

// -----------------------------------------------------------------------
// 工具函数
// -----------------------------------------------------------------------

/**
 * 把 scope 映射到积分计费 itemKey。
 * 与各业务 agent 保持一致（accountByScope + nodeName 兜底）。
 */
function toPointItemKey(scope: SessionScope, nodeName: string): string {
    const mapping: Record<string, string> = {
        [SessionScope.CASE]: 'case_analysis_token',
        [SessionScope.ASSISTANT]: 'assistant_token',
        [SessionScope.DOCUMENT]: 'document_token',
        [SessionScope.CONTRACT]: 'contract_token',
    }
    return mapping[scope] ?? `${nodeName}_token`
}

/**
 * 按 name 去重工具列表（后者胜出），避免 LangChain AgentNode
 * 检测到"同名不同实例"而抛错。
 */
function mergeToolsByName(tools: StructuredToolInterface[]): StructuredToolInterface[] {
    const byName = new Map<string, StructuredToolInterface>()
    for (const t of tools) {
        byName.set(t.name, t)
    }
    return Array.from(byName.values())
}

// -----------------------------------------------------------------------
// 主流程
// -----------------------------------------------------------------------

/**
 * 执行 DomainAgent 主流程（createAgent 路径）。
 * stateGraph 路径由 defineDomainAgent 直接调用 def.runStateGraph。
 */
export async function runDomainAgent(
    def: DomainAgentDefinition,
    ctx: AgentRunnerContext,
): Promise<ReadableStream> {
    return withLangfuseContext(
        {
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            threadId: ctx.sessionId,
            userId: ctx.userId,
            caseId: ctx.caseId ?? undefined,
            vertical: deriveDefaultVertical(def.scope),
        },
        () => runDomainAgentInner(def, ctx),
    )
}

async function runDomainAgentInner(
    def: DomainAgentDefinition,
    ctx: AgentRunnerContext,
): Promise<ReadableStream> {
    // 1. 解析节点名称（支持动态函数形式）
    const resolvedNodeName = typeof def.nodeName === 'function' ? def.nodeName(ctx) : def.nodeName

    // 2. 加载节点配置（内存缓存）
    const nodeConfig = await getNodeConfigCached(resolvedNodeName)
    if (!nodeConfig) {
        throw new Error(`节点 "${resolvedNodeName}" 未找到，请检查节点名称或在管理后台创建该节点`)
    }

    // 3. 获取可用 API Key
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`节点 "${resolvedNodeName}" 没有可用的 API 密钥，请在管理后台配置`)
    }

    // 4. 创建 chatModel
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking: resolveThinkingFromNodeConfig(nodeConfig, ctx.thinking),
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 4. 渲染 system prompt：仅 roleAndFlow 段；4 段案件上下文交给 caseContextSyncMiddleware
    //    注入 HumanMessage（业务私有中间件由 vertical 通过 customMiddlewares 挂载）
    //    构造方式与 assistantAgent 同款：buildSystemPromptForAgent 在 caseId=null 时退化为
    //    "仅 roleAndFlow + 按 SDK 分流（Anthropic 1h cache_control / 其他 plain text）"
    const systemPromptText = renderSystemPrompt(nodeConfig, {
        caseId: ctx.caseId ?? undefined,
    })
    const { systemMessage: systemPrompt, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: null,
            agentName: resolvedNodeName,
            userQuery: '',
            roleAndFlowTemplate: systemPromptText,
        },
    )

    // 5. 解析上下文窗口参数
    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    // 6. 基础设施：checkpointer + store
    const [checkpointer, store] = await Promise.all([
        getCheckpointer(),
        getStore(),
    ])

    // 7. skills 中间件（按节点动态加载，null = 节点无关联 skill）
    const skillsMw = await buildSkillsMiddlewareForNode(nodeConfig.id)

    // 8. 组装中间件栈
    const itemKey = toPointItemKey(def.scope, resolvedNodeName)

    const middlewareItems = [
        {
            middleware: createMessageIntegrityMiddleware(),
            priority: MIDDLEWARE_PRIORITY.MESSAGE_INTEGRITY,
            name: MIDDLEWARE_NAMES.MESSAGE_INTEGRITY,
        },
        {
            middleware: createScopeGuardMiddleware(),
            priority: MIDDLEWARE_PRIORITY.SCOPE_GUARD,
            name: MIDDLEWARE_NAMES.SCOPE_GUARD,
        },
        // toolCallLimit 返回数组，展开后各自独立排列
        ...createToolCallLimitMiddlewares().map((mw, i) => ({
            middleware: mw,
            priority: MIDDLEWARE_PRIORITY.TOOL_CALL_LIMIT + i,
            name: `${MIDDLEWARE_NAMES.TOOL_CALL_LIMIT}_${i}`,
        })),
        {
            middleware: pointConsumptionMiddleware(ctx.userId, itemKey, ctx.sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        {
            middleware: summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt: systemPromptPlainText,
                maxOutputTokens,
            }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        {
            middleware: createAuditMiddleware(),
            priority: MIDDLEWARE_PRIORITY.AUDIT,
            name: MIDDLEWARE_NAMES.AUDIT,
        },
    ]

    // skills 中间件自动挂载（仅节点关联了 skill 时）
    if (skillsMw) {
        middlewareItems.push({
            middleware: skillsMw,
            priority: MIDDLEWARE_PRIORITY.SKILLS_DISCOVERY,
            name: MIDDLEWARE_NAMES.SKILLS_DISCOVERY,
        })
    }

    // 业务私有中间件
    if (def.customMiddlewares) {
        const custom = await def.customMiddlewares(ctx)
        middlewareItems.push(...custom)
    }

    const middleware = buildMiddlewareStack(middlewareItems)

    // 9. 组装工具列表
    const toolContext: ToolContext = {
        userId: ctx.userId,
        caseId: ctx.caseId ?? undefined,
        sessionId: ctx.sessionId,
        runId: ctx.runId,
    }

    const nodeTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    const customTools = def.customTools ? await def.customTools(ctx) : []

    // 4 个 skill 工具仅当节点关联了 skill 时自动跟随
    const skillTools: StructuredToolInterface[] = skillsMw
        ? [
            createReadSkillFileTool(toolContext),
            createWriteSkillFileTool(toolContext),
            createRunSkillScriptTool(toolContext),
            createRunSkillCommandTool(toolContext),
        ]
        : []

    const allTools = mergeToolsByName([...nodeTools, ...customTools, ...skillTools])

    logger.info('[defineDomainAgent] 创建 agent', {
        scope: def.scope,
        nodeName: resolvedNodeName,
        model: nodeConfig.modelName,
        nodeToolsCount: nodeTools.length,
        customToolsCount: customTools.length,
        skillToolsCount: skillTools.length,
        hasSkillsMw: !!skillsMw,
    })

    // 10. 创建 agent
    const agent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools: allTools,
        middleware,
    })

    // 11. 构造输入（resume 使用 Command，首次使用 HumanMessage）
    const input = ctx.command
        ? new Command({ resume: ctx.command })
        : { messages: ctx.message ? [new HumanMessage(ctx.message)] : [] }

    // 12. 执行前钩子
    await def.hooks?.beforeRun?.(ctx)

    // 13. 流式执行，返回 ReadableStream
    // Langfuse 4 件套（callbacks/runName/tags/metadata.langfuseUserId/SessionId）
    // 由 buildLangfuseTopLevelConfig 从 ALS 上下文（外层 withLangfuseContext 已包）注入
    const stream = await agent.stream(
        input as any,
        {
            configurable: {
                thread_id: ctx.sessionId,
            },
            streamMode: ['values', 'messages', 'updates'] as const,
            subgraphs: true,
            encoding: 'text/event-stream',
            recursionLimit: 1000,
            signal: ctx.signal,
            ...buildLangfuseTopLevelConfig(),
        },
    )

    // 14. 包装 afterRun（流关闭后调用）
    if (def.hooks?.afterRun) {
        return wrapStreamWithAfterRun(stream, ctx, def.hooks.afterRun)
    }

    return stream
}

/**
 * 包装 ReadableStream，在流关闭/取消时调用 afterRun 钩子。
 * 不修改流内容，仅拦截 close/cancel 事件。
 */
function wrapStreamWithAfterRun(
    source: ReadableStream,
    ctx: AgentRunnerContext,
    afterRun: (ctx: AgentRunnerContext, success: boolean) => Promise<void>,
): ReadableStream {
    let success = true
    let reader: ReadableStreamDefaultReader | null = null

    return new ReadableStream({
        async start(controller) {
            reader = source.getReader()
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    controller.enqueue(value)
                }
                controller.close()
            } catch (err) {
                success = false
                controller.error(err)
            } finally {
                reader.releaseLock()
                reader = null
                afterRun(ctx, success).catch(e => {
                    logger.error('[defineDomainAgent] afterRun 钩子执行失败', e)
                })
            }
        },
        cancel() {
            success = false
            // source 已被 start() 内的 reader 锁住，直接 source.cancel() 会抛
            // "Invalid state: ReadableStream is locked"。改走 reader.cancel()，
            // 它会同时释放锁 + 取消上游。
            // reader 可能已 null（start 正常完成），fallback 到 source.cancel?()。
            const cancelPromise = reader
                ? reader.cancel().catch(() => { /* 忽略 cancel 后续清理错误 */ })
                : Promise.resolve(source.cancel?.())
            cancelPromise.catch(() => { /* 忽略 source 端的 cancel 异常 */ })

            afterRun(ctx, false).catch(e => {
                logger.error('[defineDomainAgent] afterRun 钩子执行失败（cancel）', e)
            })
        },
    })
}

/**
 * 执行 DomainAgent 主流程（stateGraph 路径）。
 *
 * 与 createAgent 路径不同：不组装中间件栈、不创建 LangChain agent、
 * 不强制走 agent.stream。业务 vertical 的 runStateGraph 自行决定流程，
 * 平台仅承接通用职责：
 *   1. 节点配置加载（缓存）
 *   2. 注入类型化 customEvent emitter（绑定 runId/sessionId）
 *   3. 错误兜底（业务 throw → 平台 publish status_change failed → 返回失败 stream）
 *   4. afterRun 钩子（无论 success/failure 都触发）
 *
 * 适用场景：流程固定型业务（合同审查、案件初分），不适合 createAgent 工具循环。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-4-contract-platform.md Task 4
 */
export async function runStateGraphAgent(
    def: DomainAgentDefinition,
    ctx: AgentRunnerContext,
): Promise<ReadableStream> {
    if (!def.runStateGraph) {
        throw new Error(
            `[runStateGraphAgent] vertical "${def.scope}" 的 agentType=stateGraph 但未提供 runStateGraph 函数`,
        )
    }

    return withLangfuseContext(
        {
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            threadId: ctx.sessionId,
            userId: ctx.userId,
            caseId: ctx.caseId ?? undefined,
            vertical: deriveDefaultVertical(def.scope),
        },
        () => runStateGraphAgentInner(def, ctx),
    )
}

async function runStateGraphAgentInner(
    def: DomainAgentDefinition,
    ctx: AgentRunnerContext,
): Promise<ReadableStream> {
    // 1. 解析节点名称（支持动态函数形式）
    const resolvedNodeName = typeof def.nodeName === 'function' ? def.nodeName(ctx) : def.nodeName

    // 2. 加载节点配置（内存缓存）
    const nodeConfig = await getNodeConfigCached(resolvedNodeName)
    if (!nodeConfig) {
        throw new Error(
            `节点 "${resolvedNodeName}" 未找到（vertical=${def.scope}），请检查节点名称或在管理后台创建该节点`,
        )
    }

    // 3. 注入类型化 customEvent emitter
    const emitCustomEvent = createCustomEventEmitter({
        runId: ctx.runId,
        sessionId: ctx.sessionId,
    })

    // 4. 构造增强版 ctx
    const enhancedCtx: StateGraphAgentContext = {
        ...ctx,
        nodeConfig,
        emitCustomEvent,
    }

    // 5. beforeRun 钩子
    await def.hooks?.beforeRun?.(enhancedCtx)

    // 6. 执行业务 stateGraph，错误兜底
    //    注意：status_change=failed 事件由上层 agentWorker.executeRun 的 catch 通过
    //    publishStatusChange 统一发出（见 server/services/agent/agentWorker.ts:341），
    //    这里只 logger.error + afterRun(false) + rethrow，避免重复发事件。
    let stream: ReadableStream
    try {
        // wrapper 函数已校验 def.runStateGraph 非空，inner 函数无法继承 narrow，加 ! 断言
        stream = await def.runStateGraph!(enhancedCtx)
    } catch (err) {
        logger.error('[runStateGraphAgent] business throw', {
            scope: def.scope,
            nodeName: resolvedNodeName,
            runId: ctx.runId,
            sessionId: ctx.sessionId,
            error: err instanceof Error ? err.message : String(err),
        })
        await def.hooks?.afterRun?.(enhancedCtx, false)
        throw err
    }

    // 7. afterRun 钩子（流关闭/取消时触发）
    if (def.hooks?.afterRun) {
        return wrapStreamWithAfterRun(stream, enhancedCtx, def.hooks.afterRun)
    }

    return stream
}

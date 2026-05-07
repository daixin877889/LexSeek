/**
 * 子代理工具工厂
 *
 * 从 NodeConfig 列表生成子代理工具数组
 * 每个工具内部创建独立的 createAgent 子代理，通过流式执行返回结果
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { HumanMessage } from '@langchain/core/messages'
import { createAgent, summarizationMiddleware } from 'langchain'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { resolveThinkingFromNodeConfig } from '~~/server/services/node/node.service'
import { getToolInstancesService } from '~~/server/services/agent-platform/tools'
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
    userInjectionMiddleware,
} from '~~/server/services/agent-platform/middleware'
import { safetyTrimMiddleware } from '~~/server/services/agent-platform/middleware/safetyTrim.middleware'
import { analysisResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/analysisResultPersistence.middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
import { getCheckpointer, getStore } from '~~/server/services/agent-platform/checkpointer'
import { renderSystemPrompt } from '~~/server/services/workflow/utils/promptRenderer'
import { resolveContextWindow } from '~~/server/services/agent-platform/context/messageCompressor'
import { buildSystemPromptForAgent } from '~~/server/services/agent-platform/context/moduleContextBuilder'
import type { NodeConfig } from '~~/server/services/node/node.service'
import { buildSubAgentCallbacks } from './buildSubAgentCallbacks'
import { publishSubAgentStatus } from './publishSubAgentStatus'
import { buildLangfuseTopLevelConfig, withLangfuseContext } from '~~/server/lib/langfuse'

// 4 个 skill 工具：仅当节点关联了 skill（buildSkillsMiddlewareForNode 非 null）时跟随注入
import { createTool as createReadSkillFileTool } from '~~/server/services/agent-platform/tools/readSkillFile.tool'
import { createTool as createWriteSkillFileTool } from '~~/server/services/agent-platform/tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '~~/server/services/agent-platform/tools/runSkillScript.tool'
import { createTool as createRunSkillCommandTool } from '~~/server/services/agent-platform/tools/runSkillCommand.tool'

/** 子代理工具上下文 */
export interface SubAgentToolContext {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
    /** 主 Agent run id（agentRuns.id），供 callbacks 转发事件到同一 SSE 流 */
    runId: string
}

/**
 * 工具名合法化
 *
 * 将非字母数字下划线字符替换为 `_`，确保工具名称符合 LangChain 要求
 *
 * @param name 原始名称
 * @returns 合法的工具名称
 */
export function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * 从 NodeConfig 列表生成子代理工具数组
 *
 * 每个子代理工具是一个 async generator tool，内部：
 * - 从 NodeConfig 创建 model
 * - 加载工具
 * - 创建子代理（createAgent）
 * - 挂载 pointConsumptionMiddleware
 * - 流式执行，yield 每个事件
 * - try/catch 错误降级，返回错误字符串而非抛异常
 * - 跳过无可用 API Key 的节点
 *
 * @param nodeConfigs 节点配置列表
 * @param context 子代理工具上下文
 * @returns 子代理工具数组
 */
export async function createSubAgentTools(
    nodeConfigs: NodeConfig[],
    context: SubAgentToolContext,
): Promise<StructuredToolInterface[]> {
    if (nodeConfigs.length === 0) {
        return []
    }

    const tools: StructuredToolInterface[] = []

    for (const config of nodeConfigs) {
        // 查找可用的 API Key（status === 1）
        const activeApiKey = config.modelApiKeys.find(k => k.status === 1)
        if (!activeApiKey) {
            logger.warn(`子代理 ${config.name} 没有可用的 API 密钥，已跳过`)
            continue
        }

        const safeName = sanitizeName(config.name)
        const toolName = `ask_${safeName}_expert`
        const description = config.title || config.description || config.name
        // 子代理 agentName 用 NodeConfig.name（如 evidence_expert / risk_expert），
        // 与持久化中间件 / buildContextSegments 排除自身模块的 NOT 过滤保持一致
        const agentName = config.name

        // 渲染 NodeConfig 系统提示词模板（仅替换变量；五段式拼装由 buildContextSegments 负责）
        const roleAndFlowTemplate = renderSystemPrompt(config, { caseId: context.caseId })

        const subAgentTool = tool(
            async (input: { question: string }, cfg): Promise<string> => {
                // 从 ToolRunnableConfig.toolCall.id 拿主 Agent 那次 ask_*_expert tool_call 的 id
                const parentToolCallId = (cfg as any)?.toolCall?.id ?? ''
                const mainRunId = context.runId
                const nodeConfig = config   // 外层闭包的 NodeConfig（forEach 迭代变量）

                // subThreadId 提前声明，catch 分支发 failed 事件时也需要。
                // 加 parentToolCallId 后缀让每次主流 LLM 调用都得到独立 thread —— 旧版用
                // `${sessionId}_sub_${safeName}` 固定命名导致同 expert 多次调用复用同一
                // checkpoint，第二次 invoke 把 systemMessage append 到累积 messages 末尾
                // → Anthropic 报错 "System messages are only permitted as the first passed message"。
                const subThreadId = `${context.sessionId}_sub_${safeName}_${parentToolCallId}`

                return withLangfuseContext(
                    {
                        // 显式带 ctx 字段（context 已有，不依赖外层 ALS 兜底；cron / 单测等
                        // 没经过 runtime 的调用栈也能保证 trace 顶层 userId/sessionId 完整）
                        userId: context.userId,
                        sessionId: context.sessionId,
                        threadId: subThreadId,
                        caseId: context.caseId,
                        runId: context.runId,
                        vertical: 'sub-agent',
                    },
                    () => runSubAgentInner(),
                )

                async function runSubAgentInner(): Promise<string> {
                try {
                    // 创建模型实例
                    const model = createChatModel({
                        sdkType: config.modelSdkType,
                        modelName: config.modelName,
                        // 外层 forEach 已校验 activeApiKey 非空（continue 跳过），嵌套 inner 函数 TS narrow 失效，加 ! 断言
                        apiKey: activeApiKey!.apiKey,
                        baseUrl: config.modelProviderBaseUrl,
                        temperature: 0.7,
                        streaming: true,
                        // 子代理无 ctx.thinking（前端开关），按节点配置默认决议；
                        // 不继承父 Agent 的 ctx.thinking，保持决议源清晰
                        thinking: resolveThinkingFromNodeConfig(config, undefined),
                        maxTokens: config.modelMaxOutputTokens,
                    })

                    // 防回归：早期此处漏挂导致小索 ask_*_expert 子代理没有 skill，与 runAnalysisSubAgent 路径不一致
                    // 同时与下面的 getCheckpointer/getStore 合并 Promise.all（互不依赖，省 1 RTT）
                    const [skillsMw, checkpointer, store] = await Promise.all([
                        buildSkillsMiddlewareForNode(config.id),
                        getCheckpointer(),
                        getStore(),
                    ])

                    const toolContext = {
                        userId: context.userId,
                        caseId: context.caseId,
                        sessionId: context.sessionId,
                        runId: context.runId,
                    }
                    const nodeTools = config.tools.length > 0
                        ? getToolInstancesService(config.tools, toolContext)
                        : []

                    const skillTools: StructuredToolInterface[] = skillsMw
                        ? [
                            createReadSkillFileTool(toolContext),
                            createWriteSkillFileTool(toolContext),
                            createRunSkillScriptTool(toolContext),
                            createRunSkillCommandTool(toolContext),
                        ]
                        : []

                    // name 去重避免 LangChain AgentNode 检测到「同名不同实例」抛错（同名时后者 skill 工具胜出，与 runtime.ts mergeToolsByName 一致）
                    const subToolsByName = new Map<string, StructuredToolInterface>()
                    for (const t of [...nodeTools, ...skillTools]) subToolsByName.set(t.name, t)
                    const subTools = Array.from(subToolsByName.values())

                    logger.info('[subAgentTool] 创建子代理', {
                        agentName,
                        nodeId: config.id,
                        nodeToolsCount: nodeTools.length,
                        skillToolsCount: skillTools.length,
                        hasSkillsMw: !!skillsMw,
                    })

                    // 构建 5 段式上下文（与主 agent 同套 helper，保证 cache_control 行为一致）
                    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
                        config.modelSdkType,
                        {
                            caseId: context.caseId,
                            agentName,
                            userQuery: input.question,
                            roleAndFlowTemplate,
                        },
                    )

                    // 仅放 HumanMessage；SystemMessage 通过 createAgent.systemPrompt 参数传入。
                    // 历史教训：把 SystemMessage 塞 messages 数组在 anthropic SDK 路径下会触发
                    // "System messages are only permitted as the first passed message" 报错——
                    // anthropic API 的 messages 数组不接受 system role，必须走顶层 system 参数。
                    // LangChain createAgent v1.x 的 normalizeSystemPrompt 已支持 SystemMessage
                    // 实例（含 content blocks + cache_control），由它内部正确放到 LLM 调用的 system 参数。
                    const initialMessages = [new HumanMessage(input.question)]

                    // 上下文压缩参数（与主 agent 同规格）
                    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
                        config.modelContextWindow,
                        config.modelMaxOutputTokens,
                    )

                    // 创建子代理：systemPrompt 走 createAgent 参数（不塞 messages 数组）
                    const agent = createAgent({
                        model,
                        systemPrompt: systemMessage,
                        tools: subTools,
                        checkpointer,
                        store,
                        middleware: [
                            // 消息完整性兜底必须最先：子 agent 独立 thread 同样会遗留 orphan tool_use
                            createMessageIntegrityMiddleware(),
                            createScopeGuardMiddleware(),
                            pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId),
                            summarizationMiddleware({
                                model,
                                trigger: [{ tokens: triggerTokens }],
                            }),
                            // 与主 agent 一致：用完整 5 段拼接的纯文本估算 token，避免低估
                            safetyTrimMiddleware({ model, maxTokens, systemPrompt: systemPromptPlainText, maxOutputTokens }),
                            ...(skillsMw ? [skillsMw] : []),
                            // 用户每轮注入（反越狱护栏 / 隐藏注入）：节点配置中 type=user_injection &&
                            // status=1 的提示词，每轮 LLM 调用前作为隐藏 HumanMessage 插入到最新
                            // HumanMessage 之前；不写回 state.messages、不进 checkpoint。节点无该类
                            // 提示词时 middleware 内部 short-circuit。优先级 USER_INJECTION=70：
                            // safetyTrim/skillsDiscovery 之后、analysisResultPersistence/audit 之前
                            userInjectionMiddleware({
                                prompts: config.prompts,
                                context: { caseId: context.caseId, moduleName: agentName },
                            }),
                            analysisResultPersistenceMiddleware({
                                agentName,
                                caseId: context.caseId,
                                sessionId: context.sessionId,
                                model,
                                // 主 Agent runId：让 middleware afterAgent 完成落库后能 publish
                                // ANALYSIS_RESULT_SAVED 事件给主流，前端分析模块列表实时刷新
                                runId: mainRunId,
                            }),
                            afterAgentMemoryMiddleware({
                                caseId: context.caseId,
                                sessionId: context.sessionId,
                                userId: context.userId,
                            }),
                            createAuditMiddleware(),
                        ],
                    })

                    // 执行子代理（挂 callbacks 旁路转发事件，返回值仍走 invoke + messages 末尾 AI）
                    const result = await agent.invoke(
                        { messages: initialMessages },
                        {
                            configurable: {
                                thread_id: subThreadId,
                            },
                            recursionLimit: 1000,
                            ...buildLangfuseTopLevelConfig({
                                additionalCallbacks: buildSubAgentCallbacks({
                                    mainRunId,
                                    sessionId: context.sessionId,
                                    parentToolCallId,
                                    agentName: nodeConfig.name,
                                    subThreadId,
                                }),
                            }),
                        },
                    )

                    await publishSubAgentStatus({
                        runId: mainRunId,
                        sessionId: context.sessionId,
                        status: 'completed',
                        agentName: nodeConfig.name,
                        threadId: subThreadId,
                        parentToolCallId,
                    })

                    // 从 agent 返回的 messages 中提取最后一条 AI 回复
                    const messages = result?.messages
                    if (Array.isArray(messages) && messages.length > 0) {
                        // 从后往前找最后一条 AI 消息
                        for (let i = messages.length - 1; i >= 0; i--) {
                            const msg = messages[i] as any
                            if (!msg) continue
                            const msgType = msg._getType?.() ?? msg.type
                            if (msgType === 'ai' && msg.content) {
                                const content = typeof msg.content === 'string'
                                    ? msg.content
                                    : JSON.stringify(msg.content)
                                if (content.trim()) return content
                            }
                        }
                    }

                    return '子代理执行完成，但未生成文本回复'
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : '未知错误'
                    logger.error(`子代理 ${config.name} 执行失败`, { error: errorMessage })

                    // 前端翻 isFailed=true + 显示 failureReason；fire-and-forget，已在
                    // catch 路径里再失败也无法上报
                    void publishSubAgentStatus({
                        runId: mainRunId,
                        sessionId: context.sessionId,
                        status: 'failed',
                        error: errorMessage,
                        agentName: nodeConfig.name,
                        threadId: subThreadId,
                        parentToolCallId,
                    })

                    return `子代理 ${config.title} 执行失败: ${errorMessage}`
                }
                }
            },
            {
                name: toolName,
                description,
                schema: z.object({
                    question: z.string().describe('向该专家提出的问题'),
                }),
            },
        )

        tools.push(subAgentTool)
    }

    logger.info('子代理工具创建完成', {
        totalConfigs: nodeConfigs.length,
        createdTools: tools.length,
        toolNames: tools.map(t => t.name),
    })

    return tools
}

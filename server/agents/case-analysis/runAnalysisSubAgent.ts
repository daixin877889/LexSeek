/**
 * 案件初分分析子图 runner。
 *
 * 替换 caseAnalysisV2.workflow.ts createAnalysisNode 内步骤 5a/5b 的手写 inner ReAct，
 * 复用 agent-platform 中间件管道（含 skillsMiddleware + 4 skill 工具自动跟随）。
 *
 * 主图职责（保留在 caseAnalysisV2.workflow.ts）：
 *   - 步骤 1-3：会员 / 积分预检
 *   - 步骤 4：创建 IN_PROGRESS 记录
 *   - 步骤 5c：token 计算
 *   - 步骤 5d：持久化
 *   - 步骤 6：积分扣减
 *
 * 故意不挂的中间件（避免与主图重复）：
 *   - pointConsumption（主图步骤 6 自己扣费）
 *   - analysisResultPersistence（主图步骤 5d 自己持久化）
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-8-case-analysis-skills.md Task 1
 */

import { createAgent, summarizationMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'

import { getNodeConfigCached } from '~~/server/services/agent-platform/nodeConfig/loader'
import { renderSystemPrompt } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import { createChatModel } from '~~/server/services/agent-platform/modelFactory'
import { resolveThinkingFromNodeConfig } from '~~/server/services/node/node.service'
import { getToolInstancesService } from '~~/server/services/agent-platform/tools/index'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
import { resolveContextWindow } from '~~/server/services/agent-platform/context/messageCompressor'
import { buildSystemPromptForAgent } from '~~/server/services/agent-platform/context/moduleContextBuilder'

import {
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
    safetyTrimMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    createAuditMiddleware,
    createToolCallLimitMiddlewares,
} from '~~/server/services/agent-platform/middleware/index'

import { createTool as createReadSkillFileTool } from '~~/server/services/agent-platform/tools/readSkillFile.tool'
import { createTool as createWriteSkillFileTool } from '~~/server/services/agent-platform/tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '~~/server/services/agent-platform/tools/runSkillScript.tool'
import { createTool as createRunSkillCommandTool } from '~~/server/services/agent-platform/tools/runSkillCommand.tool'

import type { ToolContext } from '~~/server/services/agent-platform/tools/types'

export interface RunAnalysisSubAgentParams {
    /** 节点名 = analysis_type，如 'trend' */
    agentName: string
    /** 模块标题（中文），如 '判决趋势预测' */
    moduleTitle: string
    userId: number
    caseId: number
    sessionId: string
    runId: string
    thinking: boolean
    /** 主图传入的 AbortController.signal（响应取消） */
    signal?: AbortSignal
}

export interface RunAnalysisSubAgentResult {
    /** 完整响应消息列表（含中间 tool_use / tool_result）*/
    messages: any[]
    /** AI 最终回答的纯文本聚合（取 last AIMessage content） */
    resultText: string
    /** 节点 nodes.id（主图持久化时需要） */
    nodeId: number
}

export async function runAnalysisSubAgent(
    params: RunAnalysisSubAgentParams,
): Promise<RunAnalysisSubAgentResult> {
    const { agentName, moduleTitle, userId, caseId, sessionId, runId, thinking, signal } = params

    const nodeConfig = await getNodeConfigCached(agentName)
    if (!nodeConfig) {
        throw new Error(`案件初分节点 ${agentName} 未找到`)
    }

    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`案件初分节点 ${agentName} 没有可用的 API 密钥`)
    }

    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking: resolveThinkingFromNodeConfig(nodeConfig, thinking),
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 沿用现有 renderSystemPrompt（直接读 prompts.type='system' 行；
    // 阶段 8 已把 7 个分析模块的 system prompt 内容覆盖为 .deepagents/skills/<手册>/提示词.md 全文）
    const roleAndFlowTemplate = renderSystemPrompt(nodeConfig, { caseId, moduleName: agentName })

    // 5 段式 prompt 一站式构建（保留 prompt cache 命中能力，与 moduleAgent 用法一致）
    const { systemMessage, plainText: plainTextPrompt } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        { caseId, agentName, userQuery: '', roleAndFlowTemplate },
    )

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    const skillsMw = await buildSkillsMiddlewareForNode(nodeConfig.id)

    const toolContext: ToolContext = { userId, caseId, sessionId, runId }

    const nodeTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    const skillTools: StructuredToolInterface[] = skillsMw
        ? [
            createReadSkillFileTool(toolContext),
            createWriteSkillFileTool(toolContext),
            createRunSkillScriptTool(toolContext),
            createRunSkillCommandTool(toolContext),
        ]
        : []

    // 按 name 去重（节点 tools JSON 若与 skill 工具同名时业务节点 tools 胜出）
    const toolsByName = new Map<string, StructuredToolInterface>()
    for (const t of [...nodeTools, ...skillTools]) toolsByName.set(t.name, t)
    const tools = Array.from(toolsByName.values())

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
        ...createToolCallLimitMiddlewares().map((mw, i) => ({
            middleware: mw,
            priority: MIDDLEWARE_PRIORITY.TOOL_CALL_LIMIT + i,
            name: `${MIDDLEWARE_NAMES.TOOL_CALL_LIMIT}_${i}`,
        })),
        {
            middleware: summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt: plainTextPrompt,
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
    if (skillsMw) {
        middlewareItems.push({
            middleware: skillsMw,
            priority: MIDDLEWARE_PRIORITY.SKILLS_DISCOVERY,
            name: MIDDLEWARE_NAMES.SKILLS_DISCOVERY,
        })
    }
    const middleware = buildMiddlewareStack(middlewareItems)

    // 子图每次主图节点调用一次性 invoke，不需要 checkpointer / store
    const agent = createAgent({ model, systemPrompt: systemMessage, tools, middleware })

    logger.info('[runAnalysisSubAgent] 启动', {
        agentName,
        nodeId: nodeConfig.id,
        hasSkillsMw: !!skillsMw,
        nodeToolsCount: nodeTools.length,
        skillToolsCount: skillTools.length,
    })

    const response = await agent.invoke(
        { messages: [new HumanMessage(`现在请开始"${moduleTitle}"分析。`)] },
        { recursionLimit: 1000, signal },
    )

    const responseMessages = response.messages ?? []
    const lastMsg = responseMessages[responseMessages.length - 1]
    let resultText = ''
    if (lastMsg && typeof lastMsg.content === 'string') {
        resultText = lastMsg.content
    } else if (lastMsg && Array.isArray(lastMsg.content)) {
        resultText = lastMsg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n')
    }

    return { messages: responseMessages, resultText, nodeId: nodeConfig.id }
}

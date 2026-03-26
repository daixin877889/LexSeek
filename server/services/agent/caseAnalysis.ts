import { createAgent, createMiddleware, todoListMiddleware, HumanMessage, type AgentMiddleware } from "langchain";
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from '../workflow/tools'
import {
    ensureMaterialsReadyService,
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
    getSourceId,
} from '../material/materialPipeline.service'
import { getMaterialsByCaseIdService } from '../material/material.service'
import { z } from 'zod'

/** Agent 节点配置名称（必须在后台管理中配置） */
const CASE_MAIN_NODE_NAME = 'summary'

interface MainAgentOptions {
    /** 是否启用 extended thinking（默认 true） */
    thinking?: boolean
    /** 用户 ID（工具加载需要） */
    userId?: number
    /** 案件 ID（工具加载需要） */
    caseId?: number
}

/** 材料预处理中间件 */
const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseProcessMaterialMiddleware",
        beforeAgent: {
            hook: async (_state) => {
                try {
                    const result = await ensureMaterialsReadyService(caseId, userId)
                    logger.info('材料预处理完成', {
                        caseId,
                        totalMaterials: result.totalMaterials,
                        alreadyEmbedded: result.alreadyEmbedded,
                        newlyProcessed: result.newlyProcessed,
                        failedCount: result.failed.length,
                    })
                    if (result.failed.length > 0) {
                        logger.warn('部分材料处理失败', { failed: result.failed })
                    }
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}

/** 材料上下文注入中间件（支持首次全量/增量注入） */
const caseMaterialContextMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseMaterialContextMiddleware",
        stateSchema: z.object({
            _injectedSourceIds: z.array(z.number()).default([]),
        }),
        beforeAgent: {
            hook: async (state) => {
                try {
                    // 1. 获取当前材料
                    const materials = await getMaterialsByCaseIdService(caseId)
                    if (materials.length === 0) return

                    // 2. 从 state 读取已注入的 sourceId 列表（自动从 checkpoint 恢复）
                    const prevSourceIds: number[] = state._injectedSourceIds ?? []
                    const currentSourceIds = materials.map(m => getSourceId(m))

                    // 3. 判断是首次注入还是增量
                    const isFirstInjection = prevSourceIds.length === 0
                    const newSourceIds = currentSourceIds.filter(id => !prevSourceIds.includes(id))

                    // 无变化则跳过
                    if (!isFirstInjection && newSourceIds.length === 0) return

                    // 4. 获取材料上下文
                    if (isFirstInjection) {
                        // 首次：按 token 阈值判断 full/summary
                        const context = await getMaterialContextService(materials)
                        if (context.mode === 'empty') return

                        const messageText = buildMaterialContextMessage(context)

                        // 在 SystemMessage 之后插入
                        const systemIdx = state.messages.findIndex(
                            (m: any) => m._getType() === 'system'
                        )
                        const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))

                        logger.info('材料上下文已注入（首次）', {
                            caseId,
                            mode: context.mode,
                            materialCount: currentSourceIds.length,
                            totalTokens: context.totalTokens,
                        })
                    } else {
                        // 增量：固定 summary 模式
                        const newSourceIdSet = new Set(newSourceIds)
                        const newMaterials = materials.filter(m => newSourceIdSet.has(getSourceId(m)))
                        const context = await getMaterialContextService(newMaterials)
                        if (context.mode === 'empty') return

                        const messageText = buildIncrementalMaterialMessage(context)

                        // 在用户最新消息前插入（倒数第二位）
                        const insertIdx = Math.max(0, state.messages.length - 1)
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))

                        logger.info('材料上下文已注入（增量）', {
                            caseId,
                            newMaterialCount: newSourceIds.length,
                        })
                    }

                    // 5. 返回更新后的 state（自动持久化到 checkpoint）
                    return { _injectedSourceIds: currentSourceIds }
                } catch (error) {
                    logger.error('材料上下文注入异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}

export const caseAnalysisAgent = async (sessionId: string, prompt: string, options: MainAgentOptions = {}) => {
    const { thinking = true, userId, caseId } = options
    const [checkpointer, store] = await Promise.all([getCheckpointer(), getStore()])

    // 从数据库获取节点配置
    const nodeConfig = await getValidNodeConfig(CASE_MAIN_NODE_NAME, '案件分析')

    // 获取可用的 API 密钥
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CASE_MAIN_NODE_NAME} 节点的模型提供商没有可用的 API 密钥`)
    }

    // 通过 chatModelFactory 创建模型实例
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking,
    })

    // 获取系统提示词（优先使用数据库配置，否则使用默认值）
    const systemPromptConfig = nodeConfig.prompts.find((p) => p.type === 'system' && p.status === 1)
    const systemPrompt = systemPromptConfig?.content;

    // 从节点配置动态加载工具
    const tools = nodeConfig.tools.length > 0 && userId && caseId
        ? getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId })
        : []

    logger.info('案件主Agent创建', {
        sessionId,
        model: nodeConfig.modelName,
        sdkType: nodeConfig.modelSdkType,
        provider: nodeConfig.modelProviderName,
        toolsCount: tools.length,
    })


    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = createAgent({
        model,
        systemPrompt,
        checkpointer,
        tools,
        store,
        middleware: [
            caseProcessMaterialMiddleware(userId!, caseId!),
            caseMaterialContextMiddleware(userId!, caseId!),
            todoListMiddleware() as AgentMiddleware,
        ],
    })

    return agent.stream(
        { messages: [new HumanMessage(prompt)] },
        {
            configurable: {
                thread_id: sessionId,
            },
            streamMode: ['values', 'messages'],
            encoding: 'text/event-stream',
            subgraphs: true,
            recursionLimit: 100,
        },
    )
}

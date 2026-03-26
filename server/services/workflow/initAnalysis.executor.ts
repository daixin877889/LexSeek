/**
 * 初始化分析顺序执行器
 *
 * 替代 LangGraph 工作流，直接串行执行每个模块的 Agent
 * 每个模块的 SSE 流透传到外层 ReadableStream，Worker 可直接消费
 *
 * 执行流程：
 *   module_start → Agent SSE 流（透传）→ module_complete → 下一个模块 → analysis_complete
 */

import { createAgent, type ReactAgent } from 'langchain'
import { isGraphInterrupt } from '@langchain/langgraph'
import { HumanMessage } from '@langchain/core/messages'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { pointConsumptionMiddleware } from './middleware/pointConsumption.middleware'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import {
    startAnalysisService,
    completeAnalysisService,
} from '../case/analysis.service'

export interface InitAnalysisParams {
    caseId: number
    sessionId: string
    userId: number
    selectedModules: string[]
    completedResults?: Record<string, string>
}

/**
 * 启动初始化分析
 *
 * 返回 SSE 格式的 ReadableStream，格式与 runCaseChat 一致，Worker 可直接消费
 */
export async function startInitAnalysis(params: InitAnalysisParams): Promise<ReadableStream> {
    const { caseId, sessionId, userId, selectedModules } = params
    const completedResults: Record<string, string> = { ...(params.completedResults ?? {}) }
    const failedModules: Record<string, string> = {}

    const encoder = new TextEncoder()

    return new ReadableStream({
        async start(controller) {
            // 辅助：发送自定义 SSE 事件（Worker 的 parseSSEEvents 可解析）
            function emitCustom(type: string, data: Record<string, unknown>) {
                const payload = JSON.stringify({ _custom: true, _type: type, ...data })
                controller.enqueue(encoder.encode(`event: custom\ndata: ${payload}\n\n`))
            }

            try {
                for (let i = 0; i < selectedModules.length; i++) {
                    const moduleName = selectedModules[i]!

                    // 跳过已完成的模块（resume 场景）
                    if (completedResults[moduleName]) {
                        continue
                    }

                    emitCustom('module_start', {
                        module: moduleName,
                        index: i,
                        total: selectedModules.length,
                    })

                    try {
                        const result = await executeModule({
                            moduleName,
                            sessionId,
                            userId,
                            caseId,
                            completedResults,
                            controller,
                            encoder,
                        })

                        completedResults[moduleName] = result

                        emitCustom('module_complete', {
                            module: moduleName,
                        })
                    } catch (error: any) {
                        if (isGraphInterrupt(error)) {
                            // 积分不足中断 —— 发送 interrupt 事件后停止执行
                            // interrupt 信息包含在 error.interrupts 中
                            const interruptValue = error.interrupts?.[0]?.value ?? {
                                type: 'insufficient_points',
                                message: '积分不足',
                            }
                            emitCustom('interrupt', {
                                module: moduleName,
                                interruptType: interruptValue.type,
                                ...interruptValue.data,
                            })
                            // 中断后不继续执行后续模块
                            return
                        }

                        // 非中断错误：记录失败，继续下一个模块
                        logger.error(`初始化分析模块 ${moduleName} 执行失败:`, error)
                        failedModules[moduleName] = error.message ?? '未知错误'

                        emitCustom('module_failed', {
                            module: moduleName,
                            error: error.message ?? '未知错误',
                        })
                    }
                }

                emitCustom('analysis_complete', {
                    completedModules: Object.keys(completedResults),
                    failedModules,
                })
            } catch (error) {
                logger.error('初始化分析执行器异常:', error)
            } finally {
                controller.close()
            }
        },
    })
}

/**
 * 执行单个分析模块
 *
 * 创建 Agent → 流式执行 → 透传 SSE 事件到外层 → 保存结果
 * 返回最终分析结果文本
 */
async function executeModule(params: {
    moduleName: string
    sessionId: string
    userId: number
    caseId: number
    completedResults: Record<string, string>
    controller: ReadableStreamDefaultController
    encoder: TextEncoder
}): Promise<string> {
    const { moduleName, sessionId, userId, caseId, completedResults, controller, encoder } = params
    const [checkpointer, store] = await Promise.all([getCheckpointer(), getStore()])

    // 1. 加载节点配置
    const nodeConfig = await getValidNodeConfig(moduleName, `分析模块: ${moduleName}`)
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`模块 ${moduleName} 无可用 API 密钥`)
    }

    // 2. 创建模型
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
    })

    // 3. 加载工具
    const tools = nodeConfig.tools?.length > 0
        ? getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId })
        : []

    // 4. 构建系统提示（注入已完成模块结果）
    const systemPromptConfig = nodeConfig.prompts?.find(
        (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content ?? ''
    const contextPrefix = Object.keys(completedResults).length > 0
        ? `以下是已完成的分析结果，请参考：\n\n${Object.entries(completedResults).map(([k, v]) => `### ${k}\n${v}`).join('\n\n')}\n\n---\n\n`
        : ''

    // 5. 标记分析开始
    const analysisRecord = await startAnalysisService({
        caseId,
        sessionId,
        nodeId: nodeConfig.id,
        analysisType: moduleName,
    })

    // 6. 创建 Agent（复用 caseAnalysis.ts 的模式）
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt: contextPrefix + systemPrompt,
        checkpointer,
        tools,
        store,
        middleware: [
            pointConsumptionMiddleware(userId, 'case_analysis_token'),
            caseMaterialContextMiddleware(userId, caseId),
        ],
    })

    logger.info(`初始化分析模块 ${moduleName} 开始执行`, {
        sessionId, caseId, userId, toolsCount: tools.length,
    })

    // 7. 执行 Agent，返回 SSE 格式 ReadableStream
    const agentStream = await agent.stream(
        { messages: [new HumanMessage('请执行分析')] },
        {
            configurable: { thread_id: `${sessionId}_${moduleName}` },
            streamMode: ['values', 'messages'],
            encoding: 'text/event-stream',
            subgraphs: true,
            recursionLimit: 100,
        },
    )

    // 8. 读取 Agent 的 SSE 流，透传到外层 ReadableStream
    //    同时在 data 中注入 _module 字段供前端区分模块
    const reader = agentStream.getReader()
    const decoder = new TextDecoder()
    let lastTextContent = ''
    let buffer = ''

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            buffer += text

            // 按完整的 SSE 事件分割（\n\n 是 SSE 事件的分隔符）
            const parts = buffer.split('\n\n')
            // 最后一个可能不完整，保留在 buffer 中
            buffer = parts.pop() ?? ''

            for (const part of parts) {
                if (!part.trim()) continue

                // 在 SSE 事件的 data 行中注入 _module 字段
                const injected = injectModuleField(part, moduleName)
                controller.enqueue(encoder.encode(injected + '\n\n'))

                // 尝试从 SSE 事件中提取最终文本内容
                lastTextContent = extractTextFromSSE(part, lastTextContent)
            }
        }

        // 处理 buffer 中可能剩余的不完整事件
        if (buffer.trim()) {
            const injected = injectModuleField(buffer, moduleName)
            controller.enqueue(encoder.encode(injected + '\n\n'))
            lastTextContent = extractTextFromSSE(buffer, lastTextContent)
        }
    } finally {
        reader.releaseLock()
    }

    // 9. 保存分析结果
    await completeAnalysisService(analysisRecord.id, lastTextContent)

    logger.info(`初始化分析模块 ${moduleName} 完成`, {
        sessionId, resultLength: lastTextContent.length,
    })

    return lastTextContent
}

/**
 * 在 SSE 事件的 data 行中注入 _module 字段
 * 输入格式: "event: xxx\ndata: {...}"
 * 输出格式: "event: xxx\ndata: {..., \"_module\": \"moduleName\"}"
 */
function injectModuleField(sseEvent: string, moduleName: string): string {
    const lines = sseEvent.split('\n')
    const result: string[] = []

    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6)
            try {
                const obj = JSON.parse(jsonStr)
                obj._module = moduleName
                result.push(`data: ${JSON.stringify(obj)}`)
            } catch {
                // JSON 解析失败则原样输出
                result.push(line)
            }
        } else {
            result.push(line)
        }
    }

    return result.join('\n')
}

/**
 * 从 SSE 事件中提取最终的 AI 文本回复
 * 解析 event: values 中 messages 数组最后一条 AIMessage 的文本内容
 */
function extractTextFromSSE(sseEvent: string, current: string): string {
    const lines = sseEvent.split('\n')
    let eventType = ''

    for (const line of lines) {
        if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ') && eventType === 'values') {
            try {
                const data = JSON.parse(line.slice(6))
                const messages = data?.messages
                if (Array.isArray(messages) && messages.length > 0) {
                    // 倒序查找最后一条 AI 消息的文本内容
                    for (let i = messages.length - 1; i >= 0; i--) {
                        const msg = messages[i]
                        if (msg?.type === 'ai' || msg?.role === 'assistant') {
                            const content = msg.content
                            if (typeof content === 'string' && content.length > 0) {
                                return content
                            }
                            // content 是数组时，拼接文本块
                            if (Array.isArray(content)) {
                                const text = content
                                    .filter((c: any) => c.type === 'text')
                                    .map((c: any) => c.text)
                                    .join('')
                                if (text.length > 0) return text
                            }
                            break
                        }
                    }
                }
            } catch {
                // 解析失败忽略
            }
        }
    }

    return current
}

/**
 * 基本信息提取节点（中断点2）
 *
 * 使用 createAgent + toolStrategy 实现：
 * 1. Agent 自主调用工具查询案件材料
 * 2. 输出结构化 JSON（ExtractedCaseInfo）
 * 3. interrupt() 暂停等待用户确认
 * 4. 确认后三层存储（DB + JSONB + PostgresStore）
 */

import { interrupt, Command } from '@langchain/langgraph'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { createAgent, toolStrategy } from 'langchain'
import { createChatModel } from '../../node/chatModelFactory'
import { getValidNodeConfig } from '../../node/node.service'
import { getToolInstancesService } from '../tools'
import { getCheckpointer } from '../checkpointer'
import { renderContent } from '../../node/prompt.service'
import { saveCaseInfoService } from '../../case/caseExtraction.service'
import type { CaseAnalysisState, CaseAnalysisStateUpdate } from '../state'
import type { ExtractedCaseInfo } from '#shared/types/case'
import { InterruptType, WorkflowPhase } from '#shared/types/case'
import { logger } from '#shared/utils/logger'

/** 基本信息提取节点名称（LangGraph 工作流中使用） */
export const EXTRACT_INFO_NODE_NAME = 'extract_info'

/** 基本信息提取节点配置名称（数据库中的节点名称） */
export const EXTRACT_INFO_NODE_CONFIG_NAME = 'extractInfo'

/**
 * 基本信息提取节点
 *
 * @param state 当前工作流状态
 * @returns 状态更新或 Command
 */
export async function extractInfoNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate | Command> {
    const { caseId, sessionId, userId, basicInfoConfirmed } = state

    logger.info('基本信息提取节点开始执行', { caseId, sessionId })

    try {
        // 已确认则跳过
        if (basicInfoConfirmed) {
            return {
                currentPhase: WorkflowPhase.MODULE_SELECT,
                messages: [new AIMessage({ content: '基本信息已确认，正在获取可用的分析模块...' })],
            }
        }

        // 1. 获取节点配置
        const nodeConfig = await getValidNodeConfig(EXTRACT_INFO_NODE_CONFIG_NAME, '基本信息提取')

        // 2. 查询 case_types 可选值
        const caseTypes = await prisma.caseTypes.findMany({
            where: { status: 1, deletedAt: null },
            select: { id: true, name: true },
            orderBy: { priority: 'asc' },
        })
        const caseTypeOptions = caseTypes.map(t => t.name).join('、')

        // 3. 加载工具（从节点配置动态读取）
        const tools = getToolInstancesService(nodeConfig.tools, {
            userId,
            caseId,
            sessionId,
        })

        // 4. 创建模型
        const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
        if (!activeApiKey) {
            throw new Error(`${EXTRACT_INFO_NODE_CONFIG_NAME} 节点没有可用的 API 密钥`)
        }
        const model = createChatModel({
            sdkType: nodeConfig.modelSdkType,
            modelName: nodeConfig.modelName,
            apiKey: activeApiKey.apiKey,
            baseUrl: nodeConfig.modelProviderBaseUrl,
            temperature: 0.3,
            streaming: false,
        })

        // 5. 渲染 system prompt（注入 caseTypeOptions）
        const systemPromptConfig = nodeConfig.prompts.find(p => p.type === 'system' && p.status === 1)
        if (!systemPromptConfig) {
            throw new Error(`${EXTRACT_INFO_NODE_CONFIG_NAME} 节点缺少生效的系统提示词`)
        }
        const systemPrompt = renderContent(systemPromptConfig.content, { caseTypeOptions })

        // 6. 获取 outputSchema
        const { outputSchema } = nodeConfig
        if (!outputSchema) {
            throw new Error(`${EXTRACT_INFO_NODE_CONFIG_NAME} 节点未配置 outputSchema`)
        }

        // 7. 创建 Agent（工具 + 结构化输出）
        const checkpointer = await getCheckpointer()
        const agent = createAgent({
            model,
            systemPrompt,
            tools,
            checkpointer,
            responseFormat: toolStrategy(outputSchema as any) as any,
        })

        // 8. Agent 自主执行
        const result = await agent.invoke(
            { messages: state.messages },
            {
                configurable: { thread_id: `${sessionId}-extract-${Date.now()}` },
            },
        )
        const extracted = result.structuredResponse as unknown as ExtractedCaseInfo

        logger.info('结构化提取完成', {
            caseId,
            title: extracted.title,
            caseType: extracted.caseType,
            extraFieldsCount: extracted.extraFields.length,
        })

        // 9. interrupt 暂停等待用户确认
        const userInput = interrupt({
            type: InterruptType.BASIC_INFO_CONFIRM,
            message: '已从案件材料中提取以下信息，请确认或修改',
            extractedInfo: extracted,
        })

        // 10. 解析用户确认
        const confirmedData = parseUserConfirmation(userInput, extracted)

        // 11. 三层存储
        await saveCaseInfoService(caseId, confirmedData, caseTypes)

        logger.info('案件信息已保存', { caseId, title: confirmedData.title })

        // 12. 继续执行模块选择
        return new Command({
            update: {
                title: confirmedData.title,
                plaintiff: confirmedData.plaintiff,
                defendant: confirmedData.defendant,
                summary: confirmedData.summary,
                caseTypeName: confirmedData.caseType,
                extractedInfo: confirmedData,
                basicInfoConfirmed: true,
                currentPhase: WorkflowPhase.MODULE_SELECT,
                messages: [
                    new HumanMessage({
                        content: `用户确认基本信息：\n标题：${confirmedData.title}\n原告：${confirmedData.plaintiff.join('、')}\n被告：${confirmedData.defendant.join('、')}`,
                    }),
                    new AIMessage({
                        content: '基本信息已确认保存，正在获取可用的分析模块...',
                    }),
                ],
            },
            goto: 'module_select',
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('基本信息提取节点执行异常', { caseId, error: errorMessage })
        return {
            error: `基本信息提取异常: ${errorMessage}`,
            currentPhase: WorkflowPhase.EXTRACT_INFO,
            messages: [
                new AIMessage({
                    content: `基本信息提取过程中发生异常：${errorMessage}。请稍后重试。`,
                }),
            ],
        }
    }
}

/**
 * 解析用户确认的信息
 */
function parseUserConfirmation(
    userInput: unknown,
    defaultInfo: ExtractedCaseInfo,
): ExtractedCaseInfo {
    if (typeof userInput === 'object' && userInput !== null) {
        const input = userInput as Partial<ExtractedCaseInfo>
        return {
            title: input.title || defaultInfo.title,
            plaintiff: input.plaintiff || defaultInfo.plaintiff,
            defendant: input.defendant || defaultInfo.defendant,
            caseType: input.caseType || defaultInfo.caseType,
            summary: input.summary || defaultInfo.summary,
            extraFields: input.extraFields || defaultInfo.extraFields,
        }
    }

    // 字符串输入（简单确认或 JSON）
    const inputStr = String(userInput).trim()
    if (/^(确认|确定|ok|yes|是|好的|可以|没问题)$/i.test(inputStr)) {
        return defaultInfo
    }

    try {
        const parsed = JSON.parse(inputStr) as Partial<ExtractedCaseInfo>
        return {
            title: parsed.title || defaultInfo.title,
            plaintiff: parsed.plaintiff || defaultInfo.plaintiff,
            defendant: parsed.defendant || defaultInfo.defendant,
            caseType: parsed.caseType || defaultInfo.caseType,
            summary: parsed.summary || defaultInfo.summary,
            extraFields: parsed.extraFields || defaultInfo.extraFields,
        }
    } catch {
        return defaultInfo
    }
}

/**
 * 检查基本信息是否已确认
 */
export function isBasicInfoConfirmed(state: CaseAnalysisState): boolean {
    return state.basicInfoConfirmed
}

/**
 * 获取提取的基本信息
 */
export function getExtractedBasicInfo(state: CaseAnalysisState): ExtractedCaseInfo | null {
    return state.extractedInfo ?? null
}

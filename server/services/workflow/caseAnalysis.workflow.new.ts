/**
 * 案件分析工作流
 *
 * 使用 LangGraph StateGraph 组装完整的案件分析工作流
 * 包含 3 个中断点：
 * 1. 案情信息检查（循环检查-补充）
 * 2. 基本信息确认（用户确认/修改）
 * 3. 模块选择（用户选择分析模块）
 *
 * @see Requirements 1.1, 1.5, 1.6, 12.1, 12.2
 * @see design.md - LangGraph 工作流架构
 */

import { StateGraph, StateSchema, MessagesValue, ReducedValue, START, END, } from "@langchain/langgraph"
import type { GraphNode } from "@langchain/langgraph"
import { HumanMessage } from '@langchain/core/messages'
import { caseAnalysisAgent } from './agents/caseAnalysis'
import { getCheckpointer } from './checkpointer'
import { z } from "zod/v4";


/**
 * 工作流状态
 */
export const WorkflowState = new StateSchema({
    /** 会话 ID（会话 ID，用于生成线程 ID） */
    sessionId: z.string(),
    /** 用户 ID（工具加载需要） */
    userId: z.number(),
    /** 案件 ID（工具加载需要） */
    caseId: z.number(),
    /** 是否启用 extended thinking（默认 true） */
    thinking: z.boolean().default(true),
    /** 提示词 */
    prompt: z.string().optional(),
    /** 消息 */
    messages: MessagesValue,
    /** 用户选择的分析模块 */
    selectedModules: z.array(z.string()).default(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence']),
    /** LLM 调用次数 */
    llmCalls: new ReducedValue(
        z.number().default(0),
        { reducer: (x, y) => x + y }
    ),

});



/**
 * 模块执行顺序（固定顺序，不可调整）
 */
const MODULE_ORDER = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'] as const

/**
 * 获取当前节点后的下一个待执行模块
 *
 * @param current - 当前节点名称
 * @param state - 工作流状态（含 selectedModules）
 * @returns 下一个模块名称，如果后续没有选中模块则返回 END
 */
const getNextNode = (current: string, state: typeof WorkflowState.State) => {
    const idx = MODULE_ORDER.indexOf(current as typeof MODULE_ORDER[number])
    const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
    return next ?? END
}

/**
 * 创建分析节点
 *
 * @param agentName - Agent 名称
 * @param defaultPrompt - 默认提示词（当 state.messages 为空时使用）
 */
function createAnalysisNode(agentName: string, defaultPrompt: string): GraphNode<typeof WorkflowState> {
    return async (state) => {
        const node = await caseAnalysisAgent(agentName, {
            sessionId: state.sessionId,
            prompt: state.prompt ?? undefined,
            userId: state.userId,
            caseId: state.caseId,
        })

        const messages = state.messages.length > 0
            ? state.messages
            : [new HumanMessage(state.prompt ?? defaultPrompt)]

        const response = await node.invoke({ messages })

        return {
            messages: response.messages,
        }
    }
}

/**
 * 生成案件概要
 */
const summaryNode = createAnalysisNode('summary', '请开始案件分析')

/**
 * 提取案件大事记
 */
const chronicleNode = createAnalysisNode('chronicle', '请提取案件大事记')

/**
 * 预分析案件请求权
 */
const claimNode = createAnalysisNode('claim', '请预分析案件请求权')

/**
 * 判决趋势预测
 */
const trendNode = createAnalysisNode('trend', '请预测判决趋势')

/**
 * 预选案由
 */
const causeNode = createAnalysisNode('cause', '请预选案由')

/**
 * 抗辩分析及应对策略预测
 */
const defenseNode = createAnalysisNode('defense', '请分析抗辩及应对策略')

/**
 * 证据清单预梳理
 */
const evidenceNode = createAnalysisNode('evidence', '请梳理证据清单')


// 延迟初始化工作流实例（单例模式）
// 使用 any 避免复杂泛型类型不匹配，与 initAnalysis.executor.ts 保持一致
let workflowInstance: any = null

/**
 * 获取案件分析工作流实例
 *
 * 使用延迟初始化模式，确保 checkpointer 已正确配置
 */
export async function getCaseAnalysisWorkflow() {
    if (workflowInstance) return workflowInstance

    const checkpointer = await getCheckpointer()

    workflowInstance = new StateGraph(WorkflowState)
        .addNode('summary', summaryNode)
        .addNode('chronicle', chronicleNode)
        .addNode('claim', claimNode)
        .addNode('trend', trendNode)
        .addNode('cause', causeNode)
        .addNode('defense', defenseNode)
        .addNode('evidence', evidenceNode)
        // START 入口：指向第一个选中的模块（按 MODULE_ORDER 顺序）
        .addConditionalEdges(START, (state: typeof WorkflowState.State) => {
            const first = MODULE_ORDER.find(m => state.selectedModules.includes(m))
            return first ?? END
        })
        .addConditionalEdges('summary', (state) => getNextNode('summary', state))
        .addConditionalEdges('chronicle', (state) => getNextNode('chronicle', state))
        .addConditionalEdges('claim', (state) => getNextNode('claim', state))
        .addConditionalEdges('trend', (state) => getNextNode('trend', state))
        .addConditionalEdges('cause', (state) => getNextNode('cause', state))
        .addConditionalEdges('defense', (state) => getNextNode('defense', state))
        .addConditionalEdges('evidence', (state) => getNextNode('evidence', state))
        .compile({ checkpointer })

    return workflowInstance
}
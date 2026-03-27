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
import { getNodeConfigsByTypes } from '../node/node.service'


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
 * 获取案件分析工作流实例
 *
 * 每次调用都：
 * 1. 从数据库加载最新的 analysis 类型节点（status=1, deletedAt=null）
 * 2. 按 priority 升序排序构建模块顺序
 * 3. 动态编译 StateGraph
 *
 * @returns 编译后的工作流实例
 */
export async function getCaseAnalysisWorkflow() {
    const checkpointer = await getCheckpointer()

    // 1. 异步加载模块（每次都查数据库）
    const analysisModules = await getNodeConfigsByTypes(['analysis'])
    const MODULE_ORDER = analysisModules.map(m => m.name)

    // 2. 创建路由函数（闭包访问 MODULE_ORDER）
    const getNextNode = (current: string, state: typeof WorkflowState.State): string => {
        const idx = MODULE_ORDER.indexOf(current)
        if (idx === -1) return END
        const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
        return next ?? END
    }

    // 3. 动态创建节点和边
    const graph = new StateGraph(WorkflowState)

    // 注册节点
    for (const module of analysisModules) {
        graph.addNode(module.name, createAnalysisNode(module.name, module.title || module.name))
    }

    // START 入口：指向第一个选中的模块（按 MODULE_ORDER 顺序）
    graph.addConditionalEdges(START, (state) => {
        const first = MODULE_ORDER.find(m => state.selectedModules.includes(m))
        return first ?? END
    })

    // 模块间边（使用 any 类型以支持动态节点名称）
    for (const moduleName of MODULE_ORDER) {
        graph.addConditionalEdges(moduleName as any, (state) => getNextNode(moduleName, state))
    }

    return await graph.compile({ checkpointer })
}
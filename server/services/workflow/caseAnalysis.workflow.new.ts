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

import {
    StateGraph,
    StateSchema,
    MessagesValue,
    ReducedValue,
    GraphNode,
    ConditionalEdgeRouter,
    START,
    END,
} from "@langchain/langgraph";

import { z } from "zod/v4";


import {
    CaseAnalysisAnnotation,
    type CaseAnalysisState,
} from './state'
import { WorkflowPhase } from '#shared/types/case'
import { getCheckpointer } from './checkpointer'
import { logger } from '#shared/utils/logger'





// 创建工作流节点
export const createCaseAnalysisWorkflow = (sessionId: string) => {

    // 消息状态
    const MessagesState = new StateSchema({
        messages: MessagesValue,
        llmCalls: new ReducedValue(
            z.number().default(0),
            { reducer: (x, y) => x + y }
        ),
    });




    return new StateGraph(CaseAnalysisAnnotation)
}
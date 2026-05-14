/**
 * Agent 工具类型（双端共用）
 *
 * 历史位置：server/services/agent-platform/tools/types.ts
 * 迁移原因：shared/utils/tools/agentTools 需要 ToolDefinition / ToolContext / ToolModule 类型，
 * 而 shared 不可反向依赖 server。
 */
import type { z } from 'zod'

/** 调用工具时由 Agent 运行时注入的上下文 */
export interface ToolContext {
    userId: string
    caseId?: string
    sessionId?: string
    runId?: string
    draftId?: string
    reviewId?: string
}

/** 工具元数据（让 LLM 知道如何调用） */
export interface ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string
    description: string
    schema: T
}

/** 工具模块的统一形状 */
export interface ToolModule<T extends z.ZodTypeAny = z.ZodTypeAny> {
    toolDefinition: ToolDefinition<T>
    createTool: (ctx: ToolContext) => unknown  // 返回 LangChain Runnable，避免引入 langchain 依赖
}

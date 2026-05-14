/**
 * Agent 工具类型（双端共用）
 *
 * 历史位置：server/services/agent-platform/tools/types.ts
 * 迁移原因：shared/utils/tools/agentTools 需要 ToolDefinition / ToolContext / ToolModule 类型，
 * 而 shared 不可反向依赖 server。
 *
 * 注意：字段类型与项目原版本 100% 一致；@langchain/core/tools 仅以 `import type` 形式引入，
 * 不会引入 runtime 依赖，client 端不受影响。
 */
import type { ZodObject, ZodType } from 'zod'
import type { StructuredTool } from '@langchain/core/tools'

/** 工具上下文（运行时注入） */
export interface ToolContext {
    /** 用户 ID */
    userId: number
    /**
     * 案件 ID
     *
     * case 域场景必填；assistant 域（通用问答）无案件上下文时可缺省。
     * 依赖 caseId 的工具（如 save_analysis_result、process_materials）
     * 需在运行时校验 caseId 非空，否则抛错。
     */
    caseId?: number
    /** 会话 ID */
    sessionId: string
    /** 运行 ID（模块对话工具需要） */
    runId?: string
    /** 文书草稿 ID（文书生成场景） */
    draftId?: number
    /** 合同审查 ID（parseAndAskStance 工具依赖） */
    reviewId?: number
}

/** 工具定义（单一数据源） */
export interface ToolDefinition<T extends ZodObject<Record<string, ZodType>>> {
    /** 工具名称 */
    name: string
    /** 工具描述 */
    description: string
    /** 参数 schema（zod 定义，作为唯一数据源） */
    schema: T
}

/** 工具模块接口 */
export interface ToolModule {
    /** 工具定义（包含 name、description、schema） */
    toolDefinition: ToolDefinition<ZodObject<Record<string, ZodType>>>
    /** 工具工厂函数 */
    createTool: (context: ToolContext) => StructuredTool
}

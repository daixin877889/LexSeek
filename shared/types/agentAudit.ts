/**
 * Agent 工具审计相关的双端共用类型与常量。
 *
 * 放在 shared/types/ 的原因（参考 .claude/rules/types.md）：
 * - LIMITED_TOOL_NAMES 前端 Select 枚举 + 后端 toolCallLimit 配置共用，禁止前端 import ~~/server/**
 * - AgentAuditRecord 管理端 API 返回体与前端列表/详情共用
 */

/** 判决枚举（与数据库 verdict 列字符串一致） */
export enum AgentAuditVerdict {
    ALLOWED = 'allowed',
    DENIED = 'denied',
    ERROR = 'error',
}

/** 判决文本映射（前端 Badge 显示） */
export const AgentAuditVerdictText: Record<AgentAuditVerdict, string> = {
    [AgentAuditVerdict.ALLOWED]: '允许',
    [AgentAuditVerdict.DENIED]: '拒绝',
    [AgentAuditVerdict.ERROR]: '错误',
}

/**
 * 受 toolCallLimit 熔断管控的工具名白名单（snake_case，与工具注册名一致）。
 *
 * 说明：
 * - 检索类（search_case_materials / search_law）不设上限
 * - 读取类（read_skill_file）、写入/执行/上传类设上限
 * - 结果类（save_analysis_result / parse_and_ask_stance 等）不设上限
 * 详见 spec §4.3 分层表。
 */
export const LIMITED_TOOL_NAMES = [
    'read_skill_file',
    'process_materials',
    'write_skill_file',
    'run_skill_script',
    'upload_workspace_file',
] as const

export type LimitedToolName = typeof LIMITED_TOOL_NAMES[number]

/** toolCallLimit 分层配置（per-session） */
export const DEFAULT_TOOL_LIMITS: Record<LimitedToolName, number> = {
    read_skill_file: 30,
    process_materials: 5,
    write_skill_file: 20,
    run_skill_script: 10,
    upload_workspace_file: 10,
}

/** 管理端列表 / 详情返回的单条审计记录 */
export interface AgentAuditRecord {
    id: string                              // UUIDv7
    userId: number
    sessionId: string
    caseId: number | null
    runId: string | null
    toolName: string
    verdict: AgentAuditVerdict
    denyReason: string | null
    argsDigest: Record<string, unknown>     // 禁止 any
    latencyMs: number
    createdAt: string                       // ISO 8601
}

/** 统计接口返回体 */
export interface AgentAuditStatsPayload {
    today: Record<AgentAuditVerdict, number>
    last7d: Record<AgentAuditVerdict, number>
}

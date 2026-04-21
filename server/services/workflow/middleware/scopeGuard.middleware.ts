/**
 * scopeGuard 中间件
 *
 * 在 wrapToolCall 钩子中对工具调用参数做确定性 scope 校验，拒绝越权调用。
 *
 * 设计要点：
 * - 规则 map 仅针对 schema 中真实存在的字段做校验（见 spec §4.1 工具名-schema 对照）
 * - 工具名一律 snake_case，与工具注册名完全一致
 * - 所有拒绝直接返回 ToolMessage 字符串，不抛异常（Agent 收到后自然回退）
 * - 模板分隔符黑名单对所有工具生效，递归扫描 JSON string 叶子
 * - `ToolMessage` 从 @langchain/core/messages 导入（canonical source；langchain 根模块只是 re-export）
 */

import { createMiddleware } from 'langchain'
import { ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'

/**
 * 模板分隔符黑名单（spec §4.1：只拦结构化模板分隔符，不拦 system:/忽略以上 等自然语言）
 *
 * **顺序要求**：具体 token（如 `<|im_start|>`）必须排在通用前缀 `<|` **前面**，
 * 让 scanBlacklist 命中更具体的 token，这样 logger 日志与用户错误信息能精确定位攻击载荷。
 */
const BLACKLIST_PATTERNS = [
    '<|im_start|>', '<|im_end|>',       // ChatML
    '<|begin_of_text|>', '<|eot_id|>',  // Llama 3
    '<|endoftext|>',                     // GPT-2 / GPT-NeoX BOS/EOS token（spec §4.1 未列但属同族模板分隔符，保留扩充）
    '<|',                                // 通用 ChatML 前缀兜底
    '[INST]', '[/INST]',                 // Llama 2 / Mistral
    '<s>', '</s>',                       // BOS/EOS
    '### Instruction:', '### Response:', // Alpaca / Vicuna
]

/** 单会话最多记录的写入路径数（防止 write_skill_file 刷新字符串 OOM） */
const MAX_WRITTEN_PATHS_PER_SESSION = 200

/** 会话 → 已通过 write_skill_file 写入的相对路径集合（upload 强约束依赖） */
const sessionWrittenFiles = new Map<string, Set<string>>()

/** 导出给测试的重置函数（仅测试用；生产不应调用） */
export function _resetSessionWrittenFiles(): void {
    sessionWrittenFiles.clear()
}

/** 递归扫描 JSON 对象，返回命中黑名单的 token（或 null） */
function scanBlacklist(value: unknown): string | null {
    if (typeof value === 'string') {
        for (const token of BLACKLIST_PATTERNS) {
            if (value.includes(token)) return token
        }
        return null
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = scanBlacklist(item)
            if (hit) return hit
        }
        return null
    }
    if (value !== null && typeof value === 'object') {
        for (const v of Object.values(value)) {
            const hit = scanBlacklist(v)
            if (hit) return hit
        }
    }
    return null
}

/** 路径校验：拒绝绝对路径、`..` 穿越、NULL 字节 */
function isPathUnsafe(rawPath: unknown): boolean {
    if (typeof rawPath !== 'string') return true
    if (rawPath.includes('\0')) return true
    if (rawPath.startsWith('/')) return true
    if (rawPath.includes('..')) return true
    return false
}

/** 返回被拒绝的 ToolMessage */
function deny(toolCallId: string, reason: string): ToolMessage {
    return new ToolMessage({
        tool_call_id: toolCallId,
        content: `Error: ${reason}`,
        status: 'error',
    })
}

/** 工具调用上下文（从 runtime.context 中提取） */
interface ToolCallContext {
    userId: number
    caseId?: number
    draftId?: number
    sessionId: string
}

/** 工具名 → 专属规则的映射。返回 ToolMessage 表示拒绝，返回 null 表示放行 */
type ToolRule = (
    args: Record<string, unknown>,
    ctx: ToolCallContext,
    toolCallId: string,
) => ToolMessage | null

const TOOL_RULES: Record<string, ToolRule> = {
    read_skill_file: (args, _ctx, id) => {
        if (isPathUnsafe(args.path)) return deny(id, '非法路径')
        return null
    },

    write_skill_file: (args, ctx, id) => {
        if (isPathUnsafe(args.path)) return deny(id, '非法路径')
        // 记录本会话已写入的相对路径，供 upload_workspace_file 强约束使用
        const set = sessionWrittenFiles.get(ctx.sessionId) ?? new Set<string>()
        // TODO(task 6 装配): 在 agent 会话结束时清理对应 sessionId 的 Set；当前方案只做单会话上限防御
        if (set.size >= MAX_WRITTEN_PATHS_PER_SESSION) {
            return deny(id, `单会话写入路径数已达上限 ${MAX_WRITTEN_PATHS_PER_SESSION}，请减少写入`)
        }
        set.add(String(args.path))
        sessionWrittenFiles.set(ctx.sessionId, set)
        return null
    },

    upload_workspace_file: (args, ctx, id) => {
        const fp = args.filePath
        if (isPathUnsafe(fp)) return deny(id, '非法路径')
        const set = sessionWrittenFiles.get(ctx.sessionId)
        if (!set || !set.has(String(fp))) {
            return deny(id, '必须先通过 write_skill_file 写入，才能上传同一文件')
        }
        return null
    },

    search_case_materials: (args, ctx, id) => {
        // schema 只有 draftId 可被 LLM 伪造；caseId/userId 由 context 注入，不经参数
        if (args.draftId !== undefined && args.draftId !== ctx.draftId) {
            return deny(id, '参数 draftId 与当前会话 context 不一致')
        }
        return null
    },
}

export function createScopeGuardMiddleware() {
    return createMiddleware({
        name: 'ScopeGuardMiddleware',
        stateSchema: z.object({
            _scopeGuardEnabled: z.boolean().default(true),
        }),
        wrapToolCall: async (request, handler) => {
            const toolName = request.toolCall.name
            const args = (request.toolCall.args ?? {}) as Record<string, unknown>
            // runtime.context 由 LangGraph Agent 创建时注入，取失败视为非法
            const rawCtx = (request.runtime as { context?: Record<string, unknown> }).context ?? {}
            const ctx: ToolCallContext = {
                userId: Number(rawCtx.userId ?? 0),
                caseId: rawCtx.caseId as number | undefined,
                draftId: rawCtx.draftId as number | undefined,
                sessionId: String(rawCtx.sessionId ?? ''),
            }
            const toolCallId = String(request.toolCall.id ?? '')

            // 1. 黑名单扫描（对所有工具生效）
            const hit = scanBlacklist(args)
            if (hit) {
                logger.warn('scopeGuard 拦截污染标记', { tool: toolName, sessionId: ctx.sessionId, token: hit })
                return deny(toolCallId, '参数包含可疑内容')
            }

            // 2. 工具专属规则
            const rule = TOOL_RULES[toolName]
            if (rule) {
                const denied = rule(args, ctx, toolCallId)
                if (denied) {
                    logger.warn('scopeGuard 拒绝工具调用', { tool: toolName, sessionId: ctx.sessionId, reason: denied.content })
                    return denied
                }
            }

            return handler(request)
        },
    })
}

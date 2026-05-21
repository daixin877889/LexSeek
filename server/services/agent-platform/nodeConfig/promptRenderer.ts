/**
 * 系统提示词渲染器
 *
 * 提供统一的 system prompt 提取 + 模板变量渲染入口。
 * 避免各 Agent 直接拿到含 {{xxx}} 字面量的原始提示词后送入模型。
 */

import { logger } from '#shared/utils/logger'
import { renderContent } from '~~/server/services/node/prompt.service'
import { formatCurrentDate } from '~~/server/services/agent-platform/middleware/dateContext.middleware'
import type { NodeConfig } from '~~/server/services/node/node.service'

/** 渲染系统提示词时可传入的上下文变量 */
export interface PromptRenderContext {
    /** 案件 ID */
    caseId?: number
    /** 模块名称（如 case_summary、events_timeline） */
    moduleName?: string
    /** 案件类型 */
    caseType?: string
    /** 文书模板名称 */
    templateName?: string
    /** 文书模板类别 */
    templateCategory?: string
    /** 合同审查 ID（contract scope） */
    reviewId?: number
    /** 合同类型（AI 识别，可能为空） */
    contractType?: string
    /** 文书生成 fileIds（如 [1, 2, 3] 字符串形式） */
    fileIds?: string
    /** 用户补充说明文本 */
    userExtraText?: string
    /** 文书草稿 ID（documentMain 系统 prompt 注入当前 draft 状态用） */
    draftId?: number
    /** 草稿当前状态('drafting' / 'filling' / 'ready' / 'exported' / 'failed') */
    status?: string
    /**
     * 当前日期（YYYY-MM-DD，北京时区）。renderSystemPrompt 内部默认填充，
     * 业务侧无需传；调用方可显式传值用于测试锚定。
     *
     * 日级粒度选择：放进 system prompt 仍命中 prompt cache（同一天值不变），
     * 秒级时间走 dateContextMiddleware 在 user 消息侧注入。
     */
    currentDate?: string
}

/**
 * 把 PromptRenderContext 展平为 renderContent 期望的 Record<string, string>。
 *
 * 抽出来共享给 renderSystemPrompt 与 userInjectionMiddleware——避免新增字段时
 * 两边各加一份导致漂移（如 currentDate 最初就是两处独立 fallback）。
 *
 * currentDate 在调用层每次现算（dayjs 当前时间），不能 closure 捕获——
 * userInjectionMiddleware 是 createAgent 时一次性构造、agent 进程内长期复用，
 * 跨午夜运行会让"今天"卡死在启动日。
 */
export function flattenPromptContext(context: PromptRenderContext = {}): Record<string, string> {
    const variables: Record<string, string> = {}
    if (context.caseId != null) variables.caseId = String(context.caseId)
    if (context.moduleName) variables.moduleName = context.moduleName
    if (context.caseType) variables.caseType = context.caseType
    if (context.templateName) variables.templateName = context.templateName
    if (context.templateCategory) variables.templateCategory = context.templateCategory
    if (context.fileIds) variables.fileIds = context.fileIds
    if (context.userExtraText) variables.userExtraText = context.userExtraText
    if (context.draftId != null) variables.draftId = String(context.draftId)
    if (context.status) variables.status = context.status
    if (context.contractType) variables.contractType = context.contractType
    variables.currentDate = context.currentDate ?? formatCurrentDate()
    return variables
}

/**
 * 从 nodeConfig 提取生效的 system 提示词并渲染模板变量。
 *
 * - 仅取 `type === 'system' && status === 1` 的提示词
 * - 支持的变量：caseId / moduleName / caseType / templateName / templateCategory
 * - 若渲染后仍存在 `{{xxx}}` 字面量，会记录 warn 日志便于线上排查
 * - 若找不到有效的 system 提示词，返回空字符串
 *
 * @param nodeConfig 节点配置
 * @param context 渲染上下文变量
 * @returns 渲染后的 system 提示词
 */
export function renderSystemPrompt(
    nodeConfig: NodeConfig,
    context: PromptRenderContext = {},
): string {
    const systemPrompts = filterAndSortSystemPrompts(nodeConfig.prompts)
    if (systemPrompts.length === 0) {
        return ''
    }

    const variables = flattenPromptContext(context)

    const rendered = systemPrompts
        .map(p => renderContent(p.content, variables))
        .join('\n\n')

    // 检测未替换的模板变量并记录告警
    const unreplaced = rendered.match(/\{\{(\w+)\}\}/g)
    if (unreplaced) {
        logger.warn('系统提示词存在未替换的模板变量', {
            nodeId: nodeConfig.id,
            nodeName: nodeConfig.name,
            unreplacedVars: unreplaced,
        })
    }

    return rendered
}

/**
 * 取拼接后的 raw system prompt template（不做变量替换）。
 *
 * 用于"调用方需要拿到拼接的 raw template、自己再做业务变量替换"的场景。
 * 与 renderSystemPrompt 共用 displayOrder 升序拼接逻辑，确保所有路径口径一致：
 *
 *   - renderSystemPrompt(config, ctx)  → 拼接 + 通用 ctx 变量替换（适合直接送 LLM）
 *   - assembleSystemPromptTemplate(config.prompts) → 仅拼接 raw template（适合 invokeNodeJson 等
 *     需要业务侧 buildPrompt 二次渲染 {{contractType}}/{{stanceLabel}} 等专属变量的场景）
 *
 * 修复合同审查"23 条 LLM 未返回 JSON"链路：旧 .find(...) 只取第一个 system prompt，
 * 给所有节点统一挂"反越狱护栏"(displayOrder=10) 后，业务 prompt（displayOrder=100）被
 * 整段丢弃，LLM 只看到安全规则不知道要做合同审查 → 输出自然语言而非 JSON。
 */
export function assembleSystemPromptTemplate(
    prompts: NodeConfig['prompts'],
): string {
    return filterAndSortSystemPrompts(prompts)
        .map(p => p.content)
        .join('\n\n')
}

function filterAndSortSystemPrompts(
    prompts: NodeConfig['prompts'],
): NodeConfig['prompts'] {
    return prompts
        .filter(p => p.type === 'system' && p.status === 1)
        .sort((a, b) => (a.displayOrder ?? 100) - (b.displayOrder ?? 100))
}

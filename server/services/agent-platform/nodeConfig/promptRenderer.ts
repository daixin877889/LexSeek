/**
 * 系统提示词渲染器
 *
 * 提供统一的 system prompt 提取 + 模板变量渲染入口。
 * 避免各 Agent 直接拿到含 {{xxx}} 字面量的原始提示词后送入模型。
 */

import { logger } from '#shared/utils/logger'
import { renderContent } from '~~/server/services/node/prompt.service'
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
    /** 当前已填字段值的 JSON 字符串(documentMain 启动时一次性注入快照) */
    currentValuesJSON?: string
    /** 模板字段清单 + 提示语(documentMain 知道要填哪些字段) */
    placeholdersWithHints?: string
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
    const raw = nodeConfig.prompts.find(
        p => p.type === 'system' && p.status === 1,
    )?.content || ''

    if (!raw) {
        return ''
    }

    const variables: Record<string, string> = {}
    if (context.caseId != null) {
        variables.caseId = String(context.caseId)
    }
    if (context.moduleName) {
        variables.moduleName = context.moduleName
    }
    if (context.caseType) {
        variables.caseType = context.caseType
    }
    if (context.templateName) {
        variables.templateName = context.templateName
    }
    if (context.templateCategory) {
        variables.templateCategory = context.templateCategory
    }
    if (context.fileIds) {
        variables.fileIds = context.fileIds
    }
    if (context.userExtraText) {
        variables.userExtraText = context.userExtraText
    }
    if (context.draftId != null) {
        variables.draftId = String(context.draftId)
    }
    if (context.status) {
        variables.status = context.status
    }
    if (context.currentValuesJSON) {
        variables.currentValuesJSON = context.currentValuesJSON
    }
    if (context.placeholdersWithHints) {
        variables.placeholdersWithHints = context.placeholdersWithHints
    }

    const rendered = renderContent(raw, variables)

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

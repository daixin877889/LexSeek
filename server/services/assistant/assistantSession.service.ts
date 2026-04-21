/**
 * AssistantSession Service
 *
 * 薄封装层：5 个 service 函数转发到 DAO + 1 个异步标题生成函数。
 * 标题生成函数在首轮对话完成后被触发（fire-and-forget），失败吞异常
 * 不影响核心对话路径。
 *
 * 参见 spec §5.6.1-3 与 plan §1494-1578。
 */

import {
    createAssistantSessionDAO,
    getAssistantSessionDAO,
    listAssistantSessionsDAO,
    renameAssistantSessionDAO,
    softDeleteAssistantSessionDAO,
} from './assistantSession.dao'
import type {
    CreateAssistantSessionInput,
    UpdateAssistantSessionInput,
    ListAssistantSessionsInput,
} from './types'
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { renderContent } from '../node/prompt.service'
import { logContextOverflow } from '../workflow/context/contextErrorLogger'

/**
 * 标题生成节点名称。
 *
 * 独立于 assistantMain：模型、温度可在运营侧不影响主对话的前提下单独调整。
 * 若节点缺失或被禁用，runtime 回退到 assistantMain（保证向前兼容旧环境）。
 */
const TITLE_GEN_NODE_NAME = 'assistantTitleGen'
const ASSISTANT_MAIN_NODE_NAME = 'assistantMain'

/** 标题最大字符数 */
const TITLE_MAX_LENGTH = 20

/**
 * 创建 assistant 会话。
 *
 * 薄转发到 DAO。sessionId 由 DAO 生成 UUIDv4。
 */
export async function createAssistantSessionService(userId: number, title?: string) {
    const input: CreateAssistantSessionInput = title ? { userId, title } : { userId }
    return createAssistantSessionDAO(input)
}

/**
 * 按 sessionId + userId 取单个 assistant 会话。
 */
export async function getAssistantSessionService(sessionId: string, userId: number) {
    return getAssistantSessionDAO(sessionId, userId)
}

/**
 * 列表当前用户的 assistant 会话，按 updatedAt desc 分页。
 */
export async function listAssistantSessionsService(input: ListAssistantSessionsInput) {
    return listAssistantSessionsDAO(input)
}

/**
 * 重命名 assistant 会话。
 */
export async function renameAssistantSessionService(input: UpdateAssistantSessionInput) {
    return renameAssistantSessionDAO(input)
}

/**
 * 软删除 assistant 会话。
 */
export async function softDeleteAssistantSessionService(sessionId: string, userId: number) {
    return softDeleteAssistantSessionDAO(sessionId, userId)
}

/**
 * 清洗 LLM 生成的标题。
 *
 * - 去除引号（中英文）
 * - 去除换行与多余空格
 * - 去除首尾标点
 * - 截断到 TITLE_MAX_LENGTH
 */
function sanitizeTitle(raw: string): string {
    return raw
        // 去除引号
        .replace(/["'「」『』“”‘’]/g, '')
        // 换行转空格
        .replace(/[\r\n]+/g, ' ')
        // 压缩空格
        .replace(/\s+/g, ' ')
        // 去除首尾标点与空白
        .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
        .trim()
        .slice(0, TITLE_MAX_LENGTH)
}

/**
 * 异步生成会话标题（fire-and-forget）。
 *
 * 触发条件：首轮对话完成后调用。全程 try/catch 吞异常，非核心路径。
 *
 * 节点化管理（参考 spec §5.3）：
 * - 提示词 / 模型 / 温度 / maxTokens 全部由 `assistantTitleGen` 节点管理（nodes + prompts 表）
 * - 提示词支持 `{{firstUserMessage}}` / `{{firstAssistantReply}}` 变量
 * - `assistantTitleGen` 不可用时降级到 `assistantMain`，仍然从 nodes 表取模型（保证向前兼容）
 *
 * 步骤：
 * 1. 查 session：不存在 / 跨用户 / 已软删 → 跳过
 * 2. 已有 title → 跳过（不覆盖）
 * 3. 读节点配置：无 API key → 跳过
 * 4. 用 createChatModel 构造 model（streaming=false，参数来自节点）
 * 5. 渲染 system 提示词（替换首轮消息变量）并调 invoke
 * 6. 清洗 + 截断 20 字
 * 7. 调 renameAssistantSessionDAO 写回
 *
 * @param sessionId 会话 ID
 * @param userId 用户 ID
 * @param firstUserMessage 首条用户消息
 * @param firstAssistantReply 首条助手回复
 */
export async function generateSessionTitleAsync(
    sessionId: string,
    userId: number,
    firstUserMessage: string,
    firstAssistantReply: string,
): Promise<void> {
    try {
        // 1. 校验 session 存在且归属当前用户
        const session = await getAssistantSessionDAO(sessionId, userId)
        if (!session) {
            logger.warn('生成标题跳过：session 不存在或无权限', { sessionId, userId })
            return
        }

        // 2. 已有 title 不覆盖
        if (session.title && session.title.trim().length > 0) {
            return
        }

        // 3. 读取节点配置：优先 assistantTitleGen，回退 assistantMain
        let nodeConfig
        try {
            nodeConfig = await getValidNodeConfig(TITLE_GEN_NODE_NAME, '会话标题生成节点')
        } catch (titleErr) {
            logger.info('assistantTitleGen 不可用，回退到 assistantMain', {
                sessionId,
                reason: titleErr instanceof Error ? titleErr.message : String(titleErr),
            })
            try {
                nodeConfig = await getValidNodeConfig(ASSISTANT_MAIN_NODE_NAME, '通用法律助手主Agent')
            } catch (mainErr) {
                logger.warn('生成标题跳过：节点配置不可用', {
                    sessionId,
                    error: mainErr instanceof Error ? mainErr.message : String(mainErr),
                })
                return
            }
        }

        const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
        if (!activeApiKey) {
            logger.warn('生成标题跳过：无可用 API key', { sessionId })
            return
        }

        // 4. 构造模型实例（非流式；温度由节点配置决定，缺省 0.3）
        const model = createChatModel({
            sdkType: nodeConfig.modelSdkType,
            modelName: nodeConfig.modelName,
            apiKey: activeApiKey.apiKey,
            baseUrl: nodeConfig.modelProviderBaseUrl,
            temperature: 0.3,
            streaming: false,
        })

        // 5. 从 nodeConfig 取 system 提示词并渲染变量
        const systemPromptRaw = nodeConfig.prompts.find(
            p => p.type === 'system' && p.status === 1,
        )?.content ?? ''
        if (!systemPromptRaw.trim()) {
            logger.warn('生成标题跳过：节点缺少启用的 system 提示词', {
                sessionId,
                node: nodeConfig.name,
            })
            return
        }
        const prompt = renderContent(systemPromptRaw, {
            firstUserMessage,
            firstAssistantReply,
        })

        let response
        try {
            response = await model.invoke(prompt)
        } catch (err) {
            logContextOverflow(err, {
                source: 'assistantSession.generateTitle',
                modelName: nodeConfig.modelName,
                sdkType: nodeConfig.modelSdkType,
                contextWindow: nodeConfig.modelContextWindow,
                extra: {
                    sessionId,
                    userId,
                    promptLength: prompt.length,
                },
            })
            throw err
        }
        const rawText = typeof response?.content === 'string'
            ? response.content
            : Array.isArray(response?.content)
                ? response.content
                    .map((item: any) => (typeof item === 'string' ? item : item?.text ?? ''))
                    .join('')
                : ''

        const title = sanitizeTitle(rawText)
        if (!title) {
            logger.warn('生成标题跳过：清洗后为空', { sessionId, rawText })
            return
        }

        // 6. 写回
        const result = await renameAssistantSessionDAO({
            sessionId,
            userId,
            title,
        })
        if (!result.success) {
            logger.warn('生成标题写回失败', { sessionId, userId, error: result.error })
            return
        }

        logger.info('生成会话标题成功', { sessionId, userId, title })
    } catch (err) {
        // 非核心路径：全程吞异常
        logger.warn('生成会话标题异常（已吞）', {
            sessionId,
            userId,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

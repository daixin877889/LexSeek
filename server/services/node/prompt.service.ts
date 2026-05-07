/**
 * 提示词服务层
 *
 * 提供提示词的业务逻辑封装，包括 CRUD、版本管理、激活/停用、变量渲染
 * Requirements: 14.9, 14.10, 14.11, 14.12, 14.13, 14.14
 */

import type {
    CreatePromptInput,
    UpdatePromptInput,
    PromptListParams,
    PromptType,
    RenderPromptInput,
    PreviewPromptInput,
} from '#shared/types/node'
import {
    createPromptDao,
    findPromptByIdDao,
    findManyPromptsDao,
    findPromptsByNodeIdDao,
    findActivePromptDao,
    findPromptVersionsDao,
    getLatestVersionDao,
    updatePromptDao,
    updatePromptStatusDao,
    deactivatePromptsByTypeDao,
    softDeletePromptDao,
} from './prompt.dao'
import { findNodeByIdDao } from './node.dao'

// ==================== 版本号生成工具 ====================

/**
 * 生成下一个版本号
 * 版本号格式：v1, v2, v3...
 * @param currentVersion 当前版本号
 * @returns 下一个版本号
 */
export const generateNextVersion = (currentVersion: string | null): string => {
    if (!currentVersion) {
        return 'v1'
    }

    // 解析版本号
    const match = currentVersion.match(/^v(\d+)$/)
    if (!match) {
        return 'v1'
    }

    const versionNum = parseInt(match[1]!, 10)
    return `v${versionNum + 1}`
}

// ==================== 变量渲染工具 ====================

/**
 * 从提示词内容中提取变量名
 * 变量格式：{{variableName}}
 * @param content 提示词内容
 * @returns 变量名列表
 */
export const extractVariables = (content: string): string[] => {
    const regex = /\{\{(\w+)\}\}/g
    const variables: string[] = []
    let match

    while ((match = regex.exec(content)) !== null) {
        if (!variables.includes(match[1]!)) {
            variables.push(match[1]!)
        }
    }

    return variables
}

/**
 * 渲染提示词内容（替换变量）
 * @param content 提示词内容
 * @param variables 变量值映射
 * @returns 渲染后的内容
 */
export const renderContent = (
    content: string,
    variables: Record<string, string>
): string => {
    return content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] !== undefined ? variables[varName] : match
    })
}

// ==================== 提示词服务 ====================

/**
 * 创建提示词
 * Requirements: 14.10
 * @param data 提示词创建数据
 * @returns 创建的提示词
 */
export const createPromptService = async (data: CreatePromptInput) => {
    // 检查节点是否存在
    const node = await findNodeByIdDao(data.nodeId)
    if (!node) {
        throw new Error('关联的节点不存在')
    }

    // 获取最新版本号并生成下一个版本
    const latestVersion = await getLatestVersionDao(
        data.nodeId,
        data.name,
        data.type
    )
    const nextVersion = generateNextVersion(latestVersion)

    // 自动提取变量（如果未提供）
    const variables = data.variables ?? extractVariables(data.content)

    return await createPromptDao(
        { ...data, variables },
        nextVersion
    )
}

/**
 * 获取提示词详情
 * Requirements: 14.9
 * @param id 提示词 ID
 * @returns 提示词或 null
 */
export const getPromptByIdService = async (id: number) => {
    return await findPromptByIdDao(id)
}

/**
 * 获取提示词列表（分页）
 * Requirements: 14.9
 * @param options 查询选项
 * @returns 提示词列表和总数
 */
export const getPromptsService = async (options: PromptListParams = {}) => {
    return await findManyPromptsDao(options)
}

/**
 * 获取节点的所有提示词
 * Requirements: 14.9
 * @param nodeId 节点 ID
 * @returns 提示词列表
 */
export const getPromptsByNodeIdService = async (nodeId: number) => {
    // 检查节点是否存在
    const node = await findNodeByIdDao(nodeId)
    if (!node) {
        throw new Error('节点不存在')
    }

    return await findPromptsByNodeIdDao(nodeId)
}

/**
 * 获取节点指定类型的生效提示词
 * @param nodeId 节点 ID
 * @param type 提示词类型
 * @returns 提示词或 null
 */
export const getActivePromptService = async (
    nodeId: number,
    type: PromptType
) => {
    return await findActivePromptDao(nodeId, type)
}

/**
 * 获取提示词版本历史
 * Requirements: 14.13
 * @param promptId 提示词 ID
 * @returns 版本列表
 */
export const getPromptVersionsService = async (promptId: number) => {
    // 获取提示词信息
    const prompt = await findPromptByIdDao(promptId)
    if (!prompt) {
        throw new Error('提示词不存在')
    }
    if (prompt.nodeId == null) {
        throw new Error('提示词未关联节点，无法查询版本历史')
    }

    return await findPromptVersionsDao(
        prompt.nodeId,
        prompt.name,
        prompt.type as PromptType
    )
}

/**
 * 更新提示词（创建新版本）
 * Requirements: 14.11
 * 注意：更新提示词会创建新版本，而非覆盖原版本
 * @param id 提示词 ID
 * @param data 更新数据
 * @returns 新版本的提示词
 */
export const updatePromptService = async (
    id: number,
    data: UpdatePromptInput
) => {
    // 检查提示词是否存在
    const existing = await findPromptByIdDao(id)
    if (!existing) {
        throw new Error('提示词不存在')
    }

    // 如果内容有变化，创建新版本
    if (data.content !== undefined && data.content !== existing.content) {
        if (existing.nodeId == null) {
            throw new Error('提示词未关联节点，无法创建新版本')
        }
        // 获取最新版本号并生成下一个版本
        const latestVersion = await getLatestVersionDao(
            existing.nodeId,
            existing.name,
            existing.type as PromptType
        )
        const nextVersion = generateNextVersion(latestVersion)

        // 自动提取变量（如果未提供）
        const variables = data.variables ?? extractVariables(data.content)

        // 创建新版本
        return await createPromptDao(
            {
                name: existing.name,
                title: data.title ?? existing.title,
                content: data.content,
                variables,
                type: existing.type as PromptType,
                nodeId: existing.nodeId,
            },
            nextVersion
        )
    }

    // 如果只是更新标题或变量，直接更新
    return await updatePromptDao(id, data)
}

/**
 * 激活提示词版本
 * Requirements: 14.12
 * 同一节点、同一类型下只能有一个版本处于生效状态
 * @param id 提示词 ID
 * @returns 激活后的提示词
 */
export const activatePromptService = async (id: number) => {
    // 检查提示词是否存在
    const prompt = await findPromptByIdDao(id)
    if (!prompt) {
        throw new Error('提示词不存在')
    }

    // 如果已经是生效状态，直接返回
    if (prompt.status === 1) {
        return prompt
    }

    if (prompt.nodeId == null) {
        throw new Error('提示词未关联节点，无法激活')
    }
    const targetNodeId = prompt.nodeId

    // 使用事务确保原子性
    return await prisma.$transaction(async (tx) => {
        // 先停用同节点、同类型的其他提示词
        await deactivatePromptsByTypeDao(
            targetNodeId,
            prompt.type as PromptType,
            tx as typeof prisma
        )

        // 激活当前提示词
        return await updatePromptStatusDao(id, 1, tx as typeof prisma)
    })
}

/**
 * 停用提示词
 * @param id 提示词 ID
 * @returns 停用后的提示词
 */
export const deactivatePromptService = async (id: number) => {
    // 检查提示词是否存在
    const prompt = await findPromptByIdDao(id)
    if (!prompt) {
        throw new Error('提示词不存在')
    }

    // 如果已经是未生效状态，直接返回
    if (prompt.status === 0) {
        return prompt
    }

    return await updatePromptStatusDao(id, 0)
}

/**
 * 删除提示词（软删除）
 * @param id 提示词 ID
 */
export const deletePromptService = async (id: number) => {
    // 检查提示词是否存在
    const existing = await findPromptByIdDao(id)
    if (!existing) {
        throw new Error('提示词不存在')
    }

    await softDeletePromptDao(id)
}

/**
 * 渲染提示词（替换变量）
 * Requirements: 14.14
 * @param input 渲染输入
 * @returns 渲染后的内容
 */
export const renderPromptService = async (input: RenderPromptInput) => {
    const { promptId, variables } = input

    // 获取提示词
    const prompt = await findPromptByIdDao(promptId)
    if (!prompt) {
        throw new Error('提示词不存在')
    }

    // 渲染内容
    const renderedContent = renderContent(prompt.content, variables)

    return {
        promptId: prompt.id,
        name: prompt.name,
        type: prompt.type,
        version: prompt.version,
        originalContent: prompt.content,
        renderedContent,
        variables: prompt.variables as string[],
        providedVariables: Object.keys(variables),
    }
}

/**
 * 预览渲染提示词（不保存）
 * Requirements: 14.14
 * @param input 预览输入
 * @returns 渲染后的内容
 */
export const previewPromptService = (input: PreviewPromptInput) => {
    const { content, variables } = input

    // 提取变量
    const extractedVariables = extractVariables(content)

    // 渲染内容
    const renderedContent = renderContent(content, variables)

    return {
        originalContent: content,
        renderedContent,
        extractedVariables,
        providedVariables: Object.keys(variables),
    }
}

/**
 * 获取节点所有类型的生效提示词
 * @param nodeId 节点 ID
 * @returns 生效提示词映射
 */
export const getActivePromptsForNodeService = async (nodeId: number) => {
    // 检查节点是否存在
    const node = await findNodeByIdDao(nodeId)
    if (!node) {
        throw new Error('节点不存在')
    }

    // 获取所有类型的生效提示词
    const [systemPrompt, userPrompt, assistantPrompt] = await Promise.all([
        findActivePromptDao(nodeId, 'system'),
        findActivePromptDao(nodeId, 'user'),
        findActivePromptDao(nodeId, 'assistant'),
    ])

    return {
        system: systemPrompt,
        user: userPrompt,
        assistant: assistantPrompt,
    }
}

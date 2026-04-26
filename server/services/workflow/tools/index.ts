/**
 * 工作流工具注册表（兼容层）
 *
 * 通用工具已迁到 agent-platform/tools/，此处保留 re-export + 业务私有工具注册
 * 业务私有工具（parseAndAskStance）待 T17 contract vertical 任务整体搬迁
 */

import type { StructuredTool } from '@langchain/core/tools'
import type { ToolMeta, ToolContext, ToolModule } from '~~/server/services/agent-platform/tools/types'
import { getToolMetaFromDefinition } from '~~/server/services/agent-platform/tools/types'
import {
    getAllToolsService as _getAllToolsService,
    getToolMetaService as _getToolMetaService,
    getToolInstancesService as _getToolInstancesService,
    hasToolService as _hasToolService,
    getAllToolNamesService as _getAllToolNamesService,
} from '~~/server/services/agent-platform/tools/index'

// 业务私有工具（合同审查，待 T17 搬迁）
import * as parseAndAskStanceTool from './parseAndAskStance.tool'

/** 业务私有工具模块映射（仅 parseAndAskStance） */
const privateToolModules: Record<string, ToolModule> = {
    parse_and_ask_stance: parseAndAskStanceTool,
}

/**
 * 获取所有已注册工具的元信息（通用 + 业务私有）
 */
export function getAllToolsService(): ToolMeta[] {
    const privateTools = Object.values(privateToolModules).map(module =>
        getToolMetaFromDefinition(module.toolDefinition)
    )
    return [..._getAllToolsService(), ...privateTools]
}

/**
 * 根据名称获取工具元信息（通用 + 业务私有）
 */
export function getToolMetaService(name: string): ToolMeta | null {
    const privateModule = privateToolModules[name]
    if (privateModule) return getToolMetaFromDefinition(privateModule.toolDefinition)
    return _getToolMetaService(name)
}

/**
 * 根据名称列表获取工具实例（通用 + 业务私有）
 */
export function getToolInstancesService(
    names: string[],
    context: ToolContext
): StructuredTool[] {
    const tools: StructuredTool[] = []

    for (const name of names) {
        const privateModule = privateToolModules[name]
        if (privateModule) {
            tools.push(privateModule.createTool(context))
            continue
        }
        // 通用工具逐个查找（避免重复遍历，直接调用底层）
        const toolInstance = _getToolInstancesService([name], context)
        if (toolInstance.length > 0) {
            tools.push(...toolInstance)
        }
    }

    return tools
}

/**
 * 检查工具是否存在（通用 + 业务私有）
 */
export function hasToolService(name: string): boolean {
    return name in privateToolModules || _hasToolService(name)
}

/**
 * 获取所有工具名称（通用 + 业务私有）
 */
export function getAllToolNamesService(): string[] {
    return [..._getAllToolNamesService(), ...Object.keys(privateToolModules)]
}

// 导出类型（保持原有导出路径不变）
export type { ToolMeta, ToolContext, ToolModule, ToolParameter } from '~~/server/services/agent-platform/tools/types'

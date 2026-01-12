/**
 * 工作流工具注册表
 *
 * 统一管理所有工作流工具，提供工具元信息查询和实例创建
 * Requirements: 12.1.1-12.1.5
 */

import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ToolMeta, ToolContext, ToolModule } from './types'
import { getToolMetaFromDefinition } from './types'

// 导入所有工具模块
import * as searchCaseMaterialsTool from './searchCaseMaterials.tool'
import * as searchLawTool from './searchLaw.tool'

/** 工具模块映射 */
const toolModules: Record<string, ToolModule> = {
    search_case_materials: searchCaseMaterialsTool,
    search_law: searchLawTool,
}

/**
 * 获取所有已注册工具的元信息
 *
 * @returns 工具元信息列表
 */
export function getAllToolsService(): ToolMeta[] {
    return Object.values(toolModules).map(module =>
        getToolMetaFromDefinition(module.toolDefinition)
    )
}

/**
 * 根据名称获取工具元信息
 *
 * @param name 工具名称
 * @returns 工具元信息，不存在则返回 null
 */
export function getToolMetaService(name: string): ToolMeta | null {
    const module = toolModules[name]
    return module ? getToolMetaFromDefinition(module.toolDefinition) : null
}

/**
 * 根据名称列表获取工具实例
 *
 * @param names 工具名称列表
 * @param context 工具上下文
 * @returns 工具实例列表
 */
export function getToolInstancesService(
    names: string[],
    context: ToolContext
): StructuredToolInterface[] {
    const tools: StructuredToolInterface[] = []

    for (const name of names) {
        const module = toolModules[name]
        if (module) {
            tools.push(module.createTool(context))
        } else {
            logger.warn(`工具 ${name} 不存在，已跳过`)
        }
    }

    return tools
}

/**
 * 检查工具是否存在
 *
 * @param name 工具名称
 * @returns 是否存在
 */
export function hasToolService(name: string): boolean {
    return name in toolModules
}

/**
 * 获取所有工具名称
 *
 * @returns 工具名称列表
 */
export function getAllToolNamesService(): string[] {
    return Object.keys(toolModules)
}

// 导出类型
export type { ToolMeta, ToolContext, ToolModule, ToolParameter } from './types'

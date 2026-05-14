/**
 * 工作流工具类型定义
 *
 * 定义工具元信息、上下文等接口
 * Requirements: 12.1.1, 12.1.2
 */

import { tool, type StructuredTool } from '@langchain/core/tools'
import type { ZodObject, ZodType, z } from 'zod'
import type { ToolContext, ToolDefinition, ToolModule } from '#shared/types/agentTools'

/** @deprecated 已迁至 shared/types/agentTools.ts，此文件保留兼容旧引用 */
export type { ToolContext, ToolDefinition, ToolModule } from '#shared/types/agentTools'

/** 工具参数定义（用于 API 返回） */
export interface ToolParameter {
    /** 参数名称 */
    name: string
    /** 参数类型 */
    type: string
    /** 参数描述 */
    description: string
    /** 是否必填 */
    required: boolean
    /** 默认值 */
    default?: unknown
}

/** 工具元信息（用于 API 返回） */
export interface ToolMeta {
    /** 工具名称（唯一标识） */
    name: string
    /** 工具描述 */
    description: string
    /** 参数定义列表 */
    parameters: ToolParameter[]
}

/**
 * 从 zod schema 提取参数元信息
 *
 * @param schema zod object schema
 * @returns 参数定义列表
 */
export function extractParametersFromSchema(schema: ZodObject<Record<string, ZodType>>): ToolParameter[] {
    const shape = schema.shape
    const parameters: ToolParameter[] = []

    for (const [name, fieldSchema] of Object.entries(shape)) {
        const zodSchema = fieldSchema as ZodType
        const description = zodSchema.description || ''

        // 判断是否必填（检查是否有 optional 包装）
        const isOptional = zodSchema.isOptional()

        // 获取基础类型
        let type = 'string'
        let defaultValue: unknown = undefined

        // 解包 optional 和 default（Zod v4 使用 _zod.def 内部结构）
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let innerDef: any = (zodSchema as any)._zod.def
        if (innerDef.type === 'optional') {
            innerDef = innerDef.innerType._zod.def
        }
        if (innerDef.type === 'default') {
            defaultValue = innerDef.defaultValue
            innerDef = innerDef.innerType._zod.def
        }

        // 获取类型名称（Zod v4 使用小写类型名）
        const typeName = innerDef.type as string
        switch (typeName) {
            case 'string':
                type = 'string'
                break
            case 'number':
                type = 'number'
                break
            case 'boolean':
                type = 'boolean'
                break
            case 'array':
                type = 'array'
                break
            case 'object':
                type = 'object'
                break
            case 'enum':
                type = 'string'
                break
            default:
                type = 'string'
        }

        parameters.push({
            name,
            type,
            description,
            required: !isOptional,
            default: defaultValue,
        })
    }

    return parameters
}

/**
 * 从工具定义生成工具元信息
 *
 * @param definition 工具定义
 * @returns 工具元信息
 */
export function getToolMetaFromDefinition(definition: ToolDefinition<ZodObject<Record<string, ZodType>>>): ToolMeta {
    return {
        name: definition.name,
        description: definition.description,
        parameters: extractParametersFromSchema(definition.schema),
    }
}

/**
 * 通用工具样板封装，消除每个 *.tool.ts 重复的 try/catch + tool({...}) 模板。
 *
 * - 自动注入 toolDefinition 的 name/description/schema
 * - handler 抛出异常时统一 logger.error + 返回 JSON 错误响应
 * - handler 返回 string 直接透传，返回对象自动 JSON.stringify
 *
 * @param definition 工具定义（含 name/description/schema）
 * @param handler 业务逻辑：(input, context) => Promise<string | object>
 * @param options.errorLabel 错误日志/响应中显示的中文标签，缺省用 toolDefinition.name
 */
export function createSimpleTool<S extends ZodObject<Record<string, ZodType>>>(
    definition: ToolDefinition<S>,
    handler: (input: z.infer<S>, context: ToolContext) => Promise<unknown>,
    options?: { errorLabel?: string },
): (context: ToolContext) => StructuredTool {
    const errorLabel = options?.errorLabel ?? definition.name
    return (context: ToolContext) => tool(
        async (input: z.infer<S>) => {
            try {
                const result = await handler(input, context)
                return typeof result === 'string' ? result : JSON.stringify(result)
            } catch (error) {
                logger.error(`${errorLabel}失败:`, error)
                return JSON.stringify({
                    error: `${errorLabel}失败`,
                    message: error instanceof Error ? error.message : '未知错误',
                })
            }
        },
        {
            name: definition.name,
            description: definition.description,
            schema: definition.schema,
        },
    ) as StructuredTool
}

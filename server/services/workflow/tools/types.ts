/**
 * 工作流工具类型定义
 *
 * 定义工具元信息、上下文等接口
 * Requirements: 12.1.1, 12.1.2
 */

import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ZodObject, ZodTypeAny } from 'zod'

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

/** 工具上下文（运行时注入） */
export interface ToolContext {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
}

/** 工具定义（单一数据源） */
export interface ToolDefinition<T extends ZodObject<Record<string, ZodTypeAny>>> {
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
    toolDefinition: ToolDefinition<ZodObject<Record<string, ZodTypeAny>>>
    /** 工具工厂函数 */
    createTool: (context: ToolContext) => StructuredToolInterface
}

/**
 * 从 zod schema 提取参数元信息
 *
 * @param schema zod object schema
 * @returns 参数定义列表
 */
export function extractParametersFromSchema(schema: ZodObject<Record<string, ZodTypeAny>>): ToolParameter[] {
    const shape = schema.shape
    const parameters: ToolParameter[] = []

    for (const [name, fieldSchema] of Object.entries(shape)) {
        const zodSchema = fieldSchema as ZodTypeAny
        const description = zodSchema._def.description || ''

        // 判断是否必填（检查是否有 optional 包装）
        const isOptional = zodSchema.isOptional()

        // 获取基础类型
        let type = 'string'
        let defaultValue: unknown = undefined

        // 解包 optional 和 default
        let innerSchema = zodSchema
        if (innerSchema._def.typeName === 'ZodOptional') {
            innerSchema = innerSchema._def.innerType
        }
        if (innerSchema._def.typeName === 'ZodDefault') {
            defaultValue = innerSchema._def.defaultValue()
            innerSchema = innerSchema._def.innerType
        }

        // 获取类型名称
        const typeName = innerSchema._def.typeName
        switch (typeName) {
            case 'ZodString':
                type = 'string'
                break
            case 'ZodNumber':
                type = 'number'
                break
            case 'ZodBoolean':
                type = 'boolean'
                break
            case 'ZodArray':
                type = 'array'
                break
            case 'ZodObject':
                type = 'object'
                break
            case 'ZodEnum':
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
export function getToolMetaFromDefinition(definition: ToolDefinition<ZodObject<Record<string, ZodTypeAny>>>): ToolMeta {
    return {
        name: definition.name,
        description: definition.description,
        parameters: extractParametersFromSchema(definition.schema),
    }
}

/**
 * 工作流工具类型定义
 *
 * 定义工具元信息、上下文等接口
 * Requirements: 12.1.1, 12.1.2
 */

import type { StructuredTool } from '@langchain/core/tools'
import type { ZodObject, ZodType } from 'zod'

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
    /** 运行 ID（模块对话工具需要） */
    runId?: string
}

/** 工具定义（单一数据源） */
export interface ToolDefinition<T extends ZodObject<Record<string, ZodType>>> {
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
    toolDefinition: ToolDefinition<ZodObject<Record<string, ZodType>>>
    /** 工具工厂函数 */
    createTool: (context: ToolContext) => StructuredTool
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

/**
 * 工作流工具类型定义
 *
 * 定义工具元信息、上下文等接口
 * Requirements: 12.1.1, 12.1.2
 */

import { tool, type StructuredTool } from '@langchain/core/tools'
import { z, type ZodObject, type ZodType } from 'zod'
import type { ToolContext, ToolDefinition, ToolModule } from '#shared/types/agentTools'

/** @deprecated 已迁至 shared/types/agentTools.ts，此文件保留兼容旧引用 */
export type { ToolContext, ToolDefinition, ToolModule } from '#shared/types/agentTools'

/**
 * LLM 偶尔把对象参数 JSON.stringify 后整段当字符串回传(例如 fieldValues="{\"原告\":\"X\"}")。
 * z.record 直接校验会报 "expected record, received string"，被 LangChain ToolNode 包成
 * ToolMessage 让 LLM "fix and retry"，LLM 修复无效就会陷入循环 → SSE 流不结束 → 前端 loading 不停。
 *
 * 这里把 schema 改成 union(record | string),让 LangChain 的工具 JSON Schema 能描述这种容错
 * (z.preprocess/transform 无法表示成 JSON Schema 会被拒绝)。handler 端通过 normalizeJsonRecord
 * 把 string 形态 JSON.parse 还原成 record。与既有的 z.coerce.number() 容错策略对齐。
 */
export function jsonRecord<V extends ZodType>(valueSchema: V) {
    return z.union([
        z.record(z.string(), valueSchema),
        z.string(),
    ])
}

/**
 * 配合 jsonRecord 使用:在 handler 内把 LLM 偶发回传的 JSON 字符串归一化为对象。
 * - 输入是对象 → 原样返回
 * - 输入是合法的对象 JSON 字符串 → JSON.parse 后返回
 * - 输入是非法字符串 → 退回空对象,后续业务校验"至少有一个非 null"等逻辑会自然失败
 *
 * 不在这里抛错的原因:LangChain ToolNode 抛错会让 LLM "fix and retry",反而陷入循环;
 * 让业务校验出"无字段"返回 success:false,LLM 会改 prompt 重传而不是死磕同一个字符串。
 */
export function normalizeJsonRecord<V>(
    raw: Record<string, V> | string | undefined,
): Record<string, V> | undefined {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, V>
        }
    }
    catch { /* fallthrough */ }
    return {}
}

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

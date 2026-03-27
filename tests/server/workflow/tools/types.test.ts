/**
 * workflow tools types 测试
 *
 * 测试工具参数提取和元信息生成功能
 *
 * **Feature: workflow-tools-types**
 * **Validates: 工具类型和参数提取功能**
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
    extractParametersFromSchema,
    getToolMetaFromDefinition,
    type ToolDefinition,
} from '../../../../server/services/workflow/tools/types'

describe('extractParametersFromSchema 参数提取', () => {
    it('应正确提取字符串参数', () => {
        const schema = z.object({
            name: z.string().describe('姓名'),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'name',
            type: 'string',
            description: '姓名',
            required: true,
        })
    })

    it('应正确提取可选参数', () => {
        const schema = z.object({
            name: z.string().optional(),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'name',
            required: false,
        })
    })

    it('应正确提取带默认值的参数', () => {
        const schema = z.object({
            count: z.number().default(10),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'count',
            type: 'number',
            default: 10,
            required: false,
        })
    })

    it('应正确提取 number 类型', () => {
        const schema = z.object({
            age: z.number().describe('年龄'),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'age',
            type: 'number',
        })
    })

    it('应正确提取 boolean 类型', () => {
        const schema = z.object({
            enabled: z.boolean(),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'enabled',
            type: 'boolean',
        })
    })

    it('应正确提取 array 类型', () => {
        const schema = z.object({
            items: z.array(z.string()),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'items',
            type: 'array',
        })
    })

    it('应正确提取 object 类型', () => {
        const schema = z.object({
            data: z.object({}),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'data',
            type: 'object',
        })
    })

    it('应正确提取 enum 类型', () => {
        const schema = z.object({
            status: z.enum(['A', 'B']),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(1)
        expect(params[0]).toMatchObject({
            name: 'status',
            type: 'string',
        })
    })

    it('无描述的参数应返回空描述', () => {
        const schema = z.object({
            value: z.string(),
        })
        const params = extractParametersFromSchema(schema)
        expect(params[0].description).toBe('')
    })

    it('空 schema 应返回空数组', () => {
        const schema = z.object({})
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(0)
    })

    it('多个不同类型参数应全部正确提取', () => {
        const schema = z.object({
            name: z.string(),
            count: z.number().optional(),
            enabled: z.boolean().default(true),
            items: z.array(z.string()).describe('列表'),
        })
        const params = extractParametersFromSchema(schema)
        expect(params).toHaveLength(4)
        expect(params[0].name).toBe('name')
        expect(params[1].name).toBe('count')
        expect(params[2].name).toBe('enabled')
        expect(params[3].name).toBe('items')
    })
})

describe('getToolMetaFromDefinition 工具元信息生成', () => {
    it('应正确生成工具元信息', () => {
        const definition: ToolDefinition<any> = {
            name: 'testTool',
            description: '测试工具',
            schema: z.object({
                param1: z.string().describe('参数1'),
                param2: z.number().optional(),
            }),
        }
        const meta = getToolMetaFromDefinition(definition)
        expect(meta).toMatchObject({
            name: 'testTool',
            description: '测试工具',
        })
        expect(meta.parameters).toHaveLength(2)
        expect(meta.parameters[0]).toMatchObject({
            name: 'param1',
            type: 'string',
            description: '参数1',
        })
        expect(meta.parameters[1]).toMatchObject({
            name: 'param2',
            type: 'number',
            required: false,
        })
    })

    it('空参数 schema 应返回空参数列表', () => {
        const definition: ToolDefinition<any> = {
            name: 'emptyTool',
            description: '空参数工具',
            schema: z.object({}),
        }
        const meta = getToolMetaFromDefinition(definition)
        expect(meta.parameters).toHaveLength(0)
    })
})

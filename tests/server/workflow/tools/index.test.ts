/**
 * workflow tools index 测试
 *
 * 测试工具注册表功能
 *
 * **Feature: workflow-tools-index**
 * **Validates: 工作流工具注册和查询功能**
 */

import { describe, it, expect } from 'vitest'
import {
    getAllToolsService,
    getToolMetaService,
    hasToolService,
    getAllToolNamesService,
    getToolInstancesService,
} from '../../../../server/services/workflow/tools/index'

describe('getAllToolsService 所有工具元信息', () => {
    it('应返回所有已注册工具的元信息', () => {
        const tools = getAllToolsService()
        expect(tools.length).toBeGreaterThan(0)
        // 至少应包含已知工具
        const toolNames = tools.map(t => t.name)
        expect(toolNames).toContain('search_case_materials')
        expect(toolNames).toContain('search_law')
        expect(toolNames).toContain('process_materials')
    })

    it('每个工具应有 name 和 parameters', () => {
        const tools = getAllToolsService()
        for (const tool of tools) {
            expect(tool.name).toBeTruthy()
            expect(Array.isArray(tool.parameters)).toBe(true)
        }
    })
})

describe('getToolMetaService 工具元信息查询', () => {
    it('已知工具应返回元信息', () => {
        const meta = getToolMetaService('search_case_materials')
        expect(meta).not.toBeNull()
        expect(meta!.name).toBe('search_case_materials')
    })

    it('未知工具应返回 null', () => {
        expect(getToolMetaService('non_existent_tool')).toBeNull()
        expect(getToolMetaService('')).toBeNull()
    })
})

describe('hasToolService 工具存在检查', () => {
    it('已知工具应返回 true', () => {
        expect(hasToolService('search_case_materials')).toBe(true)
        expect(hasToolService('search_law')).toBe(true)
        expect(hasToolService('process_materials')).toBe(true)
    })

    it('未知工具应返回 false', () => {
        expect(hasToolService('non_existent')).toBe(false)
        expect(hasToolService('')).toBe(false)
    })
})

describe('getAllToolNamesService 所有工具名称', () => {
    it('应返回非空数组', () => {
        const names = getAllToolNamesService()
        expect(Array.isArray(names)).toBe(true)
        expect(names.length).toBeGreaterThan(0)
    })

    it('应包含所有已知工具', () => {
        const names = getAllToolNamesService()
        expect(names).toContain('search_case_materials')
        expect(names).toContain('search_law')
        expect(names).toContain('process_materials')
    })

    it('工具名称不应重复', () => {
        const names = getAllToolNamesService()
        const unique = new Set(names)
        expect(unique.size).toBe(names.length)
    })

    it('应包含业务私有工具 parse_and_ask_stance', () => {
        expect(getAllToolNamesService()).toContain('parse_and_ask_stance')
    })
})

describe('getToolMetaService 业务私有工具', () => {
    it('parse_and_ask_stance 元信息可查到', () => {
        const meta = getToolMetaService('parse_and_ask_stance')
        expect(meta).not.toBeNull()
        expect(meta!.name).toBe('parse_and_ask_stance')
    })
})

describe('hasToolService 业务私有工具', () => {
    it('parse_and_ask_stance 应存在', () => {
        expect(hasToolService('parse_and_ask_stance')).toBe(true)
    })
})

describe('getAllToolsService 业务私有工具', () => {
    it('返回结果应包含 parse_and_ask_stance', () => {
        const tools = getAllToolsService()
        const names = tools.map(t => t.name)
        expect(names).toContain('parse_and_ask_stance')
    })
})

describe('getToolInstancesService 工具实例化', () => {
    const ctx = { userId: 1, sessionId: 'sess-x', reviewId: 100 }

    it('单个通用工具名应能拿到实例', () => {
        const instances = getToolInstancesService(['search_law'], ctx)
        expect(instances).toHaveLength(1)
        expect(instances[0]!.name).toBe('search_law')
    })

    it('单个业务私有工具名应能拿到实例', () => {
        const instances = getToolInstancesService(['parse_and_ask_stance'], ctx)
        expect(instances).toHaveLength(1)
        expect(instances[0]!.name).toBe('parse_and_ask_stance')
    })

    it('混合通用 + 业务私有工具名应同时返回', () => {
        const instances = getToolInstancesService(
            ['search_law', 'parse_and_ask_stance'],
            ctx,
        )
        expect(instances).toHaveLength(2)
        const names = instances.map(t => t.name)
        expect(names).toContain('search_law')
        expect(names).toContain('parse_and_ask_stance')
    })

    it('未知工具名应被静默跳过（不抛错）', () => {
        const instances = getToolInstancesService(
            ['definitely_not_a_tool', 'search_law'],
            ctx,
        )
        expect(instances).toHaveLength(1)
        expect(instances[0]!.name).toBe('search_law')
    })

    it('空数组返回空数组', () => {
        expect(getToolInstancesService([], ctx)).toEqual([])
    })
})

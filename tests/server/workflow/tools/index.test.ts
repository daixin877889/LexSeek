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
} from '../../../../server/services/workflow/tools/index'

describe('getAllToolsService 所有工具元信息', () => {
    it('应返回所有已注册工具的元信息', () => {
        const tools = getAllToolsService()
        expect(tools.length).toBeGreaterThan(0)
        // 至少应包含已知工具
        const toolNames = tools.map(t => t.name)
        expect(toolNames).toContain('search_case_materials')
        expect(toolNames).toContain('search_law')
        expect(toolNames).toContain('reserve_points')
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
        expect(hasToolService('reserve_points')).toBe(true)
        expect(hasToolService('confirm_points')).toBe(true)
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
        expect(names).toContain('reserve_points')
        expect(names).toContain('confirm_points')
        expect(names).toContain('rollback_points')
    })

    it('工具名称不应重复', () => {
        const names = getAllToolNamesService()
        const unique = new Set(names)
        expect(unique.size).toBe(names.length)
    })
})

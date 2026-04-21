/**
 * toolCallLimit 中间件测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.3
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_TOOL_LIMITS, LIMITED_TOOL_NAMES } from '#shared/types/agentAudit'
import { createToolCallLimitMiddlewares } from '../../../../server/services/workflow/middleware/toolCallLimit.middleware'

describe('toolCallLimit.middleware', () => {
    it('导出 DEFAULT_TOOL_LIMITS 与 spec §4.3 一致', () => {
        expect(DEFAULT_TOOL_LIMITS).toMatchObject({
            read_skill_file: 30,
            process_materials: 5,
            write_skill_file: 20,
            run_skill_script: 10,
            upload_workspace_file: 10,
        })
    })

    it('createToolCallLimitMiddlewares 为每个受限工具创建一个 middleware 实例', () => {
        const list = createToolCallLimitMiddlewares()
        expect(Array.isArray(list)).toBe(true)
        expect(list.length).toBe(LIMITED_TOOL_NAMES.length)
        for (const mw of list) {
            expect(mw).toBeDefined()
        }
    })
})

import { describe, it, expect } from 'vitest'
import {
    MIDDLEWARE_NAMES,
    MIDDLEWARE_PRIORITY,
} from '~~/server/services/workflow/middleware/types'

describe('MIDDLEWARE_NAMES 扩展', () => {
    it('保留既有 9 个中间件名常量', () => {
        expect(MIDDLEWARE_NAMES.PROCESS_MATERIAL).toBe('caseProcessMaterial')
        expect(MIDDLEWARE_NAMES.POINT_CONSUMPTION).toBe('pointConsumption')
        expect(MIDDLEWARE_NAMES.MATERIAL_CONTEXT).toBe('caseMaterialContext')
        expect(MIDDLEWARE_NAMES.MODULE_CONTEXT).toBe('moduleContext')
        expect(MIDDLEWARE_NAMES.SUMMARIZATION).toBe('summarization')
        expect(MIDDLEWARE_NAMES.SAFETY_TRIM).toBe('safetyTrim')
        expect(MIDDLEWARE_NAMES.SKILLS_DISCOVERY).toBe('skillsDiscovery')
        expect(MIDDLEWARE_NAMES.TODO_LIST).toBe('todoList')
        expect(MIDDLEWARE_NAMES.RESULT_PERSISTENCE).toBe('analysisResultPersistence')
    })

    it('新增 REVIEW_RESULT_PERSISTENCE 常量', () => {
        expect(MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE).toBe('reviewResultPersistence')
    })

    it('REVIEW_RESULT_PERSISTENCE 与 RESULT_PERSISTENCE 共用末位优先级', () => {
        // MVP 策略：两者同 priority=90，实际运行时只挂一个
        expect(MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE).toBe(90)
    })
})

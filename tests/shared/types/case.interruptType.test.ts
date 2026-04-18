import { describe, it, expect } from 'vitest'
import { InterruptType } from '#shared/types/case'

describe('InterruptType enum', () => {
    it('保留既有四个中断类型', () => {
        expect(InterruptType.CASE_INFO_CHECK).toBe('case_info_check')
        expect(InterruptType.BASIC_INFO_CONFIRM).toBe('basic_info_confirm')
        expect(InterruptType.MODULE_SELECT).toBe('module_select')
        expect(InterruptType.INSUFFICIENT_POINTS).toBe('insufficient_points')
    })

    it('新增 awaiting_stance（合同审查立场选择）', () => {
        expect(InterruptType.AWAITING_STANCE).toBe('awaiting_stance')
    })
})

/**
 * useInterruptSnapshot helper 测试
 *
 * **Feature: interrupt-tool-card-inline / Task 1**
 */
import { describe, it, expect } from 'vitest'
import { useInterruptSnapshot } from '~/composables/agent-platform/useInterruptSnapshot'

describe('useInterruptSnapshot', () => {
    it('record() 正常写入：interrupt + resumeValue + resolvedAt', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        const interrupt = { type: 'template_select', toolCallId: 'call_001', payload: 'foo' }

        record(interrupt, { templateId: 11 })

        expect(resolvedInterrupts['call_001']).toBeDefined()
        expect(resolvedInterrupts['call_001']!.interrupt).toEqual(interrupt)
        expect(resolvedInterrupts['call_001']!.resumeValue).toEqual({ templateId: 11 })
        expect(resolvedInterrupts['call_001']!.resolvedAt).toBeInstanceOf(Date)
    })

    it('record() 接受 null resumeValue（用户取消）', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        record({ type: 'template_select', toolCallId: 'call_002' }, null)
        expect(resolvedInterrupts['call_002']!.resumeValue).toBeNull()
    })

    it.each([
        ['record(null, ...)', null],
        ['record(缺 toolCallId)', { type: 'template_select' } as any],
        ['record(缺 type)', { toolCallId: 'call_003' } as any],
    ])('非法输入跳过：%s', (_label, badInput) => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        record(badInput, { templateId: 1 })
        expect(Object.keys(resolvedInterrupts)).toHaveLength(0)
    })

    it('clear() 清空所有字段', () => {
        const { resolvedInterrupts, record, clear } = useInterruptSnapshot()
        record({ type: 't1', toolCallId: 'a' }, 1)
        record({ type: 't2', toolCallId: 'b' }, 2)
        expect(Object.keys(resolvedInterrupts)).toHaveLength(2)
        clear()
        expect(Object.keys(resolvedInterrupts)).toHaveLength(0)
    })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DocumentSnapshotDetail from '~/components/assistant/document/DocumentSnapshotDetail.vue'

const snapshot = {
    id: 1,
    draftId: 1,
    source: 'ai-extract' as const,
    values: { name: '新名字', amount: '200' },
    aiTitle: null,
    createdAt: '2026-04-19T10:00:00Z',
}

describe('DocumentSnapshotDetail', () => {
    it('点"用这个值"对指定字段触发 applyField', async () => {
        const w = mount(DocumentSnapshotDetail, {
            props: {
                snapshot,
                currentValues: { name: '老名字', amount: '100' },
            },
        })
        await w.get('[data-testid="apply-field-name"]').trigger('click')
        expect(w.emitted('applyField')?.[0]).toEqual(['name'])
    })

    it('点"全部采用"触发 applyAll', async () => {
        const w = mount(DocumentSnapshotDetail, {
            props: {
                snapshot,
                currentValues: { name: 'old', amount: 'old' },
            },
        })
        await w.get('[data-testid="apply-all"]').trigger('click')
        expect(w.emitted('applyAll')?.length).toBe(1)
    })

    it('字段名自动合并两边 keys（当前有 amount、快照有 newField 都要出现）', async () => {
        const w = mount(DocumentSnapshotDetail, {
            props: {
                snapshot: { ...snapshot, values: { newField: 'x' } },
                currentValues: { amount: '100' },
            },
        })
        expect(w.text()).toContain('newField')
        expect(w.text()).toContain('amount')
    })
})

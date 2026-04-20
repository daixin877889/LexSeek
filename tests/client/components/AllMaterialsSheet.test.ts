/**
 * AllMaterialsSheet 组件测试
 *
 * **Feature: document-case-materials-sync (Task 10)**
 *
 * 验证点：
 * - 空 materials 时渲染"暂无材料"空态，数量显示 0
 * - 传入 3 条 materials 时渲染 3 行，description 显示 3
 * - 点击某一行时 emit preview-material 并带上对应的 material
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AllMaterialsSheet from '~/components/assistant/document/AllMaterialsSheet.vue'
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'

// Sheet 内部依赖 Teleport，stub 成透传 div 方便测试 DOM
const commonStubs = {
    Sheet: { template: '<div><slot /></div>' },
    SheetContent: { template: '<div><slot /></div>' },
    SheetHeader: { template: '<div><slot /></div>' },
    SheetTitle: { template: '<div><slot /></div>' },
    SheetDescription: { template: '<div><slot /></div>' },
    FolderIcon: { template: '<span class="folder-icon" />' },
}

function makeMaterial(partial: Partial<CaseDetailMaterialItem> & { id: number }): CaseDetailMaterialItem {
    return {
        id: partial.id,
        name: partial.name ?? `材料${partial.id}`,
        type: partial.type ?? 1,
        typeText: partial.typeText ?? '文档',
        ossFileId: partial.ossFileId ?? 100 + partial.id,
        isEncrypted: partial.isEncrypted ?? false,
        status: partial.status ?? 2,
        summary: partial.summary ?? null,
        fileName: partial.fileName ?? `file-${partial.id}.pdf`,
        fileSize: partial.fileSize ?? 1024,
        fileType: partial.fileType ?? 'application/pdf',
    }
}

describe('AllMaterialsSheet', () => {
    it('空 materials 时渲染空态"暂无材料"', () => {
        const wrapper = mount(AllMaterialsSheet, {
            props: { open: true, materials: [] },
            global: { stubs: commonStubs },
        })
        expect(wrapper.text()).toContain('暂无材料')
        expect(wrapper.text()).toContain('0')
        expect(wrapper.findAll('li').length).toBe(0)
    })

    it('传入 3 条 materials 时渲染 3 行且 description 显示 3', () => {
        const materials: CaseDetailMaterialItem[] = [
            makeMaterial({ id: 1, name: '起诉状.pdf' }),
            makeMaterial({ id: 2, name: '合同.docx', type: 1 }),
            makeMaterial({ id: 3, name: '录音.mp3', type: 3, typeText: '音频' }),
        ]
        const wrapper = mount(AllMaterialsSheet, {
            props: { open: true, materials },
            global: { stubs: commonStubs },
        })
        const lis = wrapper.findAll('li')
        expect(lis.length).toBe(3)
        expect(wrapper.text()).toContain('3')
        expect(wrapper.text()).toContain('起诉状.pdf')
        expect(wrapper.text()).toContain('合同.docx')
        expect(wrapper.text()).toContain('录音.mp3')
    })

    it('点击某行时 emit preview-material 带对应 material', async () => {
        const materials: CaseDetailMaterialItem[] = [
            makeMaterial({ id: 11, name: 'A.pdf' }),
            makeMaterial({ id: 22, name: 'B.pdf' }),
        ]
        const wrapper = mount(AllMaterialsSheet, {
            props: { open: true, materials },
            global: { stubs: commonStubs },
        })
        const lis = wrapper.findAll('li')
        await lis[1]!.trigger('click')
        const events = wrapper.emitted('preview-material')
        expect(events).toBeTruthy()
        expect(events!.length).toBe(1)
        expect(events![0]![0]).toMatchObject({ id: 22, name: 'B.pdf' })
    })
})

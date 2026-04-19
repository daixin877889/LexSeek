/**
 * DocumentDraftTitleInput 组件测试
 *
 * **Feature: contract-review-m1 / Task 17**
 *
 * 验证点：
 * - 默认显示态渲染传入的 title
 * - 点击标题或编辑按钮切换到编辑态
 * - blur 触发 save emit（如果内容不同且非空）
 * - Esc 取消编辑不 emit save
 * - 相同内容不 emit save（避免无意义 PATCH）
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DocumentDraftTitleInput from '~/components/assistant/document/DocumentDraftTitleInput.vue'

const commonStubs = {
    PencilIcon: { template: '<span />' },
}

describe('DocumentDraftTitleInput', () => {
    it('默认显示态：渲染传入的 title', () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: '我的起诉状' },
            global: { stubs: commonStubs },
        })
        expect(w.text()).toContain('我的起诉状')
    })

    it('点击标题切换到编辑态，blur 触发 save', async () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: 'old' },
            global: { stubs: commonStubs },
        })
        const titleDisplay = w.find('[data-testid="title-display"]')
        expect(titleDisplay.exists()).toBe(true)
        await titleDisplay.trigger('click')

        const input = w.find('input')
        expect(input.exists()).toBe(true)
        expect((input.element as HTMLInputElement).value).toBe('old')

        await input.setValue('new')
        await input.trigger('blur')

        expect(w.emitted('save')).toBeTruthy()
        expect(w.emitted('save')?.[0]).toEqual(['new'])
    })

    it('Esc 取消不 emit save', async () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: 'old' },
            global: { stubs: commonStubs },
        })
        await w.find('[data-testid="title-display"]').trigger('click')

        const input = w.find('input')
        await input.setValue('changed')
        await input.trigger('keydown', { key: 'Escape' })

        expect(w.emitted('save')).toBeUndefined()
    })

    it('相同内容不 emit save（避免无意义 PATCH）', async () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: 'same' },
            global: { stubs: commonStubs },
        })
        await w.find('[data-testid="title-display"]').trigger('click')

        const input = w.find('input')
        await input.setValue('same')
        await input.trigger('blur')

        expect(w.emitted('save')).toBeUndefined()
    })

    it('点击编辑按钮切换到编辑态', async () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: 'test' },
            global: { stubs: commonStubs },
        })
        const editBtn = w.find('button')
        expect(editBtn.exists()).toBe(true)
        await editBtn.trigger('click')

        const input = w.find('input')
        expect(input.exists()).toBe(true)
    })

    it('Enter 按键确认并 emit save', async () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: 'old' },
            global: { stubs: commonStubs },
        })
        await w.find('[data-testid="title-display"]').trigger('click')

        const input = w.find('input')
        await input.setValue('new')
        await input.trigger('keydown', { key: 'Enter' })

        expect(w.emitted('save')?.[0]).toEqual(['new'])
    })

    it('空字符串或仅空格不 emit save', async () => {
        const w = mount(DocumentDraftTitleInput, {
            props: { title: 'old' },
            global: { stubs: commonStubs },
        })
        await w.find('[data-testid="title-display"]').trigger('click')

        const input = w.find('input')
        await input.setValue('   ')
        await input.trigger('blur')

        expect(w.emitted('save')).toBeUndefined()
    })
})

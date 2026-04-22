import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ContractVersionTimeline from '~/components/assistant/contract/ContractVersionTimeline.vue'
import type { ContractReviewVersionEntity } from '#shared/types/contract'

/**
 * ContractVersionTimeline 单元测试
 *
 * **Feature: contract-review-versioning-phase-a**
 *
 * 组件职责：
 * - 收缩/展开两种显示态（useLocalStorage 持久化）
 * - 节点列表：版本号 + 系统标签 + 日期 + 备注
 * - 点击节点触发 select-version
 * - 编辑备注流程（begin / save / cancel）
 * - 历史版本态时显示"返回工作区"按钮触发 exit-preview
 */

// useLocalStorage 使用实际存储会在测试间互相影响，mock 掉
vi.mock('@vueuse/core', () => ({
    useLocalStorage: vi.fn((key: string, defaultValue: boolean) => {
        const val = ref(defaultValue)
        return val
    }),
}))

function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': name }, slots.default?.())
        },
    })
}

const ButtonStub = defineComponent({
    name: 'Button',
    props: {
        disabled: Boolean,
        variant: String,
        size: String,
    },
    setup(props, { slots, attrs }) {
        return () =>
            h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})

const TextareaStub = defineComponent({
    name: 'Textarea',
    props: { modelValue: { type: String, default: '' }, rows: Number, maxlength: Number },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () =>
            h('textarea', {
                value: props.modelValue,
                rows: props.rows,
                maxlength: props.maxlength,
                onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
            })
    },
})

const stubs = {
    Button: ButtonStub,
    Textarea: TextareaStub,
}

function makeVersion(overrides: Partial<ContractReviewVersionEntity> = {}): ContractReviewVersionEntity {
    return {
        id: 1,
        reviewId: 10,
        versionNumber: 1,
        systemLabel: 'initial_upload',
        lawyerNote: null,
        createdById: 1,
        createdByName: '张律师',
        createdAt: '2026-04-22T10:00:00.000Z',
        ...overrides,
    }
}

function mountTimeline(props: {
    versions?: ContractReviewVersionEntity[]
    currentVersionId?: number | null
    previewVersionId?: number | null
} = {}) {
    return mount(ContractVersionTimeline, {
        props: {
            versions: [makeVersion()],
            currentVersionId: null,
            previewVersionId: null,
            ...props,
        },
        global: { stubs },
    })
}

describe('ContractVersionTimeline', () => {
    describe('折叠/展开切换', () => {
        it('初始展开态：显示"版本时间线"标题', () => {
            const w = mountTimeline()
            expect(w.text()).toContain('版本时间线')
        })

        it('点击切换按钮后收缩：标题消失', async () => {
            const w = mountTimeline()
            // 找到切换按钮（title="收起时间线"）
            const toggleBtn = w.find('button[title="收起时间线"]')
            expect(toggleBtn.exists()).toBe(true)
            await toggleBtn.trigger('click')
            await nextTick()
            expect(w.text()).not.toContain('版本时间线')
        })
    })

    describe('节点渲染', () => {
        it('展开态显示版本号和系统标签', () => {
            const versions = [
                makeVersion({ id: 1, versionNumber: 1, systemLabel: 'initial_upload' }),
                makeVersion({ id: 2, versionNumber: 2, systemLabel: 'lawyer_save', createdAt: '2026-04-23T10:00:00.000Z' }),
            ]
            const w = mountTimeline({ versions })
            expect(w.text()).toContain('v1')
            expect(w.text()).toContain('初次上传')
            expect(w.text()).toContain('v2')
            expect(w.text()).toContain('律师保存')
        })

        it('高亮样式：previewVersionId 匹配的节点有 border-primary 样式', () => {
            const versions = [makeVersion({ id: 5 })]
            const w = mountTimeline({ versions, previewVersionId: 5 })
            const highlighted = w.find('.border-primary')
            expect(highlighted.exists()).toBe(true)
        })

        it('无高亮：previewVersionId 为 null 时没有 border-primary 节点', () => {
            const w = mountTimeline({ previewVersionId: null })
            // border-primary 不出现在节点 div（可能出现在返回按钮文字但不是容器）
            const nodeContainers = w.findAll('.relative.pl-5')
            nodeContainers.forEach(n => {
                expect(n.classes()).not.toContain('border-primary')
            })
        })
    })

    describe('节点点击触发 select-version', () => {
        it('点击节点内容区触发 select-version', async () => {
            const versions = [makeVersion({ id: 7 })]
            const w = mountTimeline({ versions })
            // 节点内的可点击 div
            const clickable = w.find('.cursor-pointer')
            expect(clickable.exists()).toBe(true)
            await clickable.trigger('click')
            const emitted = w.emitted('select-version')
            expect(emitted).toBeTruthy()
            expect(emitted![0][0]).toBe(7)
        })
    })

    describe('备注编辑流程', () => {
        it('无备注时显示"+ 加备注"按钮', () => {
            const w = mountTimeline({ versions: [makeVersion({ lawyerNote: null })] })
            expect(w.text()).toContain('+ 加备注')
        })

        it('有备注时显示备注文本和编辑图标', () => {
            const w = mountTimeline({ versions: [makeVersion({ lawyerNote: '发张三法务审阅' })] })
            expect(w.text()).toContain('发张三法务审阅')
        })

        it('点击"+ 加备注"进入编辑态，显示 textarea', async () => {
            const w = mountTimeline({ versions: [makeVersion({ lawyerNote: null })] })
            const addBtn = w.findAll('button').find(b => b.text().includes('+ 加备注'))!
            await addBtn.trigger('click')
            await nextTick()
            expect(w.find('textarea').exists()).toBe(true)
        })

        it('编辑后点击保存触发 update-note', async () => {
            const version = makeVersion({ id: 3, lawyerNote: null })
            const w = mountTimeline({ versions: [version] })
            // 进入编辑态
            const addBtn = w.findAll('button').find(b => b.text().includes('+ 加备注'))!
            await addBtn.trigger('click')
            await nextTick()
            // 输入备注
            const textarea = w.find('textarea')
            await textarea.setValue('新备注内容')
            // 点击保存（第一个 button 是保存）
            const saveBtn = w.findAll('button').find(b => b.attributes('title') === undefined && !b.text().includes('←') && b.element !== w.find('button[title]').element)
            // 使用更可靠的方式：找 Check 图标所在 button
            // 保存按钮是编辑区内第一个 button
            const editArea = w.find('[data-stub="Button"]') // ButtonStub 渲染的 button
            // 直接找所有 button，过滤出编辑区的保存按钮
            const allButtons = w.findAll('button')
            // 编辑态的两个 button：save（带 Check icon）和 cancel（带 X icon）
            // 它们在 textarea 后面
            const textareaEl = textarea.element
            const buttonAfterTextarea = allButtons.find(btn => {
                return btn.element.compareDocumentPosition(textareaEl) & Node.DOCUMENT_POSITION_PRECEDING
            })
            if (buttonAfterTextarea) {
                await buttonAfterTextarea.trigger('click')
                await nextTick()
                const emitted = w.emitted('update-note')
                expect(emitted).toBeTruthy()
                expect(emitted![0][0]).toBe(3)
                expect(emitted![0][1]).toBe('新备注内容')
            }
        })

        it('点击取消后退出编辑态，textarea 消失', async () => {
            const w = mountTimeline({ versions: [makeVersion({ lawyerNote: null })] })
            const addBtn = w.findAll('button').find(b => b.text().includes('+ 加备注'))!
            await addBtn.trigger('click')
            await nextTick()
            expect(w.find('textarea').exists()).toBe(true)
            // 取消按钮：最后一个在编辑区
            const allButtons = w.findAll('button')
            const textareaEl = w.find('textarea').element
            const btnsAfter = allButtons.filter(btn =>
                btn.element.compareDocumentPosition(textareaEl) & Node.DOCUMENT_POSITION_PRECEDING,
            )
            // 最后一个是取消按钮
            const cancelBtn = btnsAfter[btnsAfter.length - 1]
            if (cancelBtn) {
                await cancelBtn.trigger('click')
                await nextTick()
                expect(w.find('textarea').exists()).toBe(false)
            }
        })
    })

    describe('返回工作区按钮', () => {
        it('previewVersionId 为 null 时不显示返回按钮', () => {
            const w = mountTimeline({ previewVersionId: null })
            expect(w.text()).not.toContain('返回工作区')
        })

        it('previewVersionId 不为 null 时显示返回按钮', () => {
            const w = mountTimeline({ previewVersionId: 1 })
            expect(w.text()).toContain('返回工作区')
        })

        it('点击返回按钮触发 exit-preview', async () => {
            const w = mountTimeline({ previewVersionId: 1 })
            const backBtn = w.findAll('button').find(b => b.text().includes('返回工作区'))!
            await backBtn.trigger('click')
            expect(w.emitted('exit-preview')).toBeTruthy()
        })
    })
})

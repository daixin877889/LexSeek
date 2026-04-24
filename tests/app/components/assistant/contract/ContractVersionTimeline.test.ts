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
 * - 点击非当前版本节点触发 select-version（进入只读预览）
 * - 点击 currentVersionId 节点触发 exit-preview（回到工作区）
 * - 编辑备注流程（begin / save / cancel）
 * - selectedId 的派生规则：previewVersionId ?? currentVersionId
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

        it('默认高亮 currentVersionId：previewVersionId=null 时 currentVersionId 对应节点带 border-primary', () => {
            const versions = [makeVersion({ id: 9 })]
            const w = mountTimeline({ versions, currentVersionId: 9, previewVersionId: null })
            const highlighted = w.find('.border-primary')
            expect(highlighted.exists()).toBe(true)
        })

        it('previewVersionId 非空时按 preview 值高亮（覆盖 currentVersionId）', () => {
            const versions = [
                makeVersion({ id: 9, versionNumber: 2 }),
                makeVersion({ id: 10, versionNumber: 1 }),
            ]
            const w = mountTimeline({ versions, currentVersionId: 9, previewVersionId: 10 })
            // 预览态节点应含 border-primary，workspace 节点不应含
            const nodeContainers = w.findAll('.relative.pl-5')
            expect(nodeContainers.length).toBe(2)
            // 第一个是 id=9，第二个是 id=10；previewVersionId=10 ⇒ 第二个高亮
            expect(nodeContainers[0]!.classes()).not.toContain('border-primary')
            expect(nodeContainers[1]!.classes()).toContain('border-primary')
        })
    })

    describe('节点点击分流：select-version / exit-preview', () => {
        it('点击非 currentVersion 节点触发 select-version', async () => {
            const versions = [
                makeVersion({ id: 7, versionNumber: 1 }),
                makeVersion({ id: 8, versionNumber: 2 }),
            ]
            const w = mountTimeline({ versions, currentVersionId: 8, previewVersionId: null })
            // 点击第一个节点（v1，非当前版本）
            const clickable = w.findAll('.cursor-pointer')[0]!
            await clickable.trigger('click')
            const selectEmitted = w.emitted('select-version')
            expect(selectEmitted).toBeTruthy()
            expect(selectEmitted![0][0]).toBe(7)
            expect(w.emitted('exit-preview')).toBeFalsy()
        })

        it('点击 currentVersionId 节点触发 exit-preview（回到工作区）', async () => {
            const versions = [
                makeVersion({ id: 7, versionNumber: 1 }),
                makeVersion({ id: 8, versionNumber: 2 }),
            ]
            const w = mountTimeline({ versions, currentVersionId: 8, previewVersionId: 7 })
            // 点击 v2（id=8，= currentVersionId）
            const clickable = w.findAll('.cursor-pointer')[1]!
            await clickable.trigger('click')
            expect(w.emitted('exit-preview')).toBeTruthy()
            expect(w.emitted('select-version')).toBeFalsy()
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
            // 点击保存按钮（通过 data-testid 精准定位）
            const saveBtn = w.find('[data-testid="save-note"]')
            expect(saveBtn.exists()).toBe(true)
            await saveBtn.trigger('click')
            await nextTick()
            const emitted = w.emitted('update-note')
            expect(emitted).toBeTruthy()
            expect(emitted![0][0]).toBe(3)
            expect(emitted![0][1]).toBe('新备注内容')
        })

        it('点击取消后退出编辑态，textarea 消失', async () => {
            const w = mountTimeline({ versions: [makeVersion({ lawyerNote: null })] })
            const addBtn = w.findAll('button').find(b => b.text().includes('+ 加备注'))!
            await addBtn.trigger('click')
            await nextTick()
            expect(w.find('textarea').exists()).toBe(true)
            // 通过 data-testid 精准定位取消按钮
            const cancelBtn = w.find('[data-testid="cancel-note"]')
            expect(cancelBtn.exists()).toBe(true)
            await cancelBtn.trigger('click')
            await nextTick()
            expect(w.find('textarea').exists()).toBe(false)
        })
    })

    describe('不再显示"返回工作区"独立按钮（由点击 currentVersion 节点承担）', () => {
        it('无论是否预览态，都不再渲染"返回工作区"文案', () => {
            const wIdle = mountTimeline({ previewVersionId: null })
            expect(wIdle.text()).not.toContain('返回工作区')
            const wPreview = mountTimeline({ previewVersionId: 1 })
            expect(wPreview.text()).not.toContain('返回工作区')
        })
    })
})

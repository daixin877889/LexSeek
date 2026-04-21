import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewProgress from '~/components/assistant/contract/ReviewProgress.vue'

const defaultStages = {
    detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait',
} as const

describe('ReviewProgress', () => {
    it('5 个阶段都 wait 时渲染 5 个灰点', () => {
        const w = mount(ReviewProgress, {
            props: { stages: defaultStages, totalClauses: null, analyzingIndex: null },
        })
        expect(w.findAll('[data-stage-dot]')).toHaveLength(5)
        expect(w.findAll('[data-stage-status="wait"]')).toHaveLength(5)
    })

    it('detect=running 显示呼吸动画', () => {
        const w = mount(ReviewProgress, {
            props: { stages: { ...defaultStages, detect: 'running' }, totalClauses: null, analyzingIndex: null },
        })
        expect(w.find('[data-stage="detect"][data-stage-status="running"]').exists()).toBe(true)
    })

    it('analyze=running 且 totalClauses=24 显示 "正在分析第 X / 24 条"', () => {
        const w = mount(ReviewProgress, {
            props: {
                stages: { ...defaultStages, detect: 'done', stance: 'done', segment: 'done', analyze: 'running' },
                totalClauses: 24,
                analyzingIndex: 14,
            },
        })
        expect(w.text()).toContain('正在分析第 14 / 24 条')
    })

    it('summarize=done 时整个组件返回 null（自动收起）', () => {
        const w = mount(ReviewProgress, {
            props: {
                stages: { detect: 'done', stance: 'done', segment: 'done', analyze: 'done', summarize: 'done' },
                totalClauses: 24, analyzingIndex: 24,
            },
        })
        expect(w.find('[data-stage-dot]').exists()).toBe(false)
    })
})

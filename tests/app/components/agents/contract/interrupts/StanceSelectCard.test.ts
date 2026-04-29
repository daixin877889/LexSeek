/**
 * StanceSelectCard interrupt 卡片测试（Mockup B）
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import StanceSelectCard from '~/components/agents/contract/interrupts/StanceSelectCard.vue'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const stubs = {
  global: {
    stubs: {
      Button: {
        template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        props: ['disabled', 'size', 'variant'],
      },
      Input: {
        template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :disabled="disabled" />',
        props: ['modelValue', 'disabled', 'placeholder'],
      },
      Label: { template: '<label><slot /></label>' },
      RadioGroup: {
        template: '<div data-stub="radio-group"><slot /></div>',
        props: ['modelValue', 'disabled'],
      },
      RadioGroupItem: {
        template: '<input type="radio" :value="value" />',
        props: ['value'],
      },
      Pause: true,
      Loader2: true,
      CheckCircle2: true,
      X: true,
    },
  },
}

describe('StanceSelectCard', () => {
  it('使用 hint 作为甲乙方默认值', () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const w = mount(StanceSelectCard, {
      props: {
        interrupt: {
          type: 'stance_select',
          partyAHint: '阿里云', partyBHint: '我方', fileName: 'c.docx',
        },
        onResolve,
      },
      ...stubs,
    })
    const textInputs = w.findAll('input').filter(i => i.attributes('type') !== 'radio')
    expect(textInputs[0]?.element.value).toBe('阿里云')
    expect(textInputs[1]?.element.value).toBe('我方')
  })

  it('点击「开始审查」调用 onResolve 携带选择值', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const w = mount(StanceSelectCard, {
      props: {
        interrupt: {
          type: 'stance_select',
          partyAHint: 'A方', partyBHint: 'B方', fileName: 'x.docx',
        },
        onResolve,
      },
      ...stubs,
    })
    const submitBtn = w.findAll('button').find(b => b.text().includes('开始审查'))
    await submitBtn.trigger('click')
    await flushPromises()
    expect(onResolve).toHaveBeenCalledWith({
      stance: 'partyB',
      partyA: 'A方',
      partyB: 'B方',
    })
  })

  it('点击「取消」调用 onResolve(null)', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const w = mount(StanceSelectCard, {
      props: {
        interrupt: {
          type: 'stance_select',
          fileName: 'x.docx',
        },
        onResolve,
      },
      ...stubs,
    })
    const cancelBtn = w.findAll('button').find(b => b.text().includes('取消'))
    await cancelBtn.trigger('click')
    await flushPromises()
    expect(onResolve).toHaveBeenCalledWith(null)
  })

  it('确认后按钮消失，显示已确认提示', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const w = mount(StanceSelectCard, {
      props: {
        interrupt: { type: 'stance_select', fileName: 'x.docx' },
        onResolve,
      },
      ...stubs,
    })
    const submitBtn = w.findAll('button').find(b => b.text().includes('开始审查'))
    await submitBtn.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('已确认，开始审查')
  })
})

describe('StanceSelectCard - snapshot 模式', () => {
    it('resumeValue 非 undefined 时按钮 disabled，显示已选立场', async () => {
        const wrapper = mount(StanceSelectCard, {
            props: {
                interrupt: {
                    type: 'stance_select',
                    toolCallId: 'call_001',
                    fileName: '合同.docx',
                },
                onResolve: vi.fn(),
                resumeValue: { stance: 'partyA', partyA: '甲公司', partyB: '乙公司' },
            },
            ...stubs,
        })
        expect(wrapper.text()).toContain('甲方')
        expect(wrapper.findAll('button').filter(b => b.text() === '使用此立场').length).toBe(0)
    })

    it('resumeValue=null 时显示已取消', async () => {
        const wrapper = mount(StanceSelectCard, {
            props: {
                interrupt: {
                    type: 'stance_select',
                    toolCallId: 'call_002',
                    fileName: '合同.docx',
                },
                onResolve: vi.fn(),
                resumeValue: null,
            },
            ...stubs,
        })
        expect(wrapper.text()).toContain('已取消')
    })

    it('snapshot 模式下根 div 有 opacity-70 class', async () => {
        const wrapper = mount(StanceSelectCard, {
            props: {
                interrupt: {
                    type: 'stance_select',
                    toolCallId: 'call_003',
                    fileName: '合同.docx',
                },
                onResolve: vi.fn(),
                resumeValue: { stance: 'partyB' },
            },
            ...stubs,
        })
        expect(wrapper.find('.opacity-70').exists()).toBe(true)
    })
})

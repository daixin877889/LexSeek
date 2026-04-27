/**
 * TemplateSelectCard interrupt 卡片测试（Mockup A / A2）
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import TemplateSelectCard from '~/components/agents/document/interrupts/TemplateSelectCard.vue'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// mock useApiFetch
const useApiFetchMock = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => useApiFetchMock(...args),
}))

const stubs = {
  global: {
    stubs: {
      Button: {
        template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        props: ['disabled', 'size', 'variant'],
      },
      Input: {
        template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        props: ['modelValue', 'disabled', 'placeholder'],
      },
      DropdownMenu: { template: '<div><slot /></div>' },
      DropdownMenuTrigger: { template: '<div><slot /></div>' },
      DropdownMenuContent: { template: '<div><slot /></div>' },
      DropdownMenuItem: {
        template: '<div data-testid="dd-item" @click="$emit(\'click\')"><slot /></div>',
      },
      Pause: true,
      Search: true,
      Check: true,
      ChevronDown: true,
      ChevronUp: true,
      Loader2: true,
      CheckCircle2: true,
      X: true,
      FileText: true,
    },
  },
}

const RECS = [
  { id: 1, name: '解除劳动合同通知书', description: '通用版' },
  { id: 2, name: '解除合同协议（通用）', description: null },
  { id: 3, name: '终止合作关系函', description: null },
]

describe('TemplateSelectCard', () => {
  it('默认显示 3 个推荐 + 第一个预选', () => {
    const w = mount(TemplateSelectCard, {
      props: {
        interrupt: {
          type: 'template_select',
          payload: { recommendations: RECS, total: 247, intent: '解除劳动合同通知' },
        },
        onResolve: vi.fn(),
      },
      ...stubs,
    })
    expect(w.text()).toContain('解除劳动合同通知书')
    expect(w.text()).toContain('解除合同协议（通用）')
    expect(w.text()).toContain('终止合作关系函')
    expect(w.text()).toContain('已选：解除劳动合同通知书')
    // "浏览全部 N 个模板"
    expect(w.text()).toContain('浏览全部 247')
  })

  it('点击「使用此模板」调用 onResolve({ templateId })', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const w = mount(TemplateSelectCard, {
      props: {
        interrupt: { type: 'template_select', payload: { recommendations: RECS, total: 100 } },
        onResolve,
      },
      ...stubs,
    })
    const submitBtn = w.findAll('button').find((b) => b.text().includes('使用此模板'))
    await submitBtn!.trigger('click')
    await flushPromises()
    expect(onResolve).toHaveBeenCalledWith({ templateId: 1 })
  })

  it('切换选中：点击第二个推荐项', async () => {
    const w = mount(TemplateSelectCard, {
      props: {
        interrupt: { type: 'template_select', payload: { recommendations: RECS, total: 100 } },
        onResolve: vi.fn(),
      },
      ...stubs,
    })
    // 找到列表中所有 button（前 3 个是推荐项 button）
    const recoButtons = w.findAll('button').filter((b) => b.text().includes('解除合同协议'))
    await recoButtons[0]!.trigger('click')
    expect(w.text()).toContain('已选：解除合同协议（通用）')
  })

  it('点击「取消」调 onResolve(null)', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const w = mount(TemplateSelectCard, {
      props: {
        interrupt: { type: 'template_select', payload: { recommendations: RECS, total: 100 } },
        onResolve,
      },
      ...stubs,
    })
    const cancelBtn = w.findAll('button').find((b) => b.text().includes('取消'))
    await cancelBtn!.trigger('click')
    await flushPromises()
    expect(onResolve).toHaveBeenCalledWith(null)
  })

  it('零召回：自动进入展开状态并请求模板列表', async () => {
    useApiFetchMock.mockResolvedValueOnce({
      list: [
        { id: 100, name: '民事起诉状', description: '公民提起民事诉讼用', category: 'litigation', scope: 'global' },
      ],
      total: 1,
      skip: 0,
      take: 20,
    })
    const w = mount(TemplateSelectCard, {
      props: {
        interrupt: { type: 'template_select', payload: { recommendations: [], total: 200 } },
        onResolve: vi.fn(),
      },
      ...stubs,
    })
    await flushPromises()
    expect(useApiFetchMock).toHaveBeenCalledWith(
      '/api/v1/assistant/document/templates',
      expect.objectContaining({ query: expect.any(Object) }),
    )
    expect(w.text()).toContain('民事起诉状')
  })

  it('「浏览全部」按钮触发展开 + 拉取列表', async () => {
    useApiFetchMock.mockResolvedValue({ list: [], total: 0, skip: 0, take: 20 })
    const w = mount(TemplateSelectCard, {
      props: {
        interrupt: { type: 'template_select', payload: { recommendations: RECS, total: 247 } },
        onResolve: vi.fn(),
      },
      ...stubs,
    })
    const browseBtn = w.findAll('button').find((b) => b.text().includes('浏览全部'))
    expect(browseBtn).toBeTruthy()
    await browseBtn!.trigger('click')
    await flushPromises()
    expect(useApiFetchMock).toHaveBeenCalled()
  })
})

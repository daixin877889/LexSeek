/**
 * DraftDocumentCard 工具结果卡片测试
 *
 * Mockup D：执行中 / 已完成 / 失败 三态展示。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount } from '@vue/test-utils'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

import DraftDocumentCard from '~/components/agents/document/tools/DraftDocumentCard.vue'

const stubs = {
  global: {
    stubs: {
      Button: {
        template: '<button data-stub="btn" @click="$emit(\'click\')"><slot /></button>',
      },
      Loader2: true,
      CheckCircle2: true,
      XCircle: true,
      FileEdit: true,
      FileText: true,
    },
  },
}

beforeEach(() => {
  navigateToMock.mockClear()
})

describe('DraftDocumentCard', () => {
  it('input-streaming 状态显示 spinner + 起草中文案', () => {
    const w = mount(DraftDocumentCard, {
      props: {
        toolName: 'draft_document',
        input: { intent: '解除劳动合同通知' },
        output: null,
        state: 'input-streaming',
      },
      ...stubs,
    })
    expect(w.text()).toContain('正在起草《解除劳动合同通知》')
  })

  it('output-available + success 显示标题 + 字数 + 跳转按钮', () => {
    const w = mount(DraftDocumentCard, {
      props: {
        toolName: 'draft_document',
        input: {},
        output: {
          success: true,
          draftId: 1,
          title: '民事起诉状',
          summary: '原告张三诉被告李四',
          wordCount: 1280,
          href: '/dashboard/document/drafts/1',
        },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已完成起草《民事起诉状》')
    expect(w.text()).toContain('字数 1,280')
    expect(w.text()).toContain('原告张三诉被告李四')
    expect(w.text()).toContain('在文书页继续编辑')
  })

  it('点击跳转按钮调 navigateTo(output.href)', async () => {
    const w = mount(DraftDocumentCard, {
      props: {
        toolName: 'draft_document',
        input: {},
        output: { success: true, title: 'X', href: '/abc' },
        state: 'output-available',
      },
      ...stubs,
    })
    const btn = w.find('[data-stub="btn"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(navigateToMock).toHaveBeenCalledWith('/abc')
  })

  it('output.success === false 走失败态', () => {
    const w = mount(DraftDocumentCard, {
      props: {
        toolName: 'draft_document',
        input: {},
        output: { success: false, error: '生成超时' },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('起草失败')
    expect(w.text()).toContain('生成超时')
  })

  it('支持 output 是 JSON 字符串', () => {
    const w = mount(DraftDocumentCard, {
      props: {
        toolName: 'draft_document',
        input: {},
        output: JSON.stringify({ success: true, title: '甲方协议', href: '/x' }),
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已完成起草《甲方协议》')
  })
})

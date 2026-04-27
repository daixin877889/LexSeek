/**
 * ReviewContractCard 工具结果卡片测试（Mockup C）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mount } from '@vue/test-utils'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

import ReviewContractCard from '~/components/agents/contract/tools/ReviewContractCard.vue'

const stubs = {
  global: {
    stubs: {
      Button: {
        template: '<button data-stub="btn" @click="$emit(\'click\')"><slot /></button>',
      },
      Loader2: true,
      CheckCircle2: true,
      XCircle: true,
      FileSearch: true,
      ExternalLink: true,
      AlertTriangle: true,
    },
  },
}

beforeEach(() => {
  navigateToMock.mockClear()
})

describe('ReviewContractCard', () => {
  it('input-streaming 显示 spinner + 分析中文案', () => {
    const w = mount(ReviewContractCard, {
      props: {
        toolName: 'review_contract',
        input: { fileName: 'contract.docx' },
        output: null,
        state: 'input-streaming',
      },
      ...stubs,
    })
    expect(w.text()).toContain('正在分析合同')
  })

  it('已完成态展示甲乙方 + 风险统计 + Top 3', () => {
    const w = mount(ReviewContractCard, {
      props: {
        toolName: 'review_contract',
        input: {},
        output: {
          success: true,
          fileName: 'contract.docx',
          partyA: '阿里云',
          partyB: '我方',
          riskStats: { high: 2, medium: 3, low: 1 },
          topRisks: [
            { title: '终止条款', level: 'high' },
            { title: '责任分配', level: 'high' },
            { title: '违约金', level: 'medium' },
          ],
          href: '/dashboard/assistant/contract/1',
        },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已完成审查 contract.docx')
    expect(w.text()).toContain('甲方：阿里云')
    expect(w.text()).toContain('乙方：我方')
    expect(w.text()).toContain('高 2')
    expect(w.text()).toContain('中 3')
    expect(w.text()).toContain('低 1')
    expect(w.text()).toContain('终止条款')
    expect(w.text()).toContain('责任分配')
    expect(w.text()).toContain('违约金')
    expect(w.text()).toContain('打开合同审查工作台')
  })

  it('点击跳转按钮调 navigateTo(output.href)', async () => {
    const w = mount(ReviewContractCard, {
      props: {
        toolName: 'review_contract',
        input: {},
        output: { success: true, href: '/dashboard/x', fileName: 'a.docx' },
        state: 'output-available',
      },
      ...stubs,
    })
    await w.find('[data-stub="btn"]').trigger('click')
    expect(navigateToMock).toHaveBeenCalledWith('/dashboard/x')
  })

  it('output.success=false 走失败态', () => {
    const w = mount(ReviewContractCard, {
      props: {
        toolName: 'review_contract',
        input: {},
        output: { success: false, error: 'OCR 失败' },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('审查失败')
    expect(w.text()).toContain('OCR 失败')
  })

  it('topRisks 截断到 3 条', () => {
    const w = mount(ReviewContractCard, {
      props: {
        toolName: 'review_contract',
        input: {},
        output: {
          success: true,
          fileName: 'c.docx',
          topRisks: [
            { title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' },
          ],
          href: '/x',
        },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('A')
    expect(w.text()).toContain('B')
    expect(w.text()).toContain('C')
    expect(w.text()).not.toContain('D')
  })
})

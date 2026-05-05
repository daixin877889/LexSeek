/**
 * RecommendTemplateCard 工具结果卡片测试
 *
 * 历史会话回放兜底:resolvedInterrupts 仅内存,刷新清空,所以
 * recommend_template 必须有结果卡才能让用户回看时看到"已选 XX 模板"。
 *
 * 状态:执行中 / 已完成 / 已取消 / 失败 / 兜底。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import RecommendTemplateCard from '~/components/agents/document/tools/RecommendTemplateCard.vue'

const stubs = {
  global: {
    stubs: {
      Loader2: true,
      CheckCircle2: true,
      XCircle: true,
      FileSearch: true,
    },
  },
}

describe('RecommendTemplateCard', () => {
  it('input-streaming 状态显示 spinner + 推荐中文案', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: { intent: '起诉拖欠工资' },
        output: null,
        state: 'input-streaming',
      },
      ...stubs,
    })
    expect(w.text()).toContain('正在为《起诉拖欠工资》匹配模板')
  })

  it('input-streaming 无 intent 时显示通用推荐文案', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: null,
        state: 'input-streaming',
      },
      ...stubs,
    })
    expect(w.text()).toContain('正在为你推荐模板')
  })

  it('output-available + success 显示模板名 + 类别 + 字段数', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: {
          success: true,
          templateId: 7,
          templateName: '民事起诉状',
          templateCategory: '诉讼',
          placeholders: [
            { name: 'plaintiff' },
            { name: 'defendant' },
            { name: 'claim' },
          ],
        },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已选择模板《民事起诉状》')
    expect(w.text()).toContain('类别：诉讼')
    expect(w.text()).toContain('3 个字段待填')
  })

  it('output.cancelled === true 显示已取消态', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: { success: false, cancelled: true, message: '用户已取消模板选择' },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已取消模板选择')
    expect(w.text()).not.toContain('推荐失败')
  })

  it('output.success === false 且非 cancelled 走失败态', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: { success: false, error: '模板 #99 不存在或已删除' },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('推荐失败')
    expect(w.text()).toContain('模板 #99 不存在或已删除')
  })

  it('output-error 状态走失败态', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: null,
        state: 'output-error',
      },
      ...stubs,
    })
    expect(w.text()).toContain('推荐失败')
  })

  it('支持 output 是 JSON 字符串', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: JSON.stringify({
          success: true,
          templateName: '答辩状',
          placeholders: [{ name: 'a' }],
        }),
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已选择模板《答辩状》')
    expect(w.text()).toContain('1 个字段待填')
  })

  it('JSON 字符串解析失败走失败兜底', () => {
    const w = mount(RecommendTemplateCard, {
      props: {
        toolName: 'recommend_template',
        input: {},
        output: 'not json',
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('推荐失败')
  })
})

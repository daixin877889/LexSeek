/**
 * UpdateDocumentDraftCard 工具结果卡片测试
 *
 * 历史会话回放兜底,与 RecommendTemplateCard / DraftDocumentCard 同理。
 * 状态:执行中 / 已完成 / 失败 / 兜底。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import UpdateDocumentDraftCard from '~/components/agents/document/tools/UpdateDocumentDraftCard.vue'

const stubs = {
  global: {
    stubs: {
      Loader2: true,
      CheckCircle2: true,
      XCircle: true,
      FilePenLine: true,
    },
  },
}

describe('UpdateDocumentDraftCard', () => {
  it('input-streaming 状态显示 spinner + 更新中文案', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: { draftId: 7 },
        output: null,
        state: 'input-streaming',
      },
      ...stubs,
    })
    expect(w.text()).toContain('正在更新文书字段')
  })

  it('output-available + success 显示更新字段数 + 字段名列表', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: {},
        output: {
          success: true,
          draftId: 7,
          changedFields: ['plaintiff', 'defendant', 'claim'],
          summary: '已更新 3 个字段:plaintiff、defendant、claim',
        },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已更新 3 个字段')
    expect(w.text()).toContain('plaintiff、defendant、claim')
  })

  it('changedFields 为空时显示"未发现需要更新的字段"', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: {},
        output: { success: true, draftId: 7, changedFields: [], summary: '已更新 0 个字段:' },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('未发现需要更新的字段')
  })

  it('output.success === false 走失败态', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: {},
        output: { success: false, error: '草稿不存在' },
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('更新失败')
    expect(w.text()).toContain('草稿不存在')
  })

  it('output-error 状态走失败态', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: {},
        output: null,
        state: 'output-error',
      },
      ...stubs,
    })
    expect(w.text()).toContain('更新失败')
  })

  it('支持 output 是 JSON 字符串', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: {},
        output: JSON.stringify({
          success: true,
          changedFields: ['address'],
          summary: '已更新 1 个字段:address',
        }),
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('已更新 1 个字段')
    expect(w.text()).toContain('address')
  })

  it('JSON 字符串解析失败走失败兜底', () => {
    const w = mount(UpdateDocumentDraftCard, {
      props: {
        toolName: 'update_document_draft',
        input: {},
        output: 'not json',
        state: 'output-available',
      },
      ...stubs,
    })
    expect(w.text()).toContain('更新失败')
  })
})

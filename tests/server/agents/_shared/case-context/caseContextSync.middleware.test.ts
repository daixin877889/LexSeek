import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'

vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
  buildContextSegments: vi.fn(),
}))
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

const mockSegments = (overrides: Record<string, string> = {}) => ({
  roleAndFlow: '',
  caseProfile: '## 案件档案\n```json\n{}\n```',
  moduleSummaries: '## 已完成分析模块',
  dynamicContext: '## 案件材料清单',
  ...overrides,
})

const runHook = async (mw: any, state: { messages: any[] }) => {
  const ret = await mw.beforeAgent.hook(state)
  return { state, ret }
}

beforeEach(() => {
  vi.mocked(buildContextSegments).mockResolvedValue(mockSegments())
})

describe('caseContextSyncMiddleware', () => {
  it('caseId 非空 + draftLoader=null：仅注入案件 4 段；context 在 user message 之前；hook 返回 truthy 触发 merge 路径', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const userMsg = new HumanMessage('帮我看下案件')
    const state = { messages: [userMsg] }
    const { ret } = await runHook(mw, state)

    expect(state.messages.length).toBe(2)
    expect(state.messages[0].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).toContain('案件材料清单')
    expect(state.messages[0].content).not.toContain('当前已填字段')
    expect(state.messages[1]).toBe(userMsg)         // user 仍在末尾
    expect(ret).toEqual({})                          // 显式 return {} 触发 LangGraph state merge 路径
  })

  it('caseId=null + draftLoader 非空：仅注入文书段', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: null,
      agentName: 'documentMain',
      draftLoader: async () => ({
        placeholdersWithHints: '- 原告姓名',
        draftValuesJSON: async () => '{"原告":"张三"}',
      }),
    })
    const state = { messages: [new HumanMessage('填一下')] }
    await runHook(mw, state)

    expect(state.messages[0].content).toContain('当前已填字段')
    expect(state.messages[0].content).toContain('张三')
    expect(state.messages[0].content).toContain('模板待填占位符')
  })

  it('caseId 非空 + draftLoader 非空：注入 4+2 段', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => ({
        placeholdersWithHints: '- 原告姓名',
        draftValuesJSON: async () => '{"原告":"张三"}',
      }),
    })
    const state = { messages: [new HumanMessage('继续')] }
    await runHook(mw, state)

    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).toContain('当前已填字段')
    expect(state.messages[0].content).toContain('张三')
  })

  it('draftLoader() 整体抛错：仅丢失文书段，4 段照常注入', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => { throw new Error('db down') },
    })
    const state = { messages: [new HumanMessage('xxx')] }
    await runHook(mw, state)

    expect(state.messages.length).toBe(2)
    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).not.toContain('当前已填字段')
  })

  it('draftValuesJSON() 抛错：placeholders 仍展示，currentValues 置空（spec §5.2 容错粒度）', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => ({
        placeholdersWithHints: '- 原告姓名',
        draftValuesJSON: async () => { throw new Error('values query failed') },
      }),
    })
    const state = { messages: [new HumanMessage('xxx')] }
    await runHook(mw, state)

    expect(state.messages[0].content).toContain('模板待填占位符')
    expect(state.messages[0].content).toContain('原告姓名')
    // valuesJSON 置空字符串占位，不影响 placeholders 展示
    expect(state.messages[0].content).toContain('当前已填字段')
  })

  it('buildContextSegments 抛错：messages 不变，不阻塞 Agent', async () => {
    vi.mocked(buildContextSegments).mockRejectedValueOnce(new Error('db down'))
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const userMsg = new HumanMessage('q')
    const state = { messages: [userMsg] }
    await runHook(mw, state)

    expect(state.messages.length).toBe(1)
    expect(state.messages[0]).toBe(userMsg)
  })

  it('多轮调用：每轮新增一条注入消息（不复用历史）', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const state = { messages: [new HumanMessage('q1')] }

    await runHook(mw, state)
    expect(state.messages.length).toBe(2)

    state.messages.push({ _getType: () => 'ai', content: 'a1' } as any)
    state.messages.push(new HumanMessage('q2'))
    await runHook(mw, state)

    expect(state.messages.length).toBe(5)
    expect(state.messages[3].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    expect(state.messages[4].content).toBe('q2')
  })

  it('双轨写 metadata：response_metadata + additional_kwargs 都含 injectedBy', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const state = { messages: [new HumanMessage('q')] }
    await runHook(mw, state)

    const ctx = state.messages[0]
    expect(ctx.response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    expect(ctx.additional_kwargs?.injectedBy).toBe('CaseContextSyncMiddleware')
  })

  it('agentName 透传给 buildContextSegments', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseAnalysisSummary' })
    await runHook(mw, { messages: [new HumanMessage('q')] })

    expect(buildContextSegments).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 1, agentName: 'caseAnalysisSummary' }),
    )
  })

  it('caseId=null + 无 draftLoader：lines 为空，提前 return 不插消息', async () => {
    const mw = caseContextSyncMiddleware({ caseId: null, agentName: 'documentMain' })
    const userMsg = new HumanMessage('q')
    const state = { messages: [userMsg] }
    const { ret } = await runHook(mw, state)

    expect(state.messages.length).toBe(1)
    expect(state.messages[0]).toBe(userMsg)
    expect(ret).toEqual({})
  })

  it('messages 中无 HumanMessage：insertIdx 退化为 messages.length（追加到末尾）', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const aiMsg = { _getType: () => 'ai', content: 'a1' } as any
    const state = { messages: [aiMsg] }
    await runHook(mw, state)

    expect(state.messages.length).toBe(2)
    expect(state.messages[0]).toBe(aiMsg)
    expect(state.messages[1].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
  })

  it('segs 各段为空字符串：分别走 falsy 分支不 push', async () => {
    vi.mocked(buildContextSegments).mockResolvedValueOnce(mockSegments({
      caseProfile: '',
      moduleSummaries: '',
      dynamicContext: '',
    }))
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const userMsg = new HumanMessage('q')
    const state = { messages: [userMsg] }
    await runHook(mw, state)

    // 全空 → lines 为空 → 不插消息
    expect(state.messages.length).toBe(1)
    expect(state.messages[0]).toBe(userMsg)
  })

  it('lastHuman.content 非字符串：userQuery 兜底空串', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const userMsg = new HumanMessage({ content: [{ type: 'text', text: 'q' } as any] })
    const state = { messages: [userMsg] }
    await runHook(mw, state)

    // 非字符串 content 时 userQuery 为空串，但 buildContextSegments 仍正常调用
    expect(buildContextSegments).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 1, userQuery: '' }),
    )
    expect(state.messages.length).toBe(2)
  })

  it('draftLoader 返回 null：跳过文书段，案件 4 段照常注入', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => null,
    })
    const state = { messages: [new HumanMessage('q')] }
    await runHook(mw, state)

    expect(state.messages.length).toBe(2)
    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).not.toContain('当前已填字段')
  })
})

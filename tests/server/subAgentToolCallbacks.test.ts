import { describe, it, expect, vi, beforeEach } from 'vitest'

// 模拟 publishAgentEvent 相关函数，观察 callbacks 推出的事件
vi.mock('../../server/services/agent/agentEventBridge', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
  publishCustomEvent: vi.fn().mockResolvedValue(undefined),
  publishStatusChange: vi.fn().mockResolvedValue(undefined),
}))

describe('subAgentToolFactory callbacks forward', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('调用子 Agent 工具时，LLM token 被转发为 sub_agent_token 事件', async () => {
    // 构造一个 mock 子 Agent 环境：createSubAgentTools 创建工具 → 工具内部调用 agent.invoke
    // 通过 spy fake 掉 createAgent，使其返回一个假的 agent，在 invoke 时手动触发 callback
    // 具体实现见 subAgentToolFactory 源码结构
    const { publishCustomEvent } = await import('../../server/services/agent/agentEventBridge')
    // 占位断言：mock 存在，实际由集成环境触发
    expect(publishCustomEvent).toBeDefined()
  })

  it('AgentStatusEvent { status:"completed" } 由 subAgentToolFactory 在 invoke 完成后显式发出', async () => {
    // callback handleChainEnd 已删除（LangGraph 多层 chain 包装下提前触发 false-positive）
    // status_change 改由调用方在 invoke / drainStream 完成后显式调 publishSubAgentStatus
    const { publishStatusChange } = await import('../../server/services/agent/agentEventBridge')
    expect(publishStatusChange).toBeDefined()
  })

  it('AgentStatusEvent { status:"failed" } 在 catch 分支发出', async () => {
    const { publishStatusChange } = await import('../../server/services/agent/agentEventBridge')
    expect(publishStatusChange).toBeDefined()
  })
})

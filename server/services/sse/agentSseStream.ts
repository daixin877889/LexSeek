/**
 * 通用 Agent SSE 流构造器
 *
 * 抽取自 server/api/v1/cases/analysis/chat.post.ts 的内联实现（原 L215-370），
 * 用于服务所有订阅 AgentRun 事件流的 SSE 端点（case chat、assistant chat 等）。
 *
 * 行为：
 * - 已完成 run（latestRunStatus ∈ TERMINAL_STATUSES）：跳过 Redis Stream 重放，
 *   直接从 PostgresSaver 取最终 checkpoint 发送一次 values 事件后关闭。
 * - 活跃 run：先通过 replayEvents 补发 Redis Stream 中缺失的历史事件，
 *   再通过 createEventSubscription 订阅实时事件，直到终结状态后关闭。
 * - 客户端断开：on('close') 触发 AbortController，清理 keepalive 与 controller。
 * - Keepalive：每 15 秒注入 `: keepalive\n\n`，避免 Nginx/CDN/LB 超时切断。
 */

import type { H3Event } from 'h3'
import { setResponseHeaders } from 'h3'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { getActiveRunService } from '~~/server/services/agent/agentRun.service'
import { getThreadValuesService } from '~~/server/services/workflow/agents'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import { isInjectorFromContextMiddleware } from '~~/server/services/agent-platform/context/injectorDetection'

/** 终结状态列表（包括 interrupted，重连时 replay 后需关闭流） */
const TERMINAL_STATUSES: readonly string[] = [
  AGENT_RUN_STATUS.COMPLETED,
  AGENT_RUN_STATUS.FAILED,
  AGENT_RUN_STATUS.CANCELLED,
  AGENT_RUN_STATUS.INTERRUPTED,
]

/** 判断单条消息是否为内部消息（system / 注入上下文），不应发送到前端 */
function isInternalMessage(m: any): boolean {
  // 只过滤 SystemMessage（ToolMessage 必须保留，前端需要它匹配工具调用结果）
  if (m._getType?.() === 'system') return true
  const type = m.type ?? m.data?.type
  if (type === 'system') return true

  const injector = (m.response_metadata?.injectedBy ?? m.data?.response_metadata?.injectedBy) as string | undefined
  return isInjectorFromContextMiddleware(injector)
}

/** 过滤掉上下文注入消息（HumanMessage with metadata.injectedBy） */
function filterInjectedMessages(messages: any[]): any[] {
  return messages.filter(m => !isInternalMessage(m))
}

/**
 * status_change 是否代表父 run 自身终结（用于判断是否关流）。
 * 子 Agent 的 handleChainEnd 也发 terminal status，但带 parentToolCallId，
 * 仅代表"该子 Agent 完成"，父 run 还在继续。
 */
function isParentRunTerminal(evt: { metadata?: { parentToolCallId?: unknown } | null }): boolean {
  return !evt.metadata?.parentToolCallId
}

/** 过滤 messages 事件中的内部消息，返回 null 表示整条事件应跳过 */
function filterMessagesEvent(data: any): any | null {
  if (Array.isArray(data)) {
    const filtered = data.filter((m: any) => !isInternalMessage(m))
    return filtered.length > 0 ? filtered : null
  }
  return isInternalMessage(data) ? null : data
}

/**
 * 仅当 run 处于 INTERRUPTED 时才把 `__interrupt__` 透传给前端——这是合法的
 * "等待用户输入"暂停态，interrupt 卡片需要据此渲染。其它任何状态下：
 *   - PENDING / RUNNING：run 正在执行，不应弹 interrupt UI（用户没在等输入）
 *   - COMPLETED / FAILED / CANCELLED：run 已落幕，残留 interrupt 必然是 stale
 *
 * 已知触发：合同审查 vertical 的 resume 分支（runContractReviewChat）完全绕过
 * LangGraph，`parseAndAskStance` 工具写入的 `__interrupt__` 永远不会被
 * `__resume__` 抵消。无论是审查完成后刷新（status=COMPLETED）还是 stance 提交后
 * resume run B 进行中（status=PENDING/RUNNING），`getThreadValuesService` 都会
 * 从 pendingWrites 抽出陈旧 interrupt；前端不剥离就会反复误开 stance Dialog
 * （刷新场景）或在 resume 流期间 modal 遮挡风险卡片点击（流中场景）。
 */
export function stripStaleInterrupt(
  values: Record<string, unknown>,
  runStatus: string | undefined,
): Record<string, unknown> {
  if (runStatus === AGENT_RUN_STATUS.INTERRUPTED) return values
  if (!('__interrupt__' in values)) return values
  const { __interrupt__: _omit, ...rest } = values
  return rest
}

/**
 * 创建 Agent SSE 流所需的入参。
 *
 * - `runId`：初始 run 标识。若启动时检测到当前 session 有更新的活跃 run，内部会覆盖为该 run。
 * - `event`：H3 事件对象，用于监听客户端断开（`event.node.req.on('close')`）。
 * - `sessionId`：LangGraph thread_id，用于查询当前活跃 run 以及 PostgresSaver checkpoint。
 * - `latestRunStatus`：可选，最近一次 run 的状态；若为终结状态则走"仅发 checkpoint"快路径。
 * - `replayMode`：可选，Redis Stream 补发策略。
 *   - `'all'`（默认）：按顺序逐条转发 missed events，适用于一般 chat 类端点
 *   - `'last-values-only'`：只转发最后一条 values 快照，跳过其它历史事件。适用于事件量极大的
 *     vertical（如 init-analysis 7 模块累计 ~2000 条 / 几 MB Redis Stream），避免逐条 replay
 *     让前端卡顿。重连时累积的合成卡片（如材料处理）会丢失，由实时订阅段在下一个事件到达时拉回。
 * - `useShortCircuit`：可选，启用终态短路。当 `latestRunStatus ∈ {completed,failed,cancelled}` 时
 *   跳过 Redis Stream 全量 XRANGE，直接读 PostgresSaver checkpoint 发一次 values + 一次
 *   status_change 后关流。同样为大流量场景设计。
 *   与默认 `isCompletedRun` 路径的差异：短路会**显式发一条 status_change**——前端
 *   `useStreamChat` 依赖该事件把 runStatus 切到终态，仅靠 stream EOF 不会触发。
 * - `shortCircuitError`：可选，短路 + `failed` 状态下附加到 `status_change` 的 error 字段。
 *   由调用方从 `agentRuns.error` 透传，让前端展示具体错误而非泛化文案。
 */
export interface CreateAgentSseStreamOptions {
  runId: string
  event: H3Event
  sessionId: string
  latestRunStatus?: string
  replayMode?: 'all' | 'last-values-only'
  useShortCircuit?: boolean
  shortCircuitError?: string | null
}

/** 短路路径支持的终态状态：从 TERMINAL_STATUSES 派生 */
// INTERRUPTED 不能短路：其 __interrupt__ 仅存在于 Redis Stream 末条 values，不在 checkpoint
const SHORT_CIRCUIT_TERMINAL_STATUSES: readonly string[] = TERMINAL_STATUSES.filter(
  (s) => s !== AGENT_RUN_STATUS.INTERRUPTED,
)

/** 判断 run 状态是否可以走 SSE 短路路径 */
function isShortCircuitable(status: string | null | undefined): boolean {
  return status != null && SHORT_CIRCUIT_TERMINAL_STATUSES.includes(status)
}

/**
 * 构造一个符合 LangGraph `toEventStream()` 协议的 SSE ReadableStream。
 *
 * 注意：本函数只负责编排"补发 + 订阅"，session/run/case 等权限与业务校验应在调用方完成。
 * 内部不做任何额外的 DB 权限查询，避免重复往返。
 */
export function createAgentSseStream(
  opts: CreateAgentSseStreamOptions,
): ReadableStream<Uint8Array> {
  const { event, sessionId, latestRunStatus } = opts
  let { runId } = opts

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const abortController = new AbortController()

      const emitInterruptedTerminal = () => {
        controller.enqueue(encoder.encode(
          `event: custom\ndata: ${JSON.stringify({
            type: 'status_change',
            runId,
            sessionId,
            status: AGENT_RUN_STATUS.INTERRUPTED,
          })}\n\n`,
        ))
      }

      // 客户端断开时 abort
      event.node.req.on('close', () => {
        abortController.abort()
      })

      // Keepalive 心跳（防止 Nginx/CDN/LB 超时）
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
        catch {
          // controller 已关闭时忽略
        }
      }, 15000)

      try {
        // ====== 终态短路（init-analysis 等大流量场景启用）======
        // 跳过 Redis Stream XRANGE 与 createEventSubscription，直接发 checkpoint values
        // + status_change 后关流。前端依赖 status_change 把 runStatus 切到终态。
        if (opts.useShortCircuit && isShortCircuitable(latestRunStatus)) {
          const checkpointValues = await getThreadValuesService(sessionId)
          if (checkpointValues) {
            const messages = (checkpointValues.messages as any[]) || []
            if (messages.length > 0) {
              const filteredMessages = filterInjectedMessages(messages)
              controller.enqueue(encoder.encode(
                `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
              ))
            }
          }
          const statusPayload: Record<string, unknown> = {
            type: 'status_change',
            runId,
            status: latestRunStatus,
          }
          if (latestRunStatus === AGENT_RUN_STATUS.FAILED && opts.shortCircuitError) {
            statusPayload.error = opts.shortCircuitError
          }
          controller.enqueue(encoder.encode(
            `event: custom\ndata: ${JSON.stringify(statusPayload)}\n\n`,
          ))
          return
        }

        const isCompletedRun = latestRunStatus
          ? TERMINAL_STATUSES.includes(latestRunStatus)
          : false

        logger.info(`[SSE] runId=${runId}, latestRunStatus=${latestRunStatus}, isCompletedRun=${isCompletedRun}`)

        const currentActiveRun = await getActiveRunService(sessionId)
        logger.info(`[SSE] currentActiveRun=${currentActiveRun ? currentActiveRun.id : 'null'}`)
        if (currentActiveRun) {
          runId = currentActiveRun.id
        }
        else if (isCompletedRun) {
          const rawCheckpointValues = await getThreadValuesService(sessionId)
          const checkpointValues = rawCheckpointValues
            ? stripStaleInterrupt(rawCheckpointValues, latestRunStatus)
            : null
          const messages = (checkpointValues?.messages as any[]) || []
          logger.info(`[SSE] checkpointValues exists=${!!checkpointValues}, messages count=${messages.length}`)
          if (checkpointValues) {
            if (messages.length > 0) {
              const filteredMessages = filterInjectedMessages(messages)
              logger.info(`[SSE] filteredMessages count=${filteredMessages.length}`)
              controller.enqueue(encoder.encode(
                `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
              ))
            }
          }
          return
        }
        // 有活跃 run 但旧 run 未完成或有未终结状态：走 replay + subscribe（需求2）

        // 活跃 run：重放 Redis Stream 补发历史事件，再订阅实时事件
        let missed: any[] = []
        try {
          missed = await replayEvents(runId)
        } catch (err) {
          logger.warn(`Redis Stream 补发失败: run=${runId}`, err)
        }

        // last-values-only 模式：跳过累积量大的 stream_event（messages/values/updates），
        // 但**保留** custom_event 与终态 status_change——前者是合成卡片事件
        // （prepare_materials / analysis_summary / sub_agent_*），phase=start/end 必须配对，
        // 漏掉 start 则后续 progress/end 在前端找不到 toolCallId 全部废；后者用于关流。
        //
        // 时序背景：worker pickup run 的速度通常快于浏览器 SSE 订阅完成（同进程 + 同 Redis），
        // beforeAgent 中间件发出的 phase=start 在订阅之前就已写入 Redis Stream，pubsub 收不到，
        // 必须从 missed 里拿。重连场景同理。
        let lastValuesAlreadyReplayed = false
        if (opts.replayMode === 'last-values-only' && missed.length > 0) {
          // 单次倒序扫描同时找最后一条 values 与最后一条终态 status_change，
          // 避免 [...missed].reverse() 两次拷贝（init-analysis 累计 ~2000 条事件时显著）
          let lastValues: typeof missed[number] | undefined
          let lastStatus: typeof missed[number] | undefined
          for (let i = missed.length - 1; i >= 0; i--) {
            const evt = missed[i]!
            if (!lastValues && evt.type === 'stream_event' && evt.event === 'values') {
              lastValues = evt
            }
            if (
              !lastStatus
              && evt.type === 'status_change'
              && TERMINAL_STATUSES.includes(evt.status)
              && isParentRunTerminal(evt)
            ) {
              lastStatus = evt
            }
            if (lastValues && lastStatus) break
          }

          // 1. 挑最后一条 values 转发，替代逐条 replay 上千条 messages/values/updates
          if (lastValues?.type === 'stream_event') {
            const data = lastValues.data as { messages?: any[] }
            const filteredMessages = filterInjectedMessages(data.messages ?? [])
            controller.enqueue(encoder.encode(
              `event: values\ndata: ${JSON.stringify({ ...data, messages: filteredMessages })}\n\n`,
            ))
            lastValuesAlreadyReplayed = true
          }

          // 2. 保留所有 custom_event：合成卡片配对事件不可丢
          //    （prepare_materials / analysis_summary / sub_agent_*），phase=start/end 必须配对，
          //    漏掉 start 则后续 progress/end 在前端找不到 toolCallId 全部废
          for (const evt of missed) {
            if (evt.type !== 'custom_event') continue
            controller.enqueue(encoder.encode(
              `event: custom\ndata: ${JSON.stringify(evt)}\n\n`,
            ))
          }

          // 3. 保留终态 status_change（让下方"missed 末条终态 → 关流"逻辑正常触发）。
          //    非终态 status_change（如 RUNNING）冗余，丢弃；前端通过 stream 自身判断 isLoading。
          missed = lastStatus ? [lastStatus] : []
        }

        // 如果 Redis Stream 没有数据，fallback 到 PostgresSaver checkpoint
        // 注意：必须根据 run.status 决定 fallback 后是否继续订阅
        //   - PENDING/RUNNING：worker 还没跑 / 正在跑 → 继续订阅实时事件
        //   - INTERRUPTED：worker 已经停在 interrupt 点，不会再有新事件 →
        //     必须 emit status_change(INTERRUPTED) + return，否则前端 stream
        //     一直挂着 loading，UI 永远收不到结束信号 + interrupt 卡片不渲染
        //     （线上 bug：用户在 template_select interrupt 卡片暂停期间刷新页面，
        //      Redis Stream 已过期，前端 stream 永久 loading 卡死）
        let hasFallbackData = false
        // last-values-only 模式找到了快照就跳过 checkpoint fallback（避免重复发 values）
        if (missed.length === 0 && !lastValuesAlreadyReplayed) {
          const rawCheckpointValues = await getThreadValuesService(sessionId)
          const checkpointValues = rawCheckpointValues
            ? stripStaleInterrupt(rawCheckpointValues, currentActiveRun?.status)
            : null
          if (checkpointValues) {
            const messages = (checkpointValues.messages as any[]) || []
            if (messages.length > 0) {
              const filteredMessages = filterInjectedMessages(messages)
              controller.enqueue(encoder.encode(
                `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
              ))
              hasFallbackData = true
            }
          }

          // INTERRUPTED：worker 已停在 interrupt 点，不会再有新事件，必须主动收尾
          if (currentActiveRun?.status === AGENT_RUN_STATUS.INTERRUPTED) {
            emitInterruptedTerminal()
            return
          }
          // PENDING/RUNNING：不 return，继续订阅实时事件以接收 worker 后续输出
        }

        // Redis Stream 有数据：发送补发事件
        if (missed.length > 0) {
          // 发送所有补发事件
          for (const evt of missed) {
            let sseData: string
            if (evt.type === 'stream_event') {
              if (evt.event === 'values') {
                // values 事件需要过滤消息
                const filteredMessages = filterInjectedMessages(evt.data.messages ?? [])
                sseData = `event: values\ndata: ${JSON.stringify({ ...evt.data, messages: filteredMessages })}\n\n`
              } else if (evt.event === 'messages') {
                // messages 事件也需要过滤注入消息
                const filtered = filterMessagesEvent(evt.data)
                if (!filtered) continue
                sseData = `event: messages\ndata: ${JSON.stringify(filtered)}\n\n`
              } else {
                sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
              }
            }
            else if (evt.type === 'custom_event') {
              // custom 通道承载 AgentCustomEvent 和 AgentStatusEvent 两类事件，消费方按 data.type 区分
              sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
            }
            else {
              sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
            }
            controller.enqueue(encoder.encode(sseData))
          }

          // 补发最后一条若为父 run 终结，直接关流
          const lastMissed = missed.at(-1)
          if (
            lastMissed?.type === 'status_change'
            && TERMINAL_STATUSES.includes(lastMissed.status)
            && isParentRunTerminal(lastMissed)
          ) {
            return
          }
        }

        // INTERRUPTED 收尾：Redis Stream 截断 / agentWorker 旧版漏发 terminal 时兜底，
        // 否则前端 stream 永久 loading。PENDING/RUNNING 仍走下面的实时订阅。
        if (currentActiveRun?.status === AGENT_RUN_STATUS.INTERRUPTED) {
          emitInterruptedTerminal()
          return
        }

        // 订阅实时事件（活跃 run 或补发后未结束的 run）
        for await (const evt of createEventSubscription(runId, abortController.signal)) {
          if (evt.type === 'status_change' && TERMINAL_STATUSES.includes(evt.status)) {
            controller.enqueue(encoder.encode(`event: custom\ndata: ${JSON.stringify(evt)}\n\n`))
            if (isParentRunTerminal(evt)) break
            continue
          }
          if (evt.type === 'stream_event') {
            let sseData: string
            if (evt.event === 'values') {
              // values 事件需要过滤消息
              const data = evt.data as { messages?: any[] }
              const filteredMessages = filterInjectedMessages(data.messages ?? [])
              sseData = `event: values\ndata: ${JSON.stringify({ ...data, messages: filteredMessages })}\n\n`
            } else if (evt.event === 'messages') {
              // messages 事件也需要过滤注入消息
              const filtered = filterMessagesEvent(evt.data)
              if (!filtered) continue
              sseData = `event: messages\ndata: ${JSON.stringify(filtered)}\n\n`
            } else {
              sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
            }
            controller.enqueue(encoder.encode(sseData))
          }
          if (evt.type === 'custom_event') {
            // custom 通道承载 AgentCustomEvent 和 AgentStatusEvent 两类事件，消费方按 data.type 区分
            controller.enqueue(encoder.encode(
              `event: custom\ndata: ${JSON.stringify(evt)}\n\n`,
            ))
          }
        }
      }
      catch (err) {
        logger.error(`SSE 流异常: run=${runId}`, err)
      }
      finally {
        clearInterval(keepalive)
        abortController.abort()
        controller.close()
      }
    },
  })
}

/**
 * 构造一个立即关闭的空 SSE 响应，用于聊天入口「会话从未运行过、无历史可回放」的场景。
 *
 * 不能复用 createAgentSseStream：该函数末尾会 createEventSubscription 订阅 run 的实时
 * 事件，无有效 runId 时会订阅一个不存在的 run，keepalive 永不结束 → 前端永久 loading。
 */
export function createEmptyAgentSseResponse(event: H3Event): Response {
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * Agent Worker 核心
 *
 * 负责从 PostgreSQL 任务队列取任务、执行 Agent、心跳维持、崩溃恢复
 */

import type { agentRuns } from '~~/generated/prisma/client'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import { SessionScope } from '#shared/types/agentEvent'
import { isInjectedContextMessage } from '~~/server/services/agent-platform/context/injectorDetection'

/** scope 必须有 userId 的 session（非 case 域，全是用户级会话） */
const USER_SCOPED_SESSIONS = new Set<SessionScope>([
  SessionScope.DOCUMENT,
  SessionScope.ASSISTANT,
  SessionScope.CONTRACT,
])
import {
  claimPendingRunDAO,
  updateRunStatusDAO,
  updateHeartbeatDAO,
  findStaleRunsDAO,
  resetStaleRunDAO,
} from './agentRun.dao'
import {
  publishAgentEvent,
  publishStatusChange,
  startReconnectFlush,
} from './agentEventBridge'
import { repairOrphanToolUseCheckpoint } from '../workflow/repairOrphanToolUse'
import { generateSessionTitleAsync } from '../assistant/assistantSession.service'
import { getRedisSubscriber } from '~~/server/lib/redis'
import { isContextOverflowError, logContextOverflow } from '../workflow/context/contextErrorLogger'
import { getCheckpointer } from '../workflow/checkpointer'
import { withLangfuseContext } from '~~/server/lib/langfuse'

/**
 * Worker 主动 abort run 时的语义分类，通过 AbortController.signal.reason 携带：
 * - Cancelled：用户主动取消 / 心跳丢失被接管 → DB 写 CANCELLED，前端不报错
 * - Shutdown：Worker 进程关停 → DB 重置回 PENDING 等其他 Worker 接管，前端不收终态
 * - Timeout：Agent 执行超时 → DB 写 FAILED，前端弹错供用户重试
 */
export enum WorkerAbortKind {
  Cancelled = 'cancelled',
  Shutdown = 'shutdown',
  Timeout = 'timeout',
}

export class WorkerAbortError extends Error {
  constructor(message: string, readonly kind: WorkerAbortKind) {
    super(message)
    this.name = 'WorkerAbortError'
  }
}

export interface AgentWorkerConfig {
  maxConcurrent: number
  timeoutMs: number
  heartbeatIntervalMs: number
  crashThresholdMs: number
}

/** 从 runtimeConfig 获取 Worker 默认配置 */
function getDefaultConfig(): AgentWorkerConfig {
  const { agent } = useRuntimeConfig()
  return {
    maxConcurrent: agent.maxConcurrent,
    timeoutMs: agent.timeoutMs,
    heartbeatIntervalMs: agent.heartbeatIntervalMs,
    crashThresholdMs: agent.crashThresholdMs,
  }
}

export class AgentWorker {
  readonly workerId: string
  private readonly config: AgentWorkerConfig
  private activeRuns: Map<string, AbortController> = new Map()
  private isShuttingDown = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private crashCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor(workerId?: string, config?: AgentWorkerConfig) {
    this.workerId = workerId ?? `worker-${crypto.randomUUID().slice(0, 8)}`
    this.config = config ?? getDefaultConfig()
  }

  /** 启动 Worker */
  async start(): Promise<void> {
    logger.info(`Agent Worker ${this.workerId} 启动中...`)

    // 1. 启动 Redis 重连补发监听
    startReconnectFlush()

    // 2. 订阅 Redis 频道
    try {
      const sub = getRedisSubscriber()
      await sub.subscribe('agent_tasks')
      await sub.psubscribe('run_cancel:*')

      sub.on('message', (_channel: string, _message: string) => {
        // 收到新任务通知，尝试取任务
        this.processNextTask().catch((err) => {
          logger.error('Worker processNextTask 异常:', err)
        })
      })

      sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
        // 收到取消信号
        const runId = channel.replace('run_cancel:', '')
        this.handleCancelSignal(runId)
      })
    }
    catch (err) {
      logger.warn('Worker Redis 订阅失败，将仅依赖轮询:', err)
    }

    // 3. 启动心跳循环
    this.startHeartbeat()

    // 4. 启动崩溃恢复检查
    this.startCrashRecovery()

    // 5. 主动扫描 pending 任务（处理 Worker 重启期间入队的任务）
    await this.drainPendingTasks()

    logger.info(`Agent Worker ${this.workerId} 启动完成`)
  }

  /** 处理下一个待执行任务 */
  async processNextTask(): Promise<boolean> {
    if (this.isShuttingDown) return false

    if (this.activeRuns.size >= this.config.maxConcurrent) return false

    const run = await claimPendingRunDAO(this.workerId)
    if (!run) return false

    // 非阻塞执行（不 await，允许并行）
    this.executeRun(run).catch((err) => {
      logger.error(`Worker executeRun 未捕获异常: run=${run.id}`, err)
    })

    return true
  }

  /** 执行单个 run */
  private async executeRun(run: agentRuns): Promise<void> {
    // worker 任务不在 HTTP 上下文内，从 run / session 重建 Langfuse ALS
    return withLangfuseContext(
      {
        runId: run.id,
        sessionId: run.sessionId,
        threadId: run.sessionId,
        userId: run.userId,
        caseId: run.caseId ?? undefined,
      },
      () => this.executeRunInner(run),
    )
  }

  private async executeRunInner(run: agentRuns): Promise<void> {
    const abortController = new AbortController()
    this.activeRuns.set(run.id, abortController)

    // 超时计时器
    const timeoutTimer = setTimeout(() => {
      logger.warn(`Run ${run.id} 超时，终止执行`)
      abortController.abort(new WorkerAbortError('Agent 执行超时', WorkerAbortKind.Timeout))
    }, this.config.timeoutMs)

    try {
      // 发布 running 状态
      await publishStatusChange({
        type: 'status_change',
        runId: run.id,
        sessionId: run.sessionId,
        status: AGENT_RUN_STATUS.RUNNING,
      })

      // 调用 Agent（根据 session 类型路由）
      const input = run.input as { message?: string; command?: unknown; selectedModules?: string[]; thinking?: boolean }

      let stream: ReadableStream
      const session = await prisma.caseSessions.findUnique({
        where: { sessionId: run.sessionId },
        select: {
          scope: true,
          type: true,
          metadata: true,
          userId: true,
          caseId: true,
          title: true,
        },
      })

      // session 必须存在，否则直接抛错，避免静默降级到普通 runCaseChat 导致路由错乱
      if (!session) {
        throw new Error(`Session not found for run ${run.id}, sessionId: ${run.sessionId}`)
      }

      // 兜底：修复上一轮可能遗留的 orphan tool_use
      // 上一轮若在工具调用中途被取消/崩溃，catch 块的 repair 与 LangGraph
      // 异步写 checkpoint 存在 race condition，可能漏网；在本轮 invoke 前
      // 再扫一次，确保发给 LLM 的历史消息中每个 tool_use 都有配对 tool_result
      try {
        const lazyResult = await repairOrphanToolUseCheckpoint(run.sessionId, '上一轮对话被用户取消')
        if (lazyResult.parseFailures > 0) {
          // blob 解析失败意味着 orphan 可能存在但未修——升级到 error，防止静默失败
          logger.error(
            `[Lazy repair] session=${run.sessionId} 有 ${lazyResult.parseFailures} 个 scope 的 blob 解析失败，orphan 可能未修；messageIntegrityMiddleware 会在模型调用前兜底补救`,
          )
        }
      } catch (e) {
        logger.error(`[Lazy repair] 整体失败 (run=${run.id}):`, e)
      }

      // 路由分流：经过 AgentRegistry.dispatch 派发到注册的 runner（runner 内部有最终校验，
      // 此处提前抛错只是为了让错误带上 sessionId 更易排查）。session.scope 在 caseSessions
      // 表里可能为 null（早期数据），按 case 域处理。
      const scope = (session.scope ?? SessionScope.CASE) as SessionScope
      if (USER_SCOPED_SESSIONS.has(scope) && session.userId == null) {
        throw new Error(`${scope} session ${run.sessionId} 缺失 userId（数据损坏）`)
      }
      if (scope === SessionScope.CASE && session.caseId == null) {
        throw new Error(`case session ${run.sessionId} 缺失 caseId（scope 与 caseId 不一致，数据损坏）`)
      }

      // 首条用户消息一发即并行生成会话标题（与 agent 回答并行，不阻塞）
      // 触发条件：assistant 会话 + 尚无标题 + 本轮带用户消息。
      // 失败/中断都不影响——它在 agent 执行前就已触发；下一轮带消息的 run 会自动重试。
      if (
        scope === SessionScope.ASSISTANT
        && !session.title
        && session.userId != null
        && typeof input.message === 'string'
        && input.message.trim().length > 0
      ) {
        void generateSessionTitleAsync(run.sessionId, session.userId, input.message)
      }

      const type = session.type ?? null
      const meta = session.metadata as Record<string, unknown> | null

      stream = await agentRegistry.dispatch(
        {
          scope,
          type,
          caseId: session.caseId ?? null,
          userId: session.userId ?? run.userId,
        },
        {
          runId: run.id,
          sessionId: run.sessionId,
          userId: session.userId ?? run.userId,
          caseId: session.caseId ?? null,
          message: input.message,
          command: input.command as import('@langchain/langgraph').Command | undefined,
          thinking: input.thinking,
          selectedModules: input.selectedModules ?? [],
          signal: abortController.signal,
          metadata: meta ?? undefined,
        },
      )

      // 遍历 SSE stream 并发布事件到 Redis。
      // 中断时由 consumeAgentStream 内部 cancel() 把取消透传到上游 LangGraph 流，
      // 确保图层级运行收到结束回调（否则 Langfuse 会留下无根的无名 trace）。
      const { lastValuesData } = await consumeAgentStream(
        stream,
        abortController.signal,
        (event, data) => publishAgentEvent({
          type: 'stream_event',
          runId: run.id,
          sessionId: run.sessionId,
          event: event as 'values' | 'messages' | 'updates',
          data,
        }),
      )

      if (abortController.signal.aborted) {
        throw abortController.signal.reason ?? new Error('Run was aborted')
      }

      // 检查工作流是否被 interrupt
      // LangGraph 的 values 流故意过滤 __interrupt__（mapOutputValues），
      // 但 @langchain/langgraph-sdk 的 StreamManager 能正确处理 values 中的 __interrupt__：
      // 有 __interrupt__ → merge；无 → replace。
      // 所以只需保证最后一个 values 事件包含 __interrupt__。
      if (lastValuesData) {
        try {
          let interrupts: any[] | undefined

          if (session.type === 2) {
            // 结构化分析：通过 workflow 实例获取 thread state
            const { getWorkflowThreadState } = await import('../workflow/caseAnalysisV2.executor')
            const threadState = await getWorkflowThreadState(run.sessionId)
            const lastTask = threadState.tasks?.at(-1)
            interrupts = lastTask?.interrupts
          } else {
            // 对话式聊天：直接从 PostgresSaver pendingWrites 抽 __interrupt__。
            // 不能用 dummy createAgent + getState().tasks 那条路径——caseMain 等
            // 真实 agent 带大量 middleware + tools，dummy 拓扑识别不出 task，
            // tasks.interrupts 永远空 → run 错标 COMPLETED → 刷新页面后 SSE 把
            // pendingWrites 中残留的 __interrupt__ 当 stale 剥掉，模板卡片永久 loading。
            // 详见 commit 17510fe0 + threadState.ts:111-127 的注释。
            const { getPendingInterruptsService } = await import('../workflow/agents')
            interrupts = await getPendingInterruptsService(run.sessionId)
          }

          if (interrupts?.length) {
            // 发布最终 values 事件（合并 __interrupt__），保证是最后一个 values 事件
            await publishAgentEvent({
              type: 'stream_event',
              runId: run.id,
              sessionId: run.sessionId,
              event: 'values',
              data: {
                ...(lastValuesData as Record<string, unknown>),
                __interrupt__: interrupts,
              },
            })

            await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.INTERRUPTED)
            await publishStatusChange({
              type: 'status_change',
              runId: run.id,
              sessionId: run.sessionId,
              status: AGENT_RUN_STATUS.INTERRUPTED,
            })
            return
          }
        } catch (stateErr) {
          logger.warn(`检查工作流 interrupt 状态失败: run=${run.id}`, stateErr)
        }
      }

      // 执行完成
      await updateRunStatusDAO(run.id, AGENT_RUN_STATUS.COMPLETED, {
        completedAt: new Date(),
      })
      await publishStatusChange({
        type: 'status_change',
        runId: run.id,
        sessionId: run.sessionId,
        status: AGENT_RUN_STATUS.COMPLETED,
      })
    }
    catch (err: any) {
      const errorMessage = err?.message ?? '未知错误'
      // 通过 AbortController.signal.reason 而非 errorMessage 子串匹配区分 abort 语义：
      // 'Worker shutdown' / 'Agent 执行超时' / '心跳丢失' 都不含 cancelled/aborted 关键词，
      // 旧实现会把它们错标为 FAILED 让用户看到「分析失败」。
      const abortReason = abortController.signal.aborted ? abortController.signal.reason : null
      const abortKind = abortReason instanceof WorkerAbortError ? abortReason.kind : null

      // Worker 关停：把 run 重置回 pending 让其他 worker 接管，不写终态、不发 status_change。
      // 跳过 repairOrphanToolUseCheckpoint —— 下个 worker claim 后 executeRunInner
      // 开头的 lazy repair（约 188 行）会再扫一次，这里再修是纯重复。
      if (abortKind === WorkerAbortKind.Shutdown) {
        await resetStaleRunDAO(run.id, this.workerId).catch(e =>
          logger.error(`[Shutdown reset] 重置 run=${run.id} 为 pending 失败:`, e),
        )
        return
      }

      const isCancelled = abortKind === WorkerAbortKind.Cancelled
      const status = isCancelled ? AGENT_RUN_STATUS.CANCELLED : AGENT_RUN_STATUS.FAILED

      // 识别上下文超限错误并打印结构化日志（含当前 checkpoint 消息分布）
      if (!isCancelled && isContextOverflowError(err)) {
        await logContextOverflowFromCheckpoint(run, err).catch((logErr) => {
          logger.warn(`[ContextOverflow] 读取 checkpoint 失败 (run=${run.id}):`, logErr)
        })
      }

      // 取消由 cancelRunService 处理，这里只在 failed 路径写库
      if (!isCancelled) {
        await updateRunStatusDAO(run.id, status, {
          error: errorMessage,
          completedAt: new Date(),
        }).catch(e => logger.error('更新 run 状态失败:', e))
      }

      // 修复 checkpoint 中可能的 orphan tool_use
      // LangGraph step-level checkpoint 在工具节点中断时会留下 AIMessage(tool_use)
      // 没有对应的 ToolMessage，导致用户"继续"对话时 Anthropic API 返回 400 invalid_request_error
      try {
        const catchResult = await repairOrphanToolUseCheckpoint(run.sessionId, errorMessage)
        if (catchResult.parseFailures > 0) {
          logger.error(
            `[Catch repair] session=${run.sessionId} 有 ${catchResult.parseFailures} 个 scope 的 blob 解析失败，orphan 可能未修`,
          )
        }
      } catch (e) {
        logger.error(`[Catch repair] 整体失败 (run=${run.id}):`, e)
      }

      await publishStatusChange({
        type: 'status_change',
        runId: run.id,
        sessionId: run.sessionId,
        status,
        error: isCancelled ? undefined : errorMessage,
      }).catch(e => logger.error('发布状态变更失败:', e))

      if (!isCancelled) {
        logger.error(`Run ${run.id} 执行失败:`, err)
      }
    }
    finally {
      clearTimeout(timeoutTimer)
      this.activeRuns.delete(run.id)

      // 完成一个任务后尝试取下一个
      if (!this.isShuttingDown) {
        this.processNextTask().catch(() => {})
      }
    }
  }

  /** 处理取消信号 */
  private handleCancelSignal(runId: string): void {
    const controller = this.activeRuns.get(runId)
    if (controller) {
      logger.info(`收到取消信号: run=${runId}`)
      controller.abort(new WorkerAbortError('Run cancelled', WorkerAbortKind.Cancelled))
    }
  }

  /** 心跳更新循环 */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      if (this.activeRuns.size === 0) return

      try {
        const count = await updateHeartbeatDAO(this.workerId)
        if (count === 0 && this.activeRuns.size > 0) {
          // 心跳更新返回 0 但有活跃 run → 可能被其他 Worker 接管了
          logger.warn(`心跳更新返回 0，但仍有 ${this.activeRuns.size} 个活跃 run，终止执行`)
          for (const [runId, controller] of this.activeRuns) {
            controller.abort(new WorkerAbortError('心跳丢失，任务可能已被接管', WorkerAbortKind.Cancelled))
          }
        }
      }
      catch (err) {
        logger.error('心跳更新失败:', err)
      }
    }, this.config.heartbeatIntervalMs)
  }

  /** 崩溃恢复检查循环 */
  private startCrashRecovery(): void {
    // 崩溃恢复检查间隔 = 崩溃阈值 * 2
    const checkInterval = this.config.crashThresholdMs * 2

    this.crashCheckTimer = setInterval(async () => {
      try {
        const staleRuns = await findStaleRunsDAO(this.config.crashThresholdMs)
        for (const run of staleRuns) {
          const reset = await resetStaleRunDAO(run.id, run.workerId ?? '')
          if (reset) {
            logger.info(`崩溃恢复: run=${run.id} 从 worker=${run.workerId} 重置为 pending`)
            // 尝试立即取走重置的任务
            this.processNextTask().catch(() => {})
          }
        }
      }
      catch (err) {
        logger.error('崩溃恢复检查失败:', err)
      }
    }, checkInterval)
  }

  /** 扫描所有 pending 任务直到无法继续 */
  private async drainPendingTasks(): Promise<void> {
    let claimed = true
    while (claimed && !this.isShuttingDown) {
      claimed = await this.processNextTask()
    }
  }

  /** 优雅关闭 */
  async shutdown(): Promise<void> {
    logger.info(`Agent Worker ${this.workerId} 正在关闭...`)
    this.isShuttingDown = true

    // 停止定时器
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.crashCheckTimer) clearInterval(this.crashCheckTimer)

    // 等待活跃任务完成（最多等 30 秒）
    if (this.activeRuns.size > 0) {
      logger.info(`等待 ${this.activeRuns.size} 个活跃任务完成...`)
      const deadline = Date.now() + 30_000

      while (this.activeRuns.size > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000))
      }

      // 超时仍未完成则强制中断：abort 后 catch 块走 Shutdown 分支把 run 重置回 pending，
      // 由其他 worker / 重启后的本 worker 通过任务队列自然接管。
      // 再等 5 秒让 catch 块跑完 DB reset；否则进程立即退出会留下 status=RUNNING
      // 的孤儿 run，需要走 crash recovery 兜底（耗时约 2*crashThresholdMs）。
      if (this.activeRuns.size > 0) {
        logger.warn(`强制中断 ${this.activeRuns.size} 个未完成任务，由 catch 流程重置为 pending`)
        for (const [_runId, controller] of this.activeRuns) {
          controller.abort(new WorkerAbortError('Worker shutdown', WorkerAbortKind.Shutdown))
        }

        const cleanupDeadline = Date.now() + 5_000
        while (this.activeRuns.size > 0 && Date.now() < cleanupDeadline) {
          await new Promise(r => setTimeout(r, 100))
        }
        if (this.activeRuns.size > 0) {
          logger.warn(`Worker shutdown: ${this.activeRuns.size} 个任务的 catch 流程未在 5s 内完成，依赖 crash recovery 接管`)
        }
      }
    }

    logger.info(`Agent Worker ${this.workerId} 已关闭`)
  }

  /** 获取活跃 run 数量（用于测试/监控） */
  get activeRunCount(): number {
    return this.activeRuns.size
  }

  /** 是否正在关闭（用于测试） */
  get shuttingDown(): boolean {
    return this.isShuttingDown
  }
}

/**
 * 消费 Agent 的 SSE ReadableStream，逐事件回调投递。
 *
 * 中断时必须 `reader.cancel()` 把取消透传到上游 LangGraph 流：仅 `releaseLock()`
 * 不会取消上游，图层级运行收不到结束回调，Langfuse 根 span 永不 end、永不上报，
 * 只剩无根的孤儿子观测——在 Langfuse 列表里表现为「无名」trace。
 *
 * @param stream  agentRegistry.dispatch 返回的 SSE 流
 * @param signal  本次 run 的中断信号（取消 / 超时 / 心跳丢失 / worker 关停均会 abort）
 * @param onEvent 每条 SSE 事件的投递回调（已剥离 system / internal 消息）
 * @returns lastValuesData 最后一个 values 事件的数据（用于流结束后的 interrupt 检测）
 */
export async function consumeAgentStream(
  stream: ReadableStream,
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => Promise<void>,
): Promise<{ lastValuesData: unknown }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  // 缓冲最后一个 values 事件，stream 结束后可能需要注入 __interrupt__
  let lastValuesData: unknown = null

  const dispatch = async (text: string): Promise<void> => {
    for (const evt of parseSSEEvents(text)) {
      // 剥离 system 消息（防止系统提示词泄露）
      const sanitized = stripSystemMessages(evt.event, evt.data)
      if (sanitized === null) continue
      if (evt.event === 'values') lastValuesData = sanitized
      await onEvent(evt.event, sanitized)
    }
  }

  let completed = false
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      await dispatch(decoder.decode(value, { stream: true }))
    }
    // flush decoder 缓冲区中可能残留的数据
    const remaining = decoder.decode()
    if (remaining) await dispatch(remaining)
    completed = true
  }
  finally {
    if (completed && !signal.aborted) {
      reader.releaseLock()
    }
    else {
      // 中断 / 异常退出（如 onEvent 投递抛错）：cancel() 把取消透传到上游
      // LangGraph 流，触发其结束回调，让 Langfuse 图层级 span 正常 end ——
      // 否则上游流被遗弃，留下无根的无名孤儿 trace。
      await reader.cancel(signal.reason).catch(() => { /* 忽略 cancel 清理异常 */ })
    }
  }

  return { lastValuesData }
}

/**
 * 解析 SSE 格式文本为结构化事件
 *
 * SSE 格式: `event: xxx\ndata: {...}\n\n`
 */
function parseSSEEvents(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = []
  const parts = text.split('\n\n')

  for (const part of parts) {
    if (!part.trim()) continue

    let eventType = ''
    let dataStr = ''

    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7)
      }
      else if (line.startsWith('data: ')) {
        dataStr = line.slice(6)
      }
    }

    if (eventType && dataStr) {
      try {
        events.push({ event: eventType, data: JSON.parse(dataStr) })
      }
      catch {
        events.push({ event: eventType, data: dataStr })
      }
    }
  }

  return events
}

/**
 * 判断消息是否为 system 类型
 *
 * LangGraph 消息格式可能是：
 * - { type: 'system', ... }
 * - { data: { type: 'system', ... } }（嵌套格式）
 */
function isSystemMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  if (m.type === 'system') return true
  // 兼容嵌套 { data: { type: 'system' } } 格式
  if (m.data && typeof m.data === 'object' && (m.data as Record<string, unknown>).type === 'system') return true
  return false
}

/** 判断消息是否为中间件注入的上下文消息（不应发送到前端） */
const isInjectedMessage = isInjectedContextMessage

/** 判断消息是否应被过滤（system 消息、注入的上下文消息、或内部 LLM 调用消息） */
function isInternalMessage(msg: unknown): boolean {
  return isSystemMessage(msg) || isInjectedMessage(msg)
}

/**
 * 判断 messages 事件的 [messageChunk, metadata] 元组是否为内部 LLM 调用
 *
 * 通过 invoke 时传入的 tags: ['internal'] 标记识别，
 * LangGraph 会将 tags 写入 messages 事件的 metadata.tags 中
 */
function isInternalLLMEvent(data: unknown): boolean {
  if (!Array.isArray(data) || data.length < 2) return false
  const metadata = data[1] as Record<string, unknown> | undefined
  if (!metadata || typeof metadata !== 'object') return false
  const tags = metadata.tags as string[] | undefined
  return Array.isArray(tags) && tags.includes('internal')
}

/**
 * 从 SSE 事件数据中剥离内部消息（防止系统提示词和上下文注入消息泄露到客户端）
 *
 * - values 事件：过滤 data.messages 数组中的内部消息
 * - updates 事件：按 node 遍历，过滤每个 node 输出中的 messages 数组
 * - messages 事件：过滤整个事件（如果是内部消息则返回 null）
 */
function stripSystemMessages(event: string, data: unknown): unknown | null {
  if (!data || typeof data !== 'object') return data

  if (event === 'values') {
    const d = data as Record<string, unknown>
    if (Array.isArray(d.messages)) {
      return { ...d, messages: d.messages.filter(m => !isInternalMessage(m)) }
    }
    return data
  }

  // updates 事件：数据结构是 Record<nodeName, NodeOutput>（按节点聚合的增量更新）
  // 需遍历每个 node 输出单独处理其 messages 数组
  if (event === 'updates') {
    const d = data as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [nodeName, nodeOutput] of Object.entries(d)) {
      if (nodeOutput && typeof nodeOutput === 'object') {
        const no = nodeOutput as Record<string, unknown>
        if (Array.isArray(no.messages)) {
          result[nodeName] = {
            ...no,
            messages: no.messages.filter(m => !isInternalMessage(m)),
          }
          continue
        }
      }
      result[nodeName] = nodeOutput
    }
    return result
  }

  if (event === 'messages') {
    // messages 事件格式为 [messageChunk, metadata] 元组
    // 检查 metadata.tags 是否包含 'internal'（内部 LLM 调用，如意图分类器）
    if (isInternalLLMEvent(data)) return null

    // 兼容：单条消息或消息数组格式
    if (Array.isArray(data)) {
      const filtered = (data as unknown[]).filter(m => !isInternalMessage(m))
      return filtered.length > 0 ? filtered : null
    }
    if (isInternalMessage(data)) return null
    return data
  }

  return data
}

/**
 * 从 checkpointer 取最新 messages，结合错误信息打印结构化日志。
 * run 对象没有 scope/modelContextWindow 字段，打印出 sessionId/userId/caseId 供定位。
 */
async function logContextOverflowFromCheckpoint(run: agentRuns, err: unknown): Promise<void> {
  const checkpointer = await getCheckpointer()
  const tuple = await checkpointer.getTuple({
    configurable: { thread_id: run.sessionId },
  })
  const messages = (tuple?.checkpoint?.channel_values as any)?.messages
  logContextOverflow(err, {
    source: 'agentWorker.executeRun',
    messages: Array.isArray(messages) ? messages : undefined,
    extra: {
      runId: run.id,
      sessionId: run.sessionId,
      threadId: run.threadId,
      userId: run.userId,
      caseId: run.caseId,
    },
  })
}

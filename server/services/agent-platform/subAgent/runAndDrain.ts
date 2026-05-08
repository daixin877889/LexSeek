/**
 * sub-agent 流消费助手（runAndDrainStream）
 *
 * 用于 §阶段 5 子代理工具：法律助手主 Agent 调起 draft_document / review_contract
 * 工具，工具内部需要同步执行 documentMain / contractReviewMain（两者都返回 SSE
 * 格式 `event: xxx\ndata: ...\n\n` 的 ReadableStream<Uint8Array>），并把"落库后
 * 的最终结果"返回给主 Agent。
 *
 * 行为：
 * 1. 持续消费传入流，按 SSE 协议解析 `event: values|messages|updates` 等
 * 2. 始终缓存最后一条 `values` 事件的 data —— 主代理需要它构造结构化输出
 * 3. 检测到 values 事件 data 中含 `__interrupt__` 数组立即返回（不再继续消费）
 * 4. 流自然结束：返回 `{ finalState, success: true }`（finalState 为最后一条 values）
 * 5. 流抛错：返回 `{ finalState, success: false, error }`，不再向上抛
 * 6. 取消信号：监听 `signal.abort`，主动 cancel 流并返回 `{ success: false }`
 *
 * 不在此处 publish 事件 —— 调用方（draft_document / review_contract 工具）
 * 拿到结果后再调 publishCustomEvent 通知前端。
 *
 * 流上的事件不会被我们重新发到 Redis，因为子工作流（documentMain / contractReviewMain）
 * 由主 Agent 通过 enqueueRunService 入队后由 agentWorker 独立执行，agentWorker
 * 自己会把事件写到该 sub run 的 SSE 流。当前调用方的"工具内部直接 invoke"
 * 模式则是另一个故事 —— 见 spec §5.1。
 */

/** 结构化的最后一条 values 事件 data。 */
export type FinalValuesState = Record<string, unknown> & {
    __interrupt__?: unknown[]
}

/** 检测到的 interrupt 信息。 */
export interface DetectedInterrupt {
    /** 直接透传 LangGraph values.__interrupt__ 数组中的第一条记录 */
    raw: unknown
    /** 尝试解析后的 type / value（payload）。无法解析时为 undefined。 */
    type?: string
    value?: unknown
}

export interface RunAndDrainResult {
    /** 是否成功 drain 完整流（不计入 interrupt 提前返回；interrupt 也算成功） */
    success: boolean
    /** 最后一条 values 事件 data；若流上没有 values 事件则为 null */
    finalState: FinalValuesState | null
    /** 检测到 interrupt 时返回；用于子代理工具透传到主 Agent */
    interrupt?: DetectedInterrupt
    /** 失败时的错误信息（success=false 才有值） */
    error?: string
}

export interface RunAndDrainOptions {
    /** 取消信号；abort 时主动 cancel 流并返回 success=false */
    signal?: AbortSignal
}

/**
 * 解析 SSE 文本，按 `\n\n` 切块；返回已解析的完整事件 + 末尾未完整的残余文本。
 *
 * 上游 stream 可能在事件中间切 chunk（如 `event: values\ndata: {"messa` + `ge":"hi"}\n\n`），
 * 调用方在多次 read 之间需把残余继续拼到下一段一起喂给本函数。
 */
function parseSSEAccumulator(text: string): {
    events: Array<{ event: string; data: unknown }>
    remainder: string
} {
    const events: Array<{ event: string; data: unknown }> = []
    const lastTerminator = text.lastIndexOf('\n\n')
    if (lastTerminator < 0) {
        return { events, remainder: text }
    }

    const completePart = text.slice(0, lastTerminator)
    const remainder = text.slice(lastTerminator + 2)

    const blocks = completePart.split('\n\n')
    for (const block of blocks) {
        const trimmed = block.trim()
        if (!trimmed) continue

        const lines = trimmed.split('\n')
        let eventType = ''
        let dataStr = ''
        for (const line of lines) {
            if (line.startsWith('event: ')) {
                eventType = line.slice('event: '.length).trim()
            } else if (line.startsWith('data: ')) {
                dataStr = line.slice('data: '.length)
            }
        }
        if (!eventType) continue
        try {
            events.push({ event: eventType, data: dataStr ? JSON.parse(dataStr) : null })
        } catch {
            events.push({ event: eventType, data: dataStr })
        }
    }
    return { events, remainder }
}

/**
 * 把 LangGraph error 帧 data 序列化为可读字符串。
 *
 * LangGraph 的 `_serializeError`（pregel/stream.js）通常返回
 *   `{ error: 'GraphRecursionError', message: 'recursion limit reached' }`。
 * 也可能直接是字符串、null 或其他形态——本函数提取尽量多的诊断信息。
 */
function serializeErrorPayload(data: unknown): string {
    if (typeof data === 'string') return `子流 error 帧：${data}`
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>
        const errName = typeof d.error === 'string' ? d.error : ''
        const errMsg = typeof d.message === 'string' ? d.message : ''
        if (errName || errMsg) return `子流 error 帧：${errName || 'error'}${errMsg ? ` - ${errMsg}` : ''}`
        try {
            return `子流 error 帧：${JSON.stringify(data)}`
        } catch {
            return '子流 error 帧（无法序列化的 data）'
        }
    }
    return '子流 error 帧'
}

/**
 * 从 LangGraph values.__interrupt__ 数组中提取首条 interrupt 的结构化信息。
 *
 * LangGraph 的 interrupt() 抛出的对象形态：
 *   { value: <interrupt() 的入参>, when: 'during', resumable: boolean, ns: [...] }
 *
 * 我们关心的是 `value`，业务约定 value 形如 `{ type: string, payload?: unknown, ... }`。
 */
function extractInterruptInfo(raw: unknown): DetectedInterrupt {
    const info: DetectedInterrupt = { raw }
    const value = (raw as any)?.value
    if (value && typeof value === 'object') {
        const t = (value as any).type
        if (typeof t === 'string') info.type = t
        info.value = value
    }
    return info
}

/**
 * 消费整条 sub-agent SSE 流，解析最后一条 values 事件，检测 interrupt。
 *
 * @param stream documentMain / contractReviewMain 等返回的 SSE 流
 * @param options 取消信号
 * @returns 见 RunAndDrainResult
 */
export async function runAndDrainStream(
    stream: ReadableStream<Uint8Array>,
    options: RunAndDrainOptions = {},
): Promise<RunAndDrainResult> {
    const { signal } = options
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    let finalState: FinalValuesState | null = null
    let aborted = false
    let onAbort: (() => void) | null = null
    let buffer = ''

    /** 处理一批已解析事件，命中 interrupt 或 error 即返回结果。 */
    function consumeEvents(events: Array<{ event: string; data: unknown }>): RunAndDrainResult | null {
        for (const evt of events) {
            // LangGraph 的 toEventStream 在 graph 抛错时会 emit `event: error` 帧再 controller.close()
            // （pregel/stream.js:262-267）。若我们只看 values 事件，error 帧会被静默忽略 → 子流 done
            // → 调用方误以为成功。必须显式识别该帧并把 error 透传出去。
            if (evt.event === 'error') {
                const message = serializeErrorPayload(evt.data)
                return { success: false, finalState, error: message }
            }
            if (evt.event !== 'values') continue
            if (evt.data && typeof evt.data === 'object') {
                finalState = evt.data as FinalValuesState
                const interrupts = (finalState as any).__interrupt__
                if (Array.isArray(interrupts) && interrupts.length > 0) {
                    return {
                        success: true,
                        finalState,
                        interrupt: extractInterruptInfo(interrupts[0]),
                    }
                }
            }
        }
        return null
    }

    if (signal) {
        if (signal.aborted) {
            aborted = true
        } else {
            onAbort = () => {
                aborted = true
                // 主动 cancel 流（reader 已 lock，必须通过 reader.cancel 而非 stream.cancel）
                reader.cancel('aborted-by-runAndDrainStream').catch(() => { /* noop */ })
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }
    }

    try {
        if (aborted) {
            return { success: false, finalState, error: '取消信号触发' }
        }

        while (true) {
            let chunk: ReadableStreamReadResult<Uint8Array>
            try {
                chunk = await reader.read()
            } catch (err) {
                if (aborted) {
                    return { success: false, finalState, error: '取消信号触发' }
                }
                const message = err instanceof Error ? err.message : String(err)
                return { success: false, finalState, error: message }
            }

            if (chunk.done) break

            buffer += decoder.decode(chunk.value, { stream: true })
            const { events, remainder } = parseSSEAccumulator(buffer)
            buffer = remainder

            const hit = consumeEvents(events)
            if (hit) return hit

            // 在每个 chunk 处理完之后再检查 abort：保证 reader.read 已 unblock
            if (aborted) {
                return { success: false, finalState, error: '取消信号触发' }
            }
        }

        // flush decoder 缓冲（与 agentWorker 同处理）+ 已积累的 remainder
        buffer += decoder.decode()
        if (buffer.trim()) {
            // 没有最终 \n\n 的残余事件也尽量解析一次
            const padded = buffer.endsWith('\n\n') ? buffer : buffer + '\n\n'
            const { events } = parseSSEAccumulator(padded)
            const hit = consumeEvents(events)
            if (hit) return hit
        }

        if (aborted) {
            return { success: false, finalState, error: '取消信号触发' }
        }

        return { success: true, finalState }
    } finally {
        try { reader.releaseLock() } catch { /* already released */ }
        if (onAbort && signal) signal.removeEventListener('abort', onAbort)
    }
}

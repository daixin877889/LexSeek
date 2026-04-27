/**
 * runAndDrainStream 单测
 *
 * 通过手工构造 SSE ReadableStream 验证 4 个核心路径：
 * 1. 成功 drain：流正常结束，finalState 为最后一条 values
 * 2. 中途错误：流抛错，success=false，error 透出
 * 3. cancel 信号：abort 后立即返回 success=false，且不再吃后续事件
 * 4. interrupt 检测：含 __interrupt__ 的 values 立即返回，interrupt.type / value 解析正确
 *
 * **Feature: ai-unify-stage-5 / Task 1**
 */

import { describe, it, expect } from 'vitest'
import { runAndDrainStream } from '~~/server/services/agent-platform/subAgent/runAndDrain'

/** 把字符串 SSE 文本切成多个 chunk，模拟 agent.stream 的边界乱序。 */
function makeStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    let i = 0
    return new ReadableStream({
        pull(controller) {
            if (i >= chunks.length) {
                controller.close()
                return
            }
            controller.enqueue(encoder.encode(chunks[i]!))
            i += 1
        },
    })
}

function makeErrorStream(message: string, partialChunks: string[] = []): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    let i = 0
    return new ReadableStream({
        pull(controller) {
            if (i < partialChunks.length) {
                controller.enqueue(encoder.encode(partialChunks[i]!))
                i += 1
                return
            }
            controller.error(new Error(message))
        },
    })
}

describe('runAndDrainStream', () => {
    it('成功 drain：flag=success，finalState 为最后一条 values', async () => {
        const stream = makeStreamFromChunks([
            'event: messages\ndata: ["partial-1"]\n\n',
            'event: values\ndata: {"messages":[{"role":"ai","content":"first"}]}\n\n',
            'event: messages\ndata: ["partial-2"]\n\n',
            'event: values\ndata: {"messages":[{"role":"ai","content":"final"}],"structuredResponse":{"draftId":42}}\n\n',
        ])

        const result = await runAndDrainStream(stream)

        expect(result.success).toBe(true)
        expect(result.interrupt).toBeUndefined()
        expect(result.finalState).toMatchObject({
            structuredResponse: { draftId: 42 },
        })
        const messages = (result.finalState as any).messages as Array<{ content: string }>
        expect(messages.at(-1)?.content).toBe('final')
    })

    it('多 chunk 分裂的同一事件能被 decoder 流式拼接出来', async () => {
        const stream = makeStreamFromChunks([
            'event: values\ndata: {"messages":[{"role":"ai","content":"hel',
            'lo world"}]}\n\n',
        ])

        const result = await runAndDrainStream(stream)
        expect(result.success).toBe(true)
        const messages = (result.finalState as any).messages as Array<{ content: string }>
        expect(messages[0]!.content).toBe('hello world')
    })

    it('检测到 interrupt：立即返回，type / value 正确解析', async () => {
        const interruptValue = {
            type: 'template_select',
            payload: { recommendations: [{ id: 1, name: '解除劳动合同通知书' }] },
        }
        const stream = makeStreamFromChunks([
            'event: values\ndata: {"messages":[{"role":"ai","content":"thinking"}]}\n\n',
            `event: values\ndata: ${JSON.stringify({
                messages: [{ role: 'ai', content: 'asking' }],
                __interrupt__: [{ value: interruptValue, when: 'during', resumable: true, ns: ['root'] }],
            })}\n\n`,
            // 后面这段不应该被消费 —— 但为了健壮性测试，写出来
            'event: values\ndata: {"messages":[{"role":"ai","content":"after-interrupt"}]}\n\n',
        ])

        const result = await runAndDrainStream(stream)

        expect(result.success).toBe(true)
        expect(result.interrupt).toBeDefined()
        expect(result.interrupt!.type).toBe('template_select')
        expect(result.interrupt!.value).toMatchObject(interruptValue)
        // interrupt 之后停下：finalState 是含 __interrupt__ 的那条而非更后面的
        const lastMessage = (result.finalState as any).messages.at(-1)
        expect(lastMessage.content).toBe('asking')
    })

    it('流中途抛错：success=false 且 error 透出，已收集的 finalState 保留', async () => {
        const stream = makeErrorStream('upstream broken', [
            'event: values\ndata: {"messages":[{"role":"ai","content":"partial"}]}\n\n',
        ])

        const result = await runAndDrainStream(stream)
        expect(result.success).toBe(false)
        expect(result.error).toContain('upstream broken')
        // 抛错前已收的 values 仍保留
        expect(((result.finalState as any).messages as any[])[0].content).toBe('partial')
    })

    it('AbortSignal 触发 → success=false，error 提示取消', async () => {
        const controller = new AbortController()

        // 长寿流：每次 pull 异步 sleep 后才推一条事件，给 abort 留出窗口
        const encoder = new TextEncoder()
        let count = 0
        const stream = new ReadableStream<Uint8Array>({
            async pull(c) {
                await new Promise(r => setTimeout(r, 20))
                count += 1
                if (count > 200) {
                    c.close()
                    return
                }
                c.enqueue(encoder.encode(
                    `event: values\ndata: {"messages":[{"content":"chunk-${count}"}]}\n\n`,
                ))
            },
        })

        // 50ms 后 abort
        setTimeout(() => controller.abort(), 50)

        const result = await runAndDrainStream(stream, { signal: controller.signal })
        expect(result.success).toBe(false)
        expect(result.error).toContain('取消')
    })

    it('signal 启动前已 aborted：立即返回 success=false', async () => {
        const controller = new AbortController()
        controller.abort()

        const stream = makeStreamFromChunks([
            'event: values\ndata: {"messages":[{"content":"won-not-be-consumed"}]}\n\n',
        ])

        const result = await runAndDrainStream(stream, { signal: controller.signal })
        expect(result.success).toBe(false)
    })

    it('流中无 values 事件：finalState=null，success=true', async () => {
        const stream = makeStreamFromChunks([
            'event: messages\ndata: ["only-token-stream"]\n\n',
            'event: updates\ndata: {"node":"agent"}\n\n',
        ])

        const result = await runAndDrainStream(stream)
        expect(result.success).toBe(true)
        expect(result.finalState).toBeNull()
        expect(result.interrupt).toBeUndefined()
    })
})

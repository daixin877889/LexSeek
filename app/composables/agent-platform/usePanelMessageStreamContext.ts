/**
 * Chat Panel 消息流上下文 composable
 *
 * 把 3 个 panel（AssistantChatPanel / CaseDetailXiaosuo / ContractReviewPanel）setup
 * 阶段重复出现的「interrupt 快照 + resolveInterrupt + provide messageStreamContext +
 * watch sessionId clearResolved」整套逻辑抽出。
 *
 * 关键 invariant：LangGraph createAgent 路径下 sub-agent 工具内 throw 的 interrupt 必须
 * 按 toolCallId 路由，否则 interrupt() 返回 undefined，工具误以为用户取消。
 */

import { computed, provide, watch } from 'vue'
import type { Ref, ComputedRef, WatchSource } from 'vue'
import { useInterruptSnapshot } from './useInterruptSnapshot'
import { globalInterruptRegistry } from './interruptRegistry'

type InterruptDataLike = { type?: string; toolCallId?: unknown; [key: string]: unknown } | null | undefined

export interface PanelMessageStreamContextOptions {
    /** 当前活跃的 interrupt 数据；为 null 表示无 interrupt */
    interruptData: Ref<InterruptDataLike> | ComputedRef<InterruptDataLike>
    /** 触发 LangGraph stream.submit({ command: { resume } }) 的回调 */
    resumeInterrupt: (value: unknown) => void | Promise<void>
    /** sessionId 切换时清空快照（resolvedInterrupts 仅当前 session 内有效） */
    sessionRef: WatchSource<unknown>
}

export interface PanelMessageStreamContext {
    resolveInterrupt: (value: unknown) => Promise<void>
    isCurrentInterruptToolCard: ComputedRef<boolean>
}

export function usePanelMessageStreamContext(opts: PanelMessageStreamContextOptions): PanelMessageStreamContext {
    const { resolvedInterrupts, record: recordResolved, clear: clearResolved } = useInterruptSnapshot()

    async function resolveInterrupt(value: unknown) {
        const data = opts.interruptData.value
        recordResolved(data as { type?: string; toolCallId?: string; [key: string]: unknown } | null, value)
        const tcId = (data as { toolCallId?: unknown } | null)?.toolCallId
        if (typeof tcId === 'string' && tcId.length > 0) {
            await opts.resumeInterrupt({ [tcId]: value })
        } else {
            await opts.resumeInterrupt(value)
        }
    }

    provide('messageStreamContext', {
        interruptData: opts.interruptData,
        resolvedInterrupts,
        resolveInterrupt,
    })

    const isCurrentInterruptToolCard = computed(() => {
        const t = opts.interruptData.value?.type
        return typeof t === 'string' && globalInterruptRegistry.isToolCard(t)
    })

    watch(opts.sessionRef, () => clearResolved())

    return { resolveInterrupt, isCurrentInterruptToolCard }
}

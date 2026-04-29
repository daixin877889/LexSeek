/**
 * Interrupt 快照 helper
 *
 * 在 3 个 Panel（CaseDetailXiaosuo / AssistantChatPanel / ContractReviewPanel）
 * 各自的 setup 调用，提供 resolvedInterrupts reactive Record + record/clear helper。
 *
 * 数据用途：当用户在 isToolCard=true 的 interrupt 卡片上做出选择/取消后，
 * 把 interrupt payload + resumeValue 按 toolCallId 索引存起来，让消息流里
 * 对应位置的卡片冻结成 snapshot 视觉常驻显示（resolvedInterrupts 仅内存，
 * 切换 session 即清空，不持久化）。
 *
 * @see docs/superpowers/specs/2026-04-29-interrupt-tool-card-inline-design.md
 */

import { reactive } from 'vue'

export interface ResolvedInterruptEntry {
    interrupt: { type: string; toolCallId: string; [key: string]: unknown }
    resumeValue: unknown // null 表示用户取消
    resolvedAt: Date
}

export function useInterruptSnapshot() {
    const resolvedInterrupts = reactive<Record<string, ResolvedInterruptEntry>>({})

    /** 在 panel 的 resolveInterrupt 内调用（在 resumeInterrupt 之前调） */
    function record(
        interruptData: { type?: string; toolCallId?: string; [key: string]: unknown } | null,
        resumeValue: unknown,
    ): void {
        if (!interruptData?.toolCallId || !interruptData.type) return
        resolvedInterrupts[interruptData.toolCallId] = {
            interrupt: interruptData as ResolvedInterruptEntry['interrupt'],
            resumeValue,
            resolvedAt: new Date(),
        }
    }

    /** 切换 session 时调用 */
    function clear(): void {
        for (const k in resolvedInterrupts) {
            delete resolvedInterrupts[k]
        }
    }

    return { resolvedInterrupts, record, clear }
}

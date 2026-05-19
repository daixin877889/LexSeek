/**
 * 材料就绪进度推送辅助
 *
 * 把 ensureMaterials*Service 的 onProgress 快照转成 PREPARE_MATERIALS SSE 事件
 * （phase=start/progress/end），供案件 / 通用问答两个材料预处理中间件共用。
 *
 * 抑制规则：首次快照即"全部 ready"时整轮抑制（不 emit），避免二次分析 / 刷新重连
 * 时弹一个瞬间"已完成"的噪音卡片。
 */
import { createCustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'
import { SSECustomEventType } from '#shared/types/agentEvent'
import type {
    PrepareMaterialItem,
    PrepareMaterialsPayload,
} from '#shared/types/agentEvent'
import type { MaterialReadinessSnapshot } from '~~/server/services/material/materialPipeline.service'

type EmitFn = (event: { name: SSECustomEventType; data: PrepareMaterialsPayload }) => Promise<void>

export interface MaterialPrepareEmitter {
    /** 传给 ensureMaterials*Service 的进度回调 */
    onProgress: (snapshot: MaterialReadinessSnapshot[]) => Promise<void>
    /** 流水线结束后调用：若曾 emit 过 start 则补一条 phase=end */
    finalize: () => Promise<void>
}

/**
 * @param runId   非空才推送 SSE；null 时返回安全空操作
 * @param sessionId 会话标识
 * @param emitOverride 测试注入用；生产留空走 createCustomEventEmitter
 */
export function createMaterialPrepareEmitter(
    runId: string | null,
    sessionId: string,
    emitOverride?: EmitFn,
): MaterialPrepareEmitter {
    const emit: EmitFn | null = runId
        ? (emitOverride ?? (createCustomEventEmitter({ runId, sessionId }) as EmitFn))
        : null

    let started = false
    let suppressed = false
    let toolCallId: string | null = null
    let lastSnapshot: MaterialReadinessSnapshot[] = []

    const toItems = (s: MaterialReadinessSnapshot[]): PrepareMaterialItem[] =>
        s.map(x => ({ id: x.materialId, name: x.name, status: x.status }))

    const onProgress = async (snapshot: MaterialReadinessSnapshot[]) => {
        lastSnapshot = snapshot
        if (!emit) return

        if (!started && !suppressed) {
            if (snapshot.length > 0 && snapshot.every(s => s.status === 'ready')) {
                suppressed = true
                return
            }
        }
        if (suppressed) return

        if (!started) {
            started = true
            toolCallId = `prepare-${runId}`
            await emit({
                name: SSECustomEventType.PREPARE_MATERIALS,
                data: { phase: 'start', toolCallId, materials: toItems(snapshot) },
            })
        } else {
            await emit({
                name: SSECustomEventType.PREPARE_MATERIALS,
                data: { phase: 'progress', toolCallId: toolCallId!, materials: toItems(snapshot) },
            })
        }
    }

    const finalize = async () => {
        if (!emit || !started || !toolCallId) return
        const failedCount = lastSnapshot.filter(s => s.status === 'failed').length
        await emit({
            name: SSECustomEventType.PREPARE_MATERIALS,
            data: { phase: 'end', toolCallId, materials: toItems(lastSnapshot), failedCount },
        })
    }

    return { onProgress, finalize }
}

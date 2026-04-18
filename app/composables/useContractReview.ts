/**
 * 合同审查工作流 composable
 *
 * 基于 useStreamChat 的特化，面向合同审查的完整生命周期管理：
 * - onStart：创建审查 + 挂载 SSE
 * - mountReview：通过已有 reviewId 恢复
 * - onStance：立场选择后让 workflow 续跑（通过 stance 端点，不走 LangGraph command.resume）
 * - onDownload：下载已完成的批注版 .docx
 *
 * MVP 不含 onEditRisks / onRebuildDocx / 消息队列（M5 交付）。
 *
 * 参见 spec §11（合同审查）与 M4 plan Task 2。
 */
import type { contractReviews } from '~~/generated/prisma/client'
import type {
    CreateReviewRequest,
    CreateReviewResponse,
    StanceRequest,
    DownloadResponse,
} from '#shared/types/contract'

type ContractRunStatus = 'idle' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'

interface AwaitingStancePayload {
    partyA?: string
    partyB?: string
    contractType?: string
}

export function useContractReview() {
    const reviewId = ref<number | null>(null)
    const review = ref<contractReviews | null>(null)
    const runStatus = ref<ContractRunStatus>('idle')

    // 延迟创建，在 onStart / mountReview 获取 sessionId 后初始化
    const stream = shallowRef<ReturnType<typeof useStreamChat> | null>(null)
    // 上一个 stream 的 watcher 停止句柄，防止重启时泄漏
    let stopStreamWatch: (() => void) | null = null

    const messages = computed(() => stream.value?.messages.value ?? [])
    const isLoading = computed(() => stream.value?.isLoading.value ?? false)
    const error = computed(() => stream.value?.error.value ?? null)

    /** 从底层 stream 解包的 interrupt 载荷 */
    const interruptData = computed(() => stream.value?.interruptData.value ?? null)

    /**
     * interrupt.type === 'awaiting_stance' 时暴露 { partyA, partyB, contractType }，
     * 否则为 null。UI 层据此弹出立场选择对话框。
     */
    const awaitingStance = computed<AwaitingStancePayload | null>(() => {
        const d = interruptData.value as Record<string, unknown> | null
        if (!d || d.type !== 'awaiting_stance') return null
        return {
            partyA: typeof d.partyA === 'string' ? d.partyA : undefined,
            partyB: typeof d.partyB === 'string' ? d.partyB : undefined,
            contractType: typeof d.contractType === 'string' ? d.contractType : undefined,
        }
    })

    /** 静默拉取最新 review（stream 完成后用于回填 risks / summary / reviewedFileId） */
    async function refreshReview(id: number) {
        const latest = await useApiFetch<{ review: contractReviews }>(
            `/api/v1/assistant/contract/reviews/${id}`,
            { showError: false } as any,
        )
        if (latest?.review) review.value = latest.review
    }

    function mountStream(sessionId: string) {
        stopStreamWatch?.()

        const s = useStreamChat({
            apiUrl: '/api/v1/assistant/contract/chat',
            threadId: sessionId,
            messagesKey: 'messages',
        })
        stream.value = s

        // 后端 contractReviewPersistenceMiddleware 完成后未必推 SSE custom event，
        // 因此 completed/failed 时主动 GET 拉最新 review 写回（与 useDocumentDraft 一致）
        stopStreamWatch = watch(
            () => s.runStatus.value,
            async (status) => {
                if (status !== 'completed' && status !== 'failed') return
                if (!reviewId.value) return
                await refreshReview(reviewId.value)
            },
        )
    }

    async function onStart(payload: CreateReviewRequest) {
        // 立即切到 reviewing 态；失败由 useApiFetch 自身 toast 提示
        review.value = null
        reviewId.value = null
        stream.value = null
        runStatus.value = 'reviewing'

        const resp = await useApiFetch<CreateReviewResponse>(
            '/api/v1/assistant/contract/reviews',
            { method: 'POST', body: payload },
        )
        if (!resp) {
            runStatus.value = 'idle'
            return
        }

        reviewId.value = resp.reviewId
        mountStream(resp.sessionId)
        // submit 空输入：LangGraph checkpointer 从初始 state 推送后续消息
        stream.value!.submit(undefined)
    }

    /**
     * 二次进入工作区时通过已有 reviewId 恢复状态
     *
     * 失败静默：拉取失败返回 null，UI 层据此跳回列表或展示错误占位。
     */
    async function mountReview(id: number) {
        review.value = null
        reviewId.value = null
        stream.value = null

        const resp = await useApiFetch<{ review: contractReviews }>(
            `/api/v1/assistant/contract/reviews/${id}`,
            { showError: false } as any,
        )
        if (!resp?.review) return

        const r = resp.review
        review.value = r
        reviewId.value = r.id

        mountStream(r.sessionId)
        stream.value!.submit(undefined)
    }

    /**
     * 提交立场选择，让 workflow 从 INTERRUPTED 点续跑。
     *
     * **不使用** LangGraph `command.resume`：M3 的 /stance 端点已在服务端完成
     * INTERRUPTED → COMPLETED 释放 + enqueue 新 run，前端只需重新订阅 SSE。
     * 使用 command.resume 会与服务端重复入队，触发 agentRuns 的 P2002 唯一索引冲突。
     */
    async function onStance(payload: StanceRequest) {
        if (!reviewId.value) return
        if (!stream.value) return

        const result = await useApiFetch<{ reviewId: number; runId: number }>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/stance`,
            { method: 'POST', body: payload },
        )
        if (!result) return

        // 复位本地 runStatus 再 submit，保证 watch(runStatus) 的 completed/failed 分支能再次触发
        stream.value.runStatus.value = 'idle'
        stream.value.submit(undefined)
    }

    /** 拉取签名 URL 并通过隐藏 <a download> 触发浏览器下载 */
    async function onDownload() {
        if (!reviewId.value) return

        const result = await useApiFetch<DownloadResponse>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/download`,
        )
        if (!result?.downloadUrl) return

        const a = document.createElement('a')
        a.href = result.downloadUrl
        a.download = ''
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    /** 提交 interrupt resume 指令（M4 不主动调，保留接口给 M5 扩展用） */
    function resumeInterrupt(data: unknown) {
        if (!stream.value) return
        stream.value.runStatus.value = 'idle'
        stream.value.submit(undefined, { command: { resume: data } } as any)
    }

    /** 停止当前 stream */
    async function stopGeneration() {
        await stream.value?.stop()
    }

    onUnmounted(() => {
        stopStreamWatch?.()
    })

    return {
        // 状态
        reviewId,
        review,
        runStatus,
        messages,
        isLoading,
        error,
        interruptData,
        awaitingStance,
        // 动作
        onStart,
        mountReview,
        onStance,
        onDownload,
        resumeInterrupt,
        stopGeneration,
    }
}

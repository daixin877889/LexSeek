/**
 * 合同审查工作流 composable
 *
 * 基于 useStreamChat 的特化，面向合同审查的完整生命周期管理：
 * - onStart：创建审查 + 挂载 SSE
 * - mountReview：通过已有 reviewId 恢复
 * - onStance：立场选择后让 workflow 续跑（通过 stance 端点，不走 LangGraph command.resume）
 * - onDownload：下载已完成的批注版 .docx
 * - onEditRisks：debounce 500ms PATCH risks，成功后标记 hasUnsavedDocxChanges
 * - onRebuildDocx：重新生成批注 Word，成功后清标记 + 自动下载
 *
 * 参见 spec §11（合同审查）与 M4/M5 plan。
 */
import { useDebounceFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type {
    CreateReviewRequest,
    CreateReviewResponse,
    StanceRequest,
    DownloadResponse,
    RebuildDocxResponse,
    Risk,
    ReviewWithParsedRisks,
    ContractReviewEvent,
} from '#shared/types/contract'

type ContractRunStatus = 'idle' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'
type StageStepStatus = 'wait' | 'running' | 'done'

/** 类型守卫：判断 useStreamChat 透传过来的 unknown 是否为合同审查域的 custom event */
function isContractReviewCustomEvent(data: unknown): data is { name: 'contract_review'; data: unknown } {
    if (!data || typeof data !== 'object') return false
    const ev = data as { name?: unknown; data?: unknown }
    return ev.name === 'contract_review' && ev.data != null
}

interface AwaitingStancePayload {
    partyA?: string
    partyB?: string
    contractType?: string
}

export function useContractReview() {
    const reviewId = ref<number | null>(null)
    const review = ref<ReviewWithParsedRisks | null>(null)

    /**
     * 本次会话内是否编辑过 risks 且尚未重新生成 docx。
     * 仅本会话内有效，跨会话持久化登记留给 M6+。
     */
    const hasUnsavedDocxChanges = ref(false)

    // M6.1：阶段进度状态
    const stageStatus = ref<{
        detect: StageStepStatus
        stance: StageStepStatus
        segment: StageStepStatus
        analyze: StageStepStatus
        summarize: StageStepStatus
    }>({
        detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait',
    })
    const totalClauses = ref<number | null>(null)
    const analyzingClauseIndex = ref<number | null>(null)
    const analyzeWarnings = ref<string[]>([])

    /** review.status === 'rebuilding' 时 UI 禁用编辑 + 显示进度 */
    const isRebuilding = computed(() => review.value?.status === 'rebuilding')

    // 风险高亮三态 + 定位状态由 useContractRiskHighlight 提供，
    // 唯一消费者 ContractReviewPanel 自己调用并解构，避免在 useContractReview
    // 内部再持有一份重复 state。

    // 延迟创建，在 onStart / mountReview 获取 sessionId 后初始化
    const stream = shallowRef<ReturnType<typeof useStreamChat> | null>(null)
    // 上一个 stream 的 watcher 停止句柄，防止重启时泄漏
    let stopStreamWatch: (() => void) | null = null
    /**
     * useStream 内部会注册 onScopeDispose；但 mountStream 从 async 事件处理器中调用，
     * Vue 当前 active effect scope 已退出。用 detached effectScope 包裹，
     * 既能承接 onScopeDispose 的注册，又能在重启/卸载时显式 stop() 释放。
     */
    let streamScope: ReturnType<typeof effectScope> | null = null
    /**
     * stream 版本号。每次 mountStream 自增一次；
     * 所有跨 await 边界的 stream 事件回调（refreshReview、submit 后的状态切换）
     * 必须对 seen 与 current 做版本校验，避免快速切换 review 时旧 stream 的
     * completed/failed 事件触发 refreshReview，把新 review 的 risks 覆盖为 stale 数据。
     */
    let streamGeneration = 0

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

    /**
     * 合同审查 UI 态，完全派生自 stream.runStatus + awaitingStance：
     * - awaiting_stance 优先级最高（interrupt 未释放前一直显示）
     * - stream completed/failed 直接映射
     * - pending/running/interrupted 视为 reviewing
     * - 未挂载或 idle/cancelled 回 idle
     *
     * 采用派生化避免"本地 ref 设了 reviewing 但 stream 完成后忘记回写"的陷阱。
     */
    const runStatus = computed<ContractRunStatus>(() => {
        if (awaitingStance.value) return 'awaiting_stance'
        const s = stream.value?.runStatus.value
        if (s === 'completed') return 'completed'
        if (s === 'failed') return 'failed'
        if (s === 'pending' || s === 'running' || s === 'interrupted') return 'reviewing'
        return 'idle'
    })

    /**
     * 静默拉取最新 review（stream 完成后用于回填 risks / summary / reviewedFileId）。
     * UI-M5：失败时不再静默吞掉，toast 让用户感知（避免"重新生成批注后页面仍显示
     * 有未保存编辑"等假象）。
     */
    async function refreshReview(id: number): Promise<boolean> {
        const latest = await useApiFetch<{ review: ReviewWithParsedRisks }>(
            `/api/v1/assistant/contract/reviews/${id}`,
            { showError: false },
        )
        if (!latest?.review) {
            toast.error('刷新审查数据失败，请检查网络')
            return false
        }
        review.value = latest.review
        lastServerRisks = latest.review.risks ?? []
        if (typeof latest.review.hasUnsavedDocxChanges === 'boolean') {
            lastServerUnsaved = latest.review.hasUnsavedDocxChanges
        }
        return true
    }

    /**
     * M6.1：合同审查 SSE 自定义事件分发器
     * 由 mountStream 里的 onCustomEvent 调用。事件类型仅 4 种。
     */
    function handleContractEvent(event: ContractReviewEvent) {
        switch (event.type) {
            case 'stage': {
                stageStatus.value = {
                    ...stageStatus.value,
                    [event.stage]: event.status,
                }
                if (event.stage === 'segment' && event.status === 'done') {
                    totalClauses.value = event.totalClauses ?? null
                }
                if (event.stage === 'analyze' && event.status === 'done' && event.warnings?.length) {
                    analyzeWarnings.value = event.warnings
                    toast.warning(`${event.warnings.length} 条条款分析失败，已跳过`)
                }
                break
            }
            case 'progress': {
                analyzingClauseIndex.value = event.current
                if (event.error) {
                    toast.warning(`第 ${event.current} 条分析失败，已跳过：${event.error}`)
                }
                break
            }
            case 'risk': {
                // 子期 2 实现：把 risk 增量 append 到 review.risks
                if (review.value) {
                    const existing = review.value.risks ?? []
                    review.value = { ...review.value, risks: [...existing, event.risk] }
                }
                break
            }
            case 'overview': {
                // 子期 3 实现：替换 summary
                if (review.value) {
                    review.value = { ...review.value, summary: event.overview }
                }
                break
            }
        }
    }

    function mountStream(sessionId: string) {
        stopStreamWatch?.()
        streamScope?.stop()
        streamScope = effectScope(true)
        const myGeneration = ++streamGeneration

        let s!: ReturnType<typeof useStreamChat>
        streamScope.run(() => {
            s = useStreamChat({
                apiUrl: '/api/v1/assistant/contract/chat',
                threadId: sessionId,
                messagesKey: 'messages',
                onCustomEvent: (data: unknown) => {
                    // 后端 emitter 包装成 AgentCustomEvent = { type, runId, sessionId, name, data }
                    // useStreamChat 已过滤 status_change；剩余事件通过 data.name 识别归属
                    if (!isContractReviewCustomEvent(data)) return
                    const payload = data.data as { type?: string }
                    if (payload?.type && ['stage', 'progress', 'risk', 'overview'].includes(payload.type)) {
                        handleContractEvent(data.data as ContractReviewEvent)
                    }
                },
            })

            // 后端 contractReviewPersistenceMiddleware 完成后未必推 SSE custom event，
            // 因此 completed/failed 时主动 GET 拉最新 review 写回（与 useDocumentDraft 一致）
            stopStreamWatch = watch(
                () => s.runStatus.value,
                async (status) => {
                    if (status !== 'completed' && status !== 'failed') return
                    // 旧 stream 的事件若在 await 队列中晚于新 mountStream 到达，
                    // 绝不能触发 refreshReview 污染新 review。
                    if (myGeneration !== streamGeneration) return
                    if (!reviewId.value) return
                    if (status === 'failed') {
                        // 覆盖两种场景：SSE 网络中断 / 后端 workflow 解析失败
                        // 文案统一，UI 层 statusLabel 会显示"审查失败"，此 toast 兜底
                        // 避免用户切屏/滚动时完全错过失败事件
                        toast.error('审查未能完成，请刷新页面或稍后重试')
                    }
                    await refreshReview(reviewId.value)
                },
            )
        })
        stream.value = s

        return s
    }

    async function onStart(payload: CreateReviewRequest) {
        // 失败路径下旧 watcher 需要即时释放（mountStream 内部也会调，这里保证失败分支同样清理）
        stopStreamWatch?.()
        review.value = null
        reviewId.value = null
        stream.value = null
        hasUnsavedDocxChanges.value = false
        lastServerRisks = null
        lastServerUnsaved = false

        const resp = await useApiFetch<CreateReviewResponse>(
            '/api/v1/assistant/contract/reviews',
            { method: 'POST', body: payload },
        )
        if (!resp) return

        reviewId.value = resp.reviewId
        const s = mountStream(resp.sessionId)
        // submit 空输入：LangGraph checkpointer 从初始 state 推送后续消息
        try {
            await s.submit(undefined)
        } catch (err) {
            console.warn('合同审查流启动失败', err)
            toast.error('连接中断，请刷新页面重试')
        }
    }

    /**
     * 二次进入工作区时通过已有 reviewId 恢复状态
     *
     * 失败静默：拉取失败返回 null，UI 层据此跳回列表或展示错误占位。
     */
    async function mountReview(id: number) {
        stopStreamWatch?.()
        review.value = null
        reviewId.value = null
        stream.value = null
        hasUnsavedDocxChanges.value = false
        lastServerRisks = null
        lastServerUnsaved = false

        const resp = await useApiFetch<{ review: ReviewWithParsedRisks }>(
            `/api/v1/assistant/contract/reviews/${id}`,
            { showError: false },
        )
        if (!resp?.review) return

        const r = resp.review
        review.value = r
        reviewId.value = r.id
        lastServerRisks = r.risks ?? []
        lastServerUnsaved = typeof r.hasUnsavedDocxChanges === 'boolean' ? r.hasUnsavedDocxChanges : false

        // 根据 review.status 回填 stageStatus，避免挂载历史 review 时 5 段 dot 仍为灰色。
        // SSE 流事件只覆盖当前会话期间的阶段切换，挂载已有 review 需从 status 推断历史进度。
        if (r.status === 'completed' || r.status === 'rebuilding' || r.status === 'failed') {
            // 终态：五段全部 done（failed 也视为"流程已走完、只是结果标记失败"）
            stageStatus.value = {
                detect: 'done', stance: 'done', segment: 'done', analyze: 'done', summarize: 'done',
            }
            totalClauses.value = Array.isArray(r.risks) ? r.risks.length : null
        } else if (r.status === 'reviewing') {
            // 进行中：识别/立场已经完成，切分至少走到；analyze 视为 running
            stageStatus.value = {
                detect: 'done', stance: 'done', segment: 'done', analyze: 'running', summarize: 'wait',
            }
        } else if (r.status === 'awaiting_stance') {
            // 等立场：识别已完成，立场 running
            stageStatus.value = {
                detect: 'done', stance: 'running', segment: 'wait', analyze: 'wait', summarize: 'wait',
            }
        }
        // pending 保持初始全 wait

        // 回填持久化的未保存标志：仅在字段为明确 boolean 时覆盖（M6.1A-e）
        // 不同 status 下该字段可能为 null/undefined，避免误改写 ref
        if (typeof review.value?.hasUnsavedDocxChanges === 'boolean') {
            hasUnsavedDocxChanges.value = review.value.hasUnsavedDocxChanges
        }

        const s = mountStream(r.sessionId)
        try {
            await s.submit(undefined)
        } catch (err) {
            console.warn('合同审查流续订失败', err)
            toast.error('连接中断，请刷新页面重试')
        }
    }

    /**
     * 提交立场选择，让 workflow 从 INTERRUPTED 点续跑。
     *
     * **不使用** LangGraph `command.resume`：M3 的 /stance 端点已在服务端完成
     * INTERRUPTED → COMPLETED 释放 + enqueue 新 run，前端只需重新订阅 SSE。
     * 使用 command.resume 会与服务端重复入队，触发 agentRuns 的 P2002 唯一索引冲突。
     */
    /**
     * 立场选择提交。成功返回 true，任意分支失败返回 false。
     * 调用方据此决定是否允许用户重试（例如 Dialog 关闭态）。
     */
    async function onStance(payload: StanceRequest): Promise<boolean> {
        if (!reviewId.value) return false
        if (!stream.value) return false

        const result = await useApiFetch<{ reviewId: number; runId: number }>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/stance`,
            { method: 'POST', body: payload },
        )
        if (!result) return false
        // await 期间 stream 可能已被 cancelReview / 路由切换置空
        if (!stream.value) return false

        // UI-H6：用 useStreamChat.reset() 替代越界写 runStatus.value，避免依赖私有 ref
        stream.value.reset()
        try {
            await stream.value.submit(undefined)
            return true
        } catch (err) {
            console.warn('立场提交后续订失败', err)
            toast.error('连接中断，请重试')
            return false
        }
    }

    /**
     * 用户编辑 risks：
     *   1. 立即乐观更新 review.risks + 置 hasUnsavedDocxChanges=true，UI 不等待网络
     *   2. debounce 500ms 后 PATCH 到后端，失败回滚到 pre-edit 快照（risks + hasUnsavedDocxChanges）
     *
     * lastServerRisks 在 mountReview/refreshReview 时同步 baseline，
     * 保证连续编辑并于最后一次 PATCH 失败时能回到"最后一次服务端确认"的状态。
     */
    let lastServerRisks: Risk[] | null = null
    let lastServerUnsaved: boolean | null = null

    const patchRisks = useDebounceFn(async (risks: Risk[]) => {
        if (!reviewId.value) return
        const risksSnapshot = lastServerRisks ?? (review.value?.risks ?? [])
        const unsavedSnapshot = lastServerUnsaved ?? false
        const resp = await useApiFetch<{ reviewId: number }>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}`,
            { method: 'PATCH', body: { risks }, showError: false },
        )
        if (!resp) {
            if (review.value) {
                review.value = { ...review.value, risks: risksSnapshot }
            }
            hasUnsavedDocxChanges.value = unsavedSnapshot
            toast.error('保存风险清单失败')
            return
        }
        lastServerRisks = risks
        lastServerUnsaved = true
    }, 500)

    function onEditRisks(risks: Risk[]) {
        if (!reviewId.value) return
        // 立即乐观更新，避免用户连续编辑时因 debounce 延迟导致 UI 闪回旧值
        if (review.value) {
            review.value = { ...review.value, risks }
        }
        hasUnsavedDocxChanges.value = true
        patchRisks(risks)
    }

    /**
     * 根据最新 risks 触发后端重新生成批注 Word，成功后自动下载新文件。
     *
     * 关键行为：
     * - 入口立即 toast.info 等待中（rebuild 耗时 > 10s 常见）
     * - 用 useBusinessErrorCapture 捕获业务码，区分 429（占位中）vs 500（失败）
     * - 成功：刷 review + hasUnsavedDocxChanges=false + toast.success + <a download> 触发浏览器下载
     */
    async function onRebuildDocx() {
        if (!reviewId.value) return
        toast.info('批注正在重新生成，请稍候...')

        const capture = useBusinessErrorCapture()
        const resp = await useApiFetch<RebuildDocxResponse>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/rebuild-docx`,
            {
                method: 'POST',
                showError: false,
                onBusinessError: capture.onBusinessError,
            },
        )
        if (!resp) {
            if (capture.code.value === 429) toast.warning('批注正在重新生成中，请稍候')
            else toast.error('重新生成批注失败，请稍后重试')
            return
        }

        await refreshReview(reviewId.value)
        hasUnsavedDocxChanges.value = false
        toast.success('批注已重新生成')

        // 必须传 filename，否则浏览器会用 URL 最后一段（rebuild-xxx-uuid.docx）当文件名
        triggerBrowserDownloadUrl(resp.downloadUrl, resp.filename)
    }

    // PDF 导出 + 批注版 docx 下载，见 useContractReviewExport
    const { isExportingPdf, onExportPdf, onDownload } = useContractReviewExport(reviewId)

    /** 停止当前 stream */
    async function stopGeneration() {
        await stream.value?.stop()
    }

    /**
     * 取消当前审查：停 stream + 清 watcher + 复位 review/reviewId。
     *
     * 场景：立场选择对话框点击"取消"→ 放弃整个审查，UI 回到提交屏。
     * 不删除后端记录（M4 不做回滚），仅前端清态；用户可通过"我的审查"列表再进入。
     */
    async function cancelReview() {
        await stream.value?.stop()
        stopStreamWatch?.()
        stopStreamWatch = null
        streamScope?.stop()
        streamScope = null
        stream.value = null
        review.value = null
        reviewId.value = null
        lastServerRisks = null
        lastServerUnsaved = false
    }

    onUnmounted(() => {
        stopStreamWatch?.()
        streamScope?.stop()
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
        hasUnsavedDocxChanges,
        isRebuilding,
        // M6.1 阶段进度状态
        stageStatus,
        totalClauses,
        analyzingClauseIndex,
        analyzeWarnings,
        // 动作
        onStart,
        mountReview,
        onStance,
        isExportingPdf,
        onDownload,
        onExportPdf,
        onEditRisks,
        onRebuildDocx,
        stopGeneration,
        cancelReview,
        handleContractEvent,
    }
}

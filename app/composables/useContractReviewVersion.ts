/**
 * 合同审查版本管理 composable
 *
 * 承担"工作区实时编辑 + 历史版本管理"的前端状态层：
 * - refreshWorkspace / refreshVersions：从服务端拉取最新状态
 * - enterPreview / exitPreview：切换只读历史版本模式
 * - saveNewVersion：手动保存 lawyer_save 版本快照
 * - updateRiskArchivedStatus / addLawyerAnnotation / deleteAnnotation：离散动作直连 API
 * - updateAnnotation：批注内容编辑走 debounce 500ms，合并高频输入
 * - updateVersionNote：更新版本备注
 * - uploadNewVersion：客户回传 docx，通过 SSE 流实时返回各步骤进度
 *
 * 只读态守护：previewVersionId !== null 时，所有编辑动作静默返回不发请求。
 */
import { useDebounceFn } from '@vueuse/core'
import type {
    ContractRiskEntity,
    ContractAnnotationEntity,
    ContractReviewVersionEntity,
    ContractReviewVersionSnapshotResponse,
    RiskArchivedStatus,
    UploadVersionStep,
    UploadVersionProgressData,
    UploadVersionCompleteData,
    UploadVersionErrorData,
} from '#shared/types/contract'
import { CONTRACT_UPLOAD_VERSION_SSE_EVENT } from '#shared/types/contract'

// ===== 上传新版本：步骤状态类型 =====

export type StepStatus = 'idle' | 'progress' | 'done' | 'error'

export interface StepState {
    key: UploadVersionStep
    label: string
    status: StepStatus
}

const UPLOAD_STEP_LABELS: Record<UploadVersionStep, string> = {
    backup: '备份当前版本',
    parse: '解析新文档',
    diff: '对比变更',
    ai: 'AI 分析',
    merge: '合并与更新',
}

const UPLOAD_STEP_KEYS: UploadVersionStep[] = ['backup', 'parse', 'diff', 'ai', 'merge']

export interface WorkspaceState {
    risks: ContractRiskEntity[]
    annotations: ContractAnnotationEntity[]
    currentVersionId: number | null
    maxVersionNo: number
}

/**
 * GET /reviews/:id 响应形态。
 *
 * 注意：后端 handler（server/api/v1/assistant/contract/reviews/[id].get.ts）返回
 * `{ review: { ... } }` 的嵌套结构，不是扁平对象。过去这里曾误按扁平解构，
 * 导致 workspace 永远是空，UI 走 Phase A JSON 回退，最终表现为"全部未定位"。
 */
type ReviewPayload = {
    risks: Array<ContractRiskEntity & { annotations?: ContractAnnotationEntity[] }>
    currentVersionId: number | null
    maxVersionNo: number
}
type WorkspaceApiResponse = {
    review: ReviewPayload
}

/** 返回 ISO 时间字符串数组中最大时间戳（毫秒），空数组返回 0 */
function maxTimestamp(dates: string[]): number {
    return dates.reduce((acc, d) => {
        const t = new Date(d).getTime()
        return t > acc ? t : acc
    }, 0)
}

export function useContractReviewVersion(reviewId: Ref<number>) {
    const workspace = ref<WorkspaceState>({
        risks: [],
        annotations: [],
        currentVersionId: null,
        maxVersionNo: 0,
    })
    const versions = ref<ContractReviewVersionEntity[]>([])
    /** null = 工作区；number = 只读历史版本 */
    const previewVersionId = ref<number | null>(null)
    const previewSnapshot = ref<ContractReviewVersionSnapshotResponse | null>(null)

    /** 上传新版本完成后的结果摘要，用于显示"本轮变化"横幅 */
    const lastUploadResult = ref<{ newVersionId: number; summary: string } | null>(null)

    /** 关闭"本轮变化"横幅 */
    function dismissUploadBanner() {
        lastUploadResult.value = null
    }

    const isReadOnly = computed(() => previewVersionId.value !== null)

    /** 当前渲染视图：工作区或历史快照 */
    const currentView = computed(() => {
        if (previewSnapshot.value) {
            return {
                risks: previewSnapshot.value.snapshot.risks,
                annotations: previewSnapshot.value.snapshot.annotations,
                docxText: previewSnapshot.value.snapshot.docxText,
            }
        }
        return {
            risks: workspace.value.risks,
            annotations: workspace.value.annotations,
            docxText: '',
        }
    })

    /** 从服务端拉取工作区数据，摊平 annotations */
    async function refreshWorkspace() {
        const resp = await useApiFetch<WorkspaceApiResponse>(`/api/v1/assistant/contract/reviews/${reviewId.value}`)
        // bug #20：后端返回 { review: {...} }，此前错误地当作扁平结构解构，
        // 导致 workspace.risks 恒为空、UI 回退到 Phase A legacy JSON，出现全部"未定位"。
        const payload = resp?.review
        if (!payload) return
        const risksWithAnnotations = payload.risks ?? []
        workspace.value.risks = risksWithAnnotations.map(({ annotations: _annotations, ...rest }) => rest)
        workspace.value.annotations = risksWithAnnotations.flatMap(r => r.annotations ?? [])
        workspace.value.currentVersionId = payload.currentVersionId ?? null
        workspace.value.maxVersionNo = payload.maxVersionNo ?? 0
    }

    /** 从服务端拉取版本列表 */
    async function refreshVersions() {
        const resp = await useApiFetch<{ versions: ContractReviewVersionEntity[] }>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/versions`,
        )
        if (!resp) return
        versions.value = resp.versions
    }

    /** 进入历史版本只读模式，拉取完整快照 */
    async function enterPreview(versionId: number) {
        const snap = await useApiFetch<ContractReviewVersionSnapshotResponse>(
            `/api/v1/assistant/contract/reviews/versions/${versionId}`,
        )
        if (!snap) return
        previewVersionId.value = versionId
        previewSnapshot.value = snap
    }

    /** 退出只读模式，回到工作区 */
    function exitPreview() {
        previewVersionId.value = null
        previewSnapshot.value = null
    }

    /** 保存新版本（lawyer_save 类型），成功后刷新工作区和版本列表 */
    async function saveNewVersion(lawyerNote?: string | null): Promise<boolean> {
        if (isReadOnly.value) return false
        const resp = await useApiFetch(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/versions`,
            { method: 'POST', body: { lawyerNote: lawyerNote ?? null } },
        )
        if (!resp) return false
        await Promise.all([refreshWorkspace(), refreshVersions()])
        return true
    }

    /** 处置风险（离散动作，直接 PATCH，不 debounce） */
    async function updateRiskArchivedStatus(riskId: number, archivedStatus: RiskArchivedStatus | null) {
        if (isReadOnly.value) return
        const resp = await useApiFetch(
            `/api/v1/assistant/contract/reviews/risks/${riskId}`,
            { method: 'PATCH', body: { archivedStatus } },
        )
        if (resp) {
            const archivedAt = archivedStatus ? new Date().toISOString() : null
            workspace.value.risks = workspace.value.risks.map(r =>
                r.id === riskId ? { ...r, archivedStatus, archivedAt } : r,
            )
        }
    }

    /** 新增律师批注（离散动作，直接 POST） */
    async function addLawyerAnnotation(
        riskId: number,
        content: string,
        parentAnnotationId?: number,
    ): Promise<ContractAnnotationEntity | null> {
        if (isReadOnly.value) return null
        const resp = await useApiFetch<ContractAnnotationEntity>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/annotations`,
            { method: 'POST', body: { riskId, content, parentAnnotationId: parentAnnotationId ?? null } },
        )
        if (resp) workspace.value.annotations.push(resp)
        return resp
    }

    // 批注内容编辑 pending map：多次击键合并成一次 PATCH（500ms debounce）
    const pendingAnnotationContent = new Map<number, string>()

    const flushAnnotationContent = useDebounceFn(async () => {
        // 切到历史版本或已卸载场景下丢弃 pending，避免错误写回
        if (isReadOnly.value || pendingAnnotationContent.size === 0) {
            pendingAnnotationContent.clear()
            return
        }
        const entries = Array.from(pendingAnnotationContent.entries())
        pendingAnnotationContent.clear()
        await Promise.all(entries.map(async ([annotationId, content]) => {
            const resp = await useApiFetch(
                `/api/v1/assistant/contract/reviews/annotations/${annotationId}`,
                { method: 'PATCH', body: { content } },
            )
            if (resp) {
                workspace.value.annotations = workspace.value.annotations.map(a =>
                    a.id === annotationId ? { ...a, content } : a,
                )
            }
        }))
    }, 500)

    /** 编辑批注内容（走 debounce，高频输入合并后统一提交） */
    async function updateAnnotation(annotationId: number, content: string) {
        if (isReadOnly.value) return
        workspace.value.annotations = workspace.value.annotations.map(a =>
            a.id === annotationId ? { ...a, content } : a,
        )
        pendingAnnotationContent.set(annotationId, content)
        flushAnnotationContent()
    }

    /** 软删批注（离散动作，直接 DELETE；服务端走 deletedAt，不物理删） */
    async function deleteAnnotation(annotationId: number) {
        if (isReadOnly.value) return
        const resp = await useApiFetch(
            `/api/v1/assistant/contract/reviews/annotations/${annotationId}`,
            { method: 'DELETE' },
        )
        if (resp) {
            workspace.value.annotations = workspace.value.annotations.filter(a => a.id !== annotationId)
        }
    }

    /**
     * 恢复推送（spec §12.6）：客户删过的批注由律师手动恢复为"下次导出依然写入"。
     * 服务端将 suppressInExport 置 false、removedByClient=true 保留作历史证据。
     */
    async function restoreAnnotationPush(annotationId: number) {
        if (isReadOnly.value) return
        const resp = await useApiFetch(
            `/api/v1/assistant/contract/reviews/annotations/${annotationId}/restore`,
            { method: 'PATCH' },
        )
        if (resp) {
            workspace.value.annotations = workspace.value.annotations.map(a =>
                a.id === annotationId ? { ...a, suppressInExport: false } : a,
            )
        }
    }

    /**
     * 客户回传 docx：通过 SSE 流驱动 5 步骤处理（backup→parse→diff→ai→merge）。
     * 立即返回响应式状态 refs，SSE 消费在后台异步进行。
     * 使用 fetch + ReadableStream 消费 POST SSE（EventSource 不支持 POST body）。
     */
    async function uploadNewVersion(ossFileId: number): Promise<{
        steps: Ref<StepState[]>
        done: Ref<boolean>
        result: Ref<{ newVersionId: number; summary: string } | null>
        error: Ref<{ step: string; message: string } | null>
    }> {
        const steps = ref<StepState[]>(
            UPLOAD_STEP_KEYS.map(key => ({ key, label: UPLOAD_STEP_LABELS[key], status: 'idle' as StepStatus }))
        )
        const done = ref(false)
        const result = ref<{ newVersionId: number; summary: string } | null>(null)
        const error = ref<{ step: string; message: string } | null>(null)

        void (async () => {
            try {
                const resp = await fetch(
                    `/api/v1/assistant/contract/reviews/${reviewId.value}/upload-version`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ossFileId }),
                    }
                )

                if (!resp.ok || !resp.body) {
                    error.value = { step: 'backup', message: resp.ok ? '服务器返回空响应' : `服务器错误 (${resp.status})` }
                    return
                }

                const reader = resp.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ''

                while (true) {
                    const { value, done: streamDone } = await reader.read()
                    if (streamDone) break
                    buffer += decoder.decode(value, { stream: true })

                    const parts = buffer.split('\n\n')
                    buffer = parts.pop() ?? ''

                    for (const part of parts) {
                        if (!part.trim()) continue
                        const lines = part.split('\n')
                        let eventName = ''
                        let dataStr = ''
                        for (const line of lines) {
                            if (line.startsWith('event: ')) eventName = line.slice(7).trim()
                            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim()
                        }
                        if (!eventName || !dataStr) continue

                        try {
                            const data = JSON.parse(dataStr)

                            if (eventName === CONTRACT_UPLOAD_VERSION_SSE_EVENT.PROGRESS) {
                                const p = data as UploadVersionProgressData
                                steps.value = steps.value.map(s =>
                                    s.key === p.step ? { ...s, status: p.status === 'done' ? 'done' : 'progress' } : s
                                )
                            } else if (eventName === CONTRACT_UPLOAD_VERSION_SSE_EVENT.COMPLETE) {
                                const c = data as UploadVersionCompleteData
                                result.value = { newVersionId: c.newVersionId, summary: c.summary }
                                lastUploadResult.value = { newVersionId: c.newVersionId, summary: c.summary }
                                done.value = true
                            } else if (eventName === CONTRACT_UPLOAD_VERSION_SSE_EVENT.ERROR) {
                                const e = data as UploadVersionErrorData
                                steps.value = steps.value.map(s =>
                                    s.key === e.step ? { ...s, status: 'error' } : s
                                )
                                error.value = { step: e.step, message: e.message }
                            }
                        } catch {
                            // 忽略无法解析的 SSE 事件
                        }
                    }
                }
            } catch (e) {
                error.value = { step: 'backup', message: e instanceof Error ? e.message : '连接失败' }
            }
        })()

        return { steps, done, result, error }
    }

    /** 更新版本备注（不受 isReadOnly 约束，历史版本也可加备注） */
    async function updateVersionNote(versionId: number, lawyerNote: string | null) {
        const resp = await useApiFetch(
            `/api/v1/assistant/contract/reviews/versions/${versionId}`,
            { method: 'PATCH', body: { lawyerNote } },
        )
        if (resp) {
            versions.value = versions.value.map(v =>
                v.id === versionId ? { ...v, lawyerNote } : v,
            )
        }
    }

    /**
     * 工作区是否有相对最新版本的未保存编辑。
     * Phase A 启发式近似：取 risks/annotations 最新时间 vs 当前版本快照 createdAt 对比。
     */
    const hasUnsavedEdits = computed(() => {
        if (isReadOnly.value) return false
        if (!workspace.value.currentVersionId) return false
        const latestEdit = Math.max(
            maxTimestamp(workspace.value.risks.map(r => r.updatedAt)),
            maxTimestamp(workspace.value.annotations.map(a => a.createdAt)),
        )
        const currentVer = versions.value.find(v => v.id === workspace.value.currentVersionId)
        if (!currentVer) return false
        return latestEdit > new Date(currentVer.createdAt).getTime()
    })

    return {
        workspace,
        versions,
        previewVersionId,
        previewSnapshot,
        isReadOnly,
        currentView,
        hasUnsavedEdits,
        lastUploadResult,
        dismissUploadBanner,
        refreshWorkspace,
        refreshVersions,
        enterPreview,
        exitPreview,
        saveNewVersion,
        updateRiskArchivedStatus,
        addLawyerAnnotation,
        updateAnnotation,
        deleteAnnotation,
        restoreAnnotationPush,
        updateVersionNote,
        uploadNewVersion,
    }
}

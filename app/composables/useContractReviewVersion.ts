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
} from '#shared/types/contract'

export interface WorkspaceState {
    risks: ContractRiskEntity[]
    annotations: ContractAnnotationEntity[]
    currentVersionId: number | null
    maxVersionNo: number
}

/** GET /reviews/:id 响应中每条 risk 附带内联 annotations */
type WorkspaceApiResponse = {
    risks: Array<ContractRiskEntity & { annotations?: ContractAnnotationEntity[] }>
    currentVersionId: number | null
    maxVersionNo: number
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
        if (!resp) return
        const risksWithAnnotations = resp.risks ?? []
        workspace.value.risks = risksWithAnnotations.map(({ annotations: _annotations, ...rest }) => rest)
        workspace.value.annotations = risksWithAnnotations.flatMap(r => r.annotations ?? [])
        workspace.value.currentVersionId = resp.currentVersionId ?? null
        workspace.value.maxVersionNo = resp.maxVersionNo ?? 0
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
        refreshWorkspace,
        refreshVersions,
        enterPreview,
        exitPreview,
        saveNewVersion,
        updateRiskArchivedStatus,
        addLawyerAnnotation,
        updateAnnotation,
        deleteAnnotation,
        updateVersionNote,
    }
}

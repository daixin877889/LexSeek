/**
 * 文书草稿字段管理 sub-composable
 *
 * 职责：
 * - mountDraft：通过 draftId 加载已有草稿 + 模板，决定是否需要回放历史 SSE
 * - onFieldChange：用户编辑字段值时累积变更，debounce 500ms 后批量 PATCH
 * - flushPendingFields：单 debounce 统一 flush，避免"覆盖前一次参数"丢字段 bug
 *
 * 拆自：useDocumentDraft.ts 行 165-248（mountDraft + onFieldChange + flushPendingFields + pendingFieldValues）
 *
 * 设计要点：
 * - draftId 由父级（薄包装）以 Ref 形式传入，本 composable 内部仅 read
 * - mountDraft 返回 { needsCheckpointReplay } 让父级决定是否对 stream 调 submit(undefined)
 *   （拆出后本 composable 不再持有 stream 引用，调度由薄包装做）
 */
import { useDebounceFn } from '@vueuse/core'
import type { Ref } from 'vue'
import type { documentDrafts } from '~~/generated/prisma/client'
import type {
  DocumentTemplate,
  PatchDraftRequest,
} from '#shared/types/document'
import { useApiFetch } from '~/composables/useApiFetch'

export interface DocumentDraftFieldsConfig {
  /** 草稿 ID（由父级 / 路由提供，单 session 模式） */
  draftId: Ref<number | null>
}

export interface MountDraftResult {
  /** 加载到的 draft（失败时为 null） */
  draft: documentDrafts | null
  /** 加载到的 template（失败或 templateId 缺失时为 null） */
  template: DocumentTemplate | null
  /** 是否需要 stream.submit(undefined) 回放 checkpoint */
  needsCheckpointReplay: boolean
  /** sessionId（用于父级 mountStream） */
  sessionId: string | null
}

export function useDocumentDraftFields(config: DocumentDraftFieldsConfig) {
  const { draftId } = config

  const draft = ref<documentDrafts | null>(null)
  const template = ref<DocumentTemplate | null>(null)

  /**
   * 二次进入工作区时通过已有 draftId 恢复状态
   *
   * 与 onStart 区别：不创建新 draft，仅拉取 draft + template，
   * 并返回 needsCheckpointReplay 让父级决定是否触发 stream.submit(undefined)
   * 回放历史消息（避免对全新且无材料的草稿空跑 Agent）。
   */
  async function mountDraft(id: number): Promise<MountDraftResult> {
    draft.value = null
    template.value = null

    // 后端 getDraftService 返回 `{ draft }` 嵌套结构，useApiFetch 自动拆 data，
    // 所以这里仍需显式拆一层 draft
    const resp = await useApiFetch<{ draft: documentDrafts }>(
      `/api/v1/assistant/document/drafts/${id}`,
    )
    if (!resp?.draft) {
      return { draft: null, template: null, needsCheckpointReplay: false, sessionId: null }
    }
    const draftResp = resp.draft
    draft.value = draftResp

    const tpl = await useApiFetch<DocumentTemplate>(
      `/api/v1/assistant/document/templates/${draftResp.templateId}`,
      { showError: false },
    )
    if (tpl) template.value = tpl

    // 仅在确实存在 checkpoint 时才 submit(undefined) 回放历史；
    // 全新且无材料的草稿（sourceRef 为 null）从未跑过 Agent，submit 会触发空跑
    const sourceRef = draftResp.sourceRef as { text?: string; fileIds?: number[] } | null
    const hasMaterial = !!sourceRef?.text || (sourceRef?.fileIds?.length ?? 0) > 0
    const hasReadyValues = draftResp.status === 'ready'
      && Object.keys((draftResp.values ?? {}) as Record<string, unknown>).length > 0
    const RAN_STATUSES = new Set<string>(['exported', 'failed', 'drafting', 'filling'])
    const hasEverRun = hasMaterial || hasReadyValues || RAN_STATUSES.has(draftResp.status)

    return {
      draft: draftResp,
      template: tpl ?? null,
      needsCheckpointReplay: hasEverRun,
      sessionId: draftResp.sessionId ?? null,
    }
  }

  // 按字段累积待提交变更 + 单 debounce 统一 flush，避免旧实现的"单 debounce
  // 覆盖前一次参数 → 多字段连续改动只 PATCH 最后一字段"丢字段 bug。
  const pendingFieldValues = ref<Record<string, string | null>>({})

  const flushPendingFields = useDebounceFn(async () => {
    if (!draftId.value) return
    const snapshot = pendingFieldValues.value
    if (Object.keys(snapshot).length === 0) return
    // 清空后 await，在飞行中若用户继续编辑，新变更重新进入下一次累积窗口
    pendingFieldValues.value = {}
    const body: PatchDraftRequest = { values: snapshot }
    // 409 表示正在生成中，showError: false 由调用方决定如何展示
    // 后端 patchDraftService 返回 `{ draft }` 嵌套结构，与 getDraftService 一致，
    // 这里需要显式拆一层 draft，否则 draft.value 会变成 { draft: {...} }。
    const result = await useApiFetch<{ draft: documentDrafts }>(
      `/api/v1/assistant/document/drafts/${draftId.value}`,
      { method: 'PATCH', body, showError: false },
    )
    if (result?.draft) draft.value = result.draft
  }, 500)

  function onFieldChange(fieldName: string, value: string | null) {
    if (!draftId.value) return
    pendingFieldValues.value = { ...pendingFieldValues.value, [fieldName]: value }
    flushPendingFields()
  }

  return {
    draft,
    template,
    pendingFieldValues,
    mountDraft,
    onFieldChange,
    flushPendingFields,
  }
}

/**
 * 文书草稿快照管理 sub-composable
 *
 * 职责：列出 / 应用工作区备份快照（workspace-backup）
 *
 * 拆自：useDocumentDraft.ts 行 427-446
 *
 * 设计要点：
 * - applySnapshot 返回最新 draft 让父级写回 draft.value
 *   父级在写回后再调 loadSnapshots（恢复操作可能产生新快照）
 *   避免与 versions 双向耦合
 */
import type { Ref } from 'vue'
import type { documentDrafts } from '~~/generated/prisma/client'
import type { DocumentDraftSnapshot } from '#shared/types/document'
import { useApiFetch } from '~/composables/useApiFetch'

export interface DocumentDraftSnapshotsConfig {
  draftId: Ref<number | null>
}

export interface ApplySnapshotResult {
  draft: documentDrafts | null
}

export function useDocumentDraftSnapshots(config: DocumentDraftSnapshotsConfig) {
  const { draftId } = config

  const snapshots = ref<DocumentDraftSnapshot[]>([])

  async function loadSnapshots() {
    if (!draftId.value) return
    const r = await useApiFetch<{ snapshots: DocumentDraftSnapshot[] }>(
      `/api/v1/assistant/document/drafts/snapshots/${draftId.value}`,
    )
    snapshots.value = r?.snapshots ?? []
  }

  /**
   * 应用快照：返回最新 draft 让父级写回 draft.value，
   * 父级负责调用 loadSnapshots（snapshot 列表会因恢复操作产生新备份）
   */
  async function applySnapshot(
    snapshotId: number,
    fieldNames?: string[],
  ): Promise<ApplySnapshotResult> {
    const r = await useApiFetch<{ draft: documentDrafts }>(
      `/api/v1/assistant/document/drafts/snapshots/apply/${snapshotId}`,
      { method: 'POST', body: fieldNames ? { fieldNames } : {} },
    )
    return { draft: r?.draft ?? null }
  }

  return {
    snapshots,
    loadSnapshots,
    applySnapshot,
  }
}

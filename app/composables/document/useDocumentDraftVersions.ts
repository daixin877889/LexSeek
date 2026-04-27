/**
 * 文书草稿版本管理 sub-composable
 *
 * 职责：CRUD 文书版本（保存 / 重命名 / 删除 / 还原 / 导出 / 列表）
 *
 * 拆自：useDocumentDraft.ts 行 366-424
 *
 * 设计要点：
 * - draftId 由父级以 Ref<number | null> 传入
 * - restoreVersion 成功后调用方需自行 reload snapshots（不在本 composable 内耦合 snapshots）
 * - exportVersion 调 utils 触发浏览器下载，与 onExport 同语义
 */
import type { Ref } from 'vue'
import type { documentDrafts } from '~~/generated/prisma/client'
import type { DocumentDraftVersion } from '#shared/types/document'
import { useApiFetch } from '~/composables/useApiFetch'
import { triggerBrowserDownloadUrl } from '~/utils/browserDownload'

export interface DocumentDraftVersionsConfig {
  draftId: Ref<number | null>
}

export interface RestoreVersionResult {
  /** 还原后的最新 draft（失败时为 null） */
  draft: documentDrafts | null
}

export function useDocumentDraftVersions(config: DocumentDraftVersionsConfig) {
  const { draftId } = config

  const versions = ref<DocumentDraftVersion[]>([])

  const nextVersionNo = computed(() =>
    (versions.value.reduce((m, v) => Math.max(m, v.versionNo), 0)) + 1,
  )

  async function loadVersions() {
    if (!draftId.value) return
    const r = await useApiFetch<{ versions: DocumentDraftVersion[] }>(
      `/api/v1/assistant/document/drafts/${draftId.value}/versions`,
    )
    versions.value = r?.versions ?? []
  }

  async function saveVersion(name: string): Promise<DocumentDraftVersion | null> {
    if (!draftId.value) return null
    const r = await useApiFetch<{ version: DocumentDraftVersion }>(
      `/api/v1/assistant/document/drafts/${draftId.value}/versions`,
      { method: 'POST', body: { name } },
    )
    if (r?.version) versions.value = [r.version, ...versions.value]
    return r?.version ?? null
  }

  async function renameVersion(versionId: number, name: string) {
    const r = await useApiFetch<{ version: DocumentDraftVersion }>(
      `/api/v1/assistant/document/drafts/versions/${versionId}`,
      { method: 'PATCH', body: { name } },
    )
    if (r?.version) {
      versions.value = versions.value.map(v => v.id === versionId ? r.version : v)
    }
  }

  async function deleteVersion(versionId: number) {
    const r = await useApiFetch<{ ok: true }>(
      `/api/v1/assistant/document/drafts/versions/${versionId}`,
      { method: 'DELETE' },
    )
    if (r?.ok) versions.value = versions.value.filter(v => v.id !== versionId)
  }

  /**
   * 还原版本：返回最新 draft 让父级写回 draft.value，
   * 父级负责调用 loadSnapshots（避免 snapshots 与 versions 双向耦合）
   */
  async function restoreVersion(versionId: number): Promise<RestoreVersionResult> {
    const r = await useApiFetch<{ draft: documentDrafts }>(
      `/api/v1/assistant/document/drafts/versions/restore/${versionId}`,
      { method: 'POST' },
    )
    return { draft: r?.draft ?? null }
  }

  async function exportVersion(versionId: number) {
    const r = await useApiFetch<{ ossFileId: number; downloadUrl: string }>(
      `/api/v1/assistant/document/drafts/versions/export/${versionId}`,
    )
    if (!r?.downloadUrl) return
    triggerBrowserDownloadUrl(r.downloadUrl)
  }

  return {
    versions,
    nextVersionNo,
    loadVersions,
    saveVersion,
    renameVersion,
    deleteVersion,
    restoreVersion,
    exportVersion,
  }
}

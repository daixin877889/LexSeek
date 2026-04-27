/**
 * 文书草稿版本预览 sub-composable
 *
 * 职责：选中某历史版本进入只读预览态，提供 previewValues 供 UI 渲染
 *
 * 拆自：useDocumentDraft.ts 行 449-457
 *
 * 设计要点：
 * - 由父级注入 versions ref（来自 useDocumentDraftVersions）
 * - previewVersionId == null 时 previewValues 返回 null（UI 退回当前编辑态）
 */
import type { Ref } from 'vue'
import type { DocumentDraftVersion } from '#shared/types/document'

export interface DocumentDraftPreviewConfig {
  versions: Ref<DocumentDraftVersion[]>
}

export function useDocumentDraftPreview(config: DocumentDraftPreviewConfig) {
  const { versions } = config

  const previewVersionId = ref<number | null>(null)

  const previewValues = computed<Record<string, string | null> | null>(() => {
    if (previewVersionId.value == null) return null
    const v = versions.value.find(x => x.id === previewVersionId.value)
    return v ? (v.values as Record<string, string | null>) : null
  })

  function enterPreview(id: number) {
    previewVersionId.value = id
  }

  function exitPreview() {
    previewVersionId.value = null
  }

  return {
    previewVersionId,
    previewValues,
    enterPreview,
    exitPreview,
  }
}

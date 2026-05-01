import { toast } from 'vue-sonner'
import { CaseStatus } from '#shared/types/case'
import { useApiFetch } from '~/composables/useApiFetch'

/**
 * 案件归档复用：cases 列表三种视图（grid/table/mobile）共用同一段
 * 「打开确认弹窗 → 调 PATCH /api/v1/cases/:id → toast → emit archived」逻辑。
 *
 * 调用方提供 `onArchived(id)` 回调（通常 emit 给父组件让它 refetch），
 * 同时把返回的 `dialogOpen` 绑给 `<CasesArchiveDialog>`、`openArchive` 绑给归档按钮。
 */
export function useArchiveCase(onArchived?: (id: number) => void) {
    const dialogOpen = ref(false)
    const archiving = ref(false)
    const targetId = ref<number | null>(null)

    function openArchive(item: { id: number }) {
        targetId.value = item.id
        dialogOpen.value = true
    }

    async function confirmArchive() {
        if (!targetId.value || archiving.value) return
        archiving.value = true
        try {
            const result = await useApiFetch(`/api/v1/cases/${targetId.value}`, {
                method: 'PATCH',
                body: { status: CaseStatus.ARCHIVED },
            })
            if (result !== null) {
                toast.success('案件已归档')
                onArchived?.(targetId.value)
                dialogOpen.value = false
                targetId.value = null
            }
        } finally {
            archiving.value = false
        }
    }

    return { dialogOpen, archiving, openArchive, confirmArchive }
}

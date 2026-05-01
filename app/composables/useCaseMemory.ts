/**
 * 案件记忆数据请求 + 状态管理
 *
 * 时间线 Tab 的核心 composable：
 * - load / loadMore：游标分页拉取
 * - add：用户手动添加（POST，source=manual_user）
 * - remove：删除自己写的（DELETE，仅 manual_user）
 * - filter：来源筛选（all / manual / consolidator / auto_extract / manual_user）
 * - showInvalidated：是否显示失效记录
 */
import { ref, type Ref } from 'vue'
import { useApiFetch } from '~/composables/useApiFetch'
import type { MemoryKind, MemorySource } from '#shared/types/memory'

export type MemoryFilter = 'all' | MemorySource

export interface MemoryItem {
    id: string
    text: string
    kind: MemoryKind
    subjectKey: string | null
    source: MemorySource
    createdAt: string
    invalidatedAt: string | null
}

export interface AddMemoryPayload {
    text: string
    kind: MemoryKind
    subjectKey?: string
}

export function useCaseMemory(caseId: Ref<number>) {
    const memories = ref<MemoryItem[]>([])
    const filter = ref<MemoryFilter>('all')
    const showInvalidated = ref(false)
    const cursor = ref<string | null>(null)
    const hasMore = ref(true)
    const loading = ref(false)

    function buildQuery() {
        const q: Record<string, string | number | boolean> = {}
        if (filter.value !== 'all') q.source = filter.value
        if (showInvalidated.value) q.includeInvalidated = true
        if (cursor.value) q.cursor = cursor.value
        return q
    }

    async function load(reset = true) {
        if (reset) {
            memories.value = []
            cursor.value = null
            hasMore.value = true
        }
        loading.value = true
        try {
            const result = await useApiFetch<{ memories: MemoryItem[]; nextCursor?: string }>(
                `/api/v1/cases/memories/by-case/${caseId.value}`,
                { method: 'GET', query: buildQuery() },
            )
            if (result) {
                memories.value = reset ? result.memories : [...memories.value, ...result.memories]
                cursor.value = result.nextCursor ?? null
                hasMore.value = !!result.nextCursor
            }
        } finally {
            loading.value = false
        }
    }

    async function loadMore() {
        if (!hasMore.value || loading.value) return
        await load(false)
    }

    async function add(payload: AddMemoryPayload): Promise<MemoryItem | null> {
        const result = await useApiFetch<MemoryItem>(
            `/api/v1/cases/memories/by-case/${caseId.value}`,
            { method: 'POST', body: payload },
        )
        if (result) {
            memories.value = [result, ...memories.value]
        }
        return result
    }

    async function remove(memoryId: string): Promise<boolean> {
        const result = await useApiFetch<{ id: string }>(
            `/api/v1/cases/memories/${memoryId}`,
            { method: 'DELETE' },
        )
        if (result) {
            memories.value = memories.value.filter(m => m.id !== memoryId)
            return true
        }
        return false
    }

    return {
        memories,
        filter,
        showInvalidated,
        cursor,
        hasMore,
        loading,
        load,
        loadMore,
        add,
        remove,
    }
}

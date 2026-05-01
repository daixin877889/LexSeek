/**
 * 页面级"来源条"上下文：合同审查 / 文书草稿等页面通过 ?from=assistant&sessionId=xxx
 * 跳入时，统一在顶部显示「返回助手 / 关联案件」操作条。
 *
 * 用 active cases 列表查标题：找不到时 SourceBar 内部会 fallback 到"案件 #id"，
 * 所以这里的 caseTitle 只是 best-effort 优化展示。
 */

import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApiFetch } from './useApiFetch'

export interface PageSourceBarOptions {
    /** 当前关联案件 ID 的响应式来源；为 null 表示未关联 */
    caseId: Ref<number | null> | ComputedRef<number | null>
}

export function usePageSourceBar(opts: PageSourceBarOptions) {
    const route = useRoute()

    const fromSource = computed(() => {
        const f = route.query.from
        if (typeof f !== 'string') return ''
        if (f === 'assistant' || f === 'xiaosuo') return f
        return ''
    })
    const sourceSessionId = computed(() => {
        const sid = route.query.sessionId
        return typeof sid === 'string' ? sid : null
    })
    const showSourceBar = computed(() => fromSource.value !== '')

    const caseTitle = ref<string | null>(null)
    async function refreshCaseTitle() {
        if (opts.caseId.value == null) {
            caseTitle.value = null
            return
        }
        const data = await useApiFetch<{ items: Array<{ id: number; title: string }> }>(
            '/api/v1/cases/active',
            { query: { limit: 200 }, showError: false },
        )
        caseTitle.value = data?.items?.find(c => c.id === opts.caseId.value)?.title ?? null
    }

    watch(() => opts.caseId.value, () => { void refreshCaseTitle() })

    return { fromSource, sourceSessionId, showSourceBar, caseTitle, refreshCaseTitle }
}

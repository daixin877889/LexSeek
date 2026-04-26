/**
 * 小索对话管理 composable — 基于 useChatSessionManager 的薄包装
 */
import type { MaybeRef } from 'vue'
import { useChatSessionManager } from '~/composables/useChatSessionManager'

export function useXiaosuoChat(caseId: MaybeRef<number>) {
    return useChatSessionManager({
        caseId,
        listUrl: (id) => `/api/v1/case/analysis/xiaosuo-sessions?caseId=${id}`,
        createUrl: '/api/v1/case/analysis/xiaosuo-session',
        deleteUrl: (sid) => `/api/v1/case/analysis/xiaosuo-session/${sid}`,
        buildCreateBody: (id, title) => ({ caseId: id, title }),
    })
}

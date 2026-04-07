/**
 * 模块对话管理 composable
 *
 * 统一管理所有模块的对话实例，支持：
 * - 多模块并发对话（每模块独立 session 和 stream）
 * - 窗口展开/收起管理（同一时间只展开一个）
 * - 页面刷新后恢复活跃 session
 * - stopGeneration 双重取消（SSE + Worker）
 *
 * 挂载在 [id].vue 页面级，tab 切换不影响
 */

import { effectScope } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

export interface ModuleChatInstance {
    /** 模块标识 */
    moduleName: string
    /** 模块显示名称 */
    moduleTitle: string
    /** 会话 ID */
    sessionId: Ref<string | null>
    /** 对话消息列表 */
    messages: ComputedRef<any[]>
    /** 是否正在加载 */
    isLoading: Ref<boolean>
    /** 窗口是否展开 */
    isExpanded: Ref<boolean>
    /** 是否有活跃的分析任务 */
    isActive: Ref<boolean>
    /** 发送消息 */
    sendMessage: (message: string) => void
    /** 中止生成（SSE + Worker） */
    stopGeneration: () => void
    /** 触发重连并回放历史（页面刷新后恢复 session 时使用） */
    reconnect: () => void
}

export function useModuleChatManager(caseId: Ref<number>) {
    // 使用 shallowReactive 避免 unwrap 内部 Ref
    const instances = shallowReactive<Record<string, ModuleChatInstance>>({})
    const expandedModule = ref<string | null>(null)
    // 持有所有 effectScope 引用，页面卸载时清理
    const scopes: Array<ReturnType<typeof effectScope>> = []

    /** 所有活跃的模块列表（用于渲染状态条） */
    const activeModules = computed(() =>
        Object.values(instances).filter(i => i.isActive.value || i.isExpanded.value),
    )

    /**
     * 获取或创建模块 chat 实例
     * 首次调用时请求 session API 并创建 useCaseChat 实例
     */
    async function getOrCreateInstance(
        moduleName: string,
        moduleTitle: string,
    ): Promise<ModuleChatInstance> {
        if (instances[moduleName]) return instances[moduleName]

        const sessionId = ref<string | null>(null)
        const isExpanded = ref(false)
        const isActive = ref(false)

        // 获取或创建 session（useApiFetch 直接返回 data）
        const sessionResult = await useApiFetch<{ sessionId: string; isNew: boolean }>(
            '/api/v1/case/analysis/module-session',
            { method: 'POST', body: { caseId: caseId.value, moduleName } },
        )
        if (sessionResult?.sessionId) {
            sessionId.value = sessionResult.sessionId
        }

        // 创建 chat 实例（用 effectScope 包裹，避免 onScopeDispose 警告）
        let chatInstance: ReturnType<typeof useCaseChat> | null = null
        if (sessionId.value) {
            const scope = effectScope()
            scopes.push(scope)
            chatInstance = scope.run(() =>
                useCaseChat({
                    sessionId: sessionId.value!,
                    onCustomEvent: (eventData: any) => {
                        if (eventData.name === 'analysis_result_saved') {
                            // 触发分析结果刷新
                            refreshNuxtData('caseDetail')
                        }
                    },
                }),
            )!
        }

        const instance: ModuleChatInstance = {
            moduleName,
            moduleTitle,
            sessionId,
            messages: computed(() => chatInstance?.messages.value ?? []) as ComputedRef<any[]>,
            isLoading: chatInstance?.isLoading || ref(false),
            isExpanded,
            isActive,
            sendMessage: (message: string) => chatInstance?.sendMessage(message),
            stopGeneration: async () => {
                // 1. 中止 SSE 连接
                chatInstance?.stopGeneration()
                // 2. 获取 runId 并取消 Worker 任务
                if (sessionId.value) {
                    try {
                        const runData = await useApiFetch<{ id: string }>(
                            `/api/v1/case/analysis/runs/current/${sessionId.value}`,
                        )
                        if (runData?.id) {
                            await useApiFetch(
                                `/api/v1/case/analysis/runs/cancel/${runData.id}`,
                                { method: 'POST' },
                            )
                        }
                    }
                    catch (error) {
                        console.error('[useModuleChatManager] 取消 run 失败:', error)
                    }
                }
            },
            reconnect: () => chatInstance?.reconnect(),
        }

        instances[moduleName] = instance
        // shallowReactive 不自动触发依赖更新，手动触发
        triggerRef(expandedModule)
        return instance
    }

    /** 展开指定模块的对话窗口（收起其他） */
    function expandModule(moduleName: string) {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key].isExpanded.value = key === moduleName
        }
        expandedModule.value = moduleName
        // 触发重连以回放历史消息（无论 session 是否已完成）
        const instance = instances[moduleName]
        if (instance) {
            instance.reconnect()
        }
    }

    /** 收起所有窗口 */
    function collapseAll() {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key].isExpanded.value = false
        }
        expandedModule.value = null
    }

    /** 页面刷新后恢复活跃 session */
    async function restoreActiveSessions() {
        const sessions = await useApiFetch<Array<{
            sessionId: string
            moduleName: string
            nodeId: number
            hasActiveRun: boolean
        }>>(
            `/api/v1/case/analysis/module-sessions?caseId=${caseId.value}`,
        )
        if (sessions) {
            for (const session of sessions) {
                // 始终为存在的 session 创建实例（包括已完成的）
                const moduleDef = INIT_ANALYSIS_MODULES.find(m => m.name === session.moduleName)
                const title = moduleDef?.title ?? session.moduleName
                const instance = await getOrCreateInstance(session.moduleName, title)
                // 仅标记活跃状态，不用于决定是否重连
                instance.isActive.value = session.hasActiveRun
                // 始终触发重连以回放历史消息
                instance.reconnect()
            }
        }
    }

    // 页面卸载时清理所有 effectScope
    onUnmounted(() => {
        for (const scope of scopes) {
            scope.stop()
        }
    })

    return {
        instances,
        getOrCreateInstance,
        expandModule,
        collapseAll,
        expandedModule,
        activeModules,
        restoreActiveSessions,
    }
}

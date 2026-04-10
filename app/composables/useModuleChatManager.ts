/**
 * 模块对话管理 composable
 * 每模块一个 useChatSessionManager 实例，manager 内部管理该模块的多个 session。
 * ModuleChatInstance = useChatSessionManager 返回值 + 模块元数据（moduleName/moduleTitle/isExpanded）
 */

import { effectScope } from 'vue'
import type { EffectScope, Ref } from 'vue'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

type SessionManager = ReturnType<typeof useChatSessionManager>

/** 模块实例 = session manager + 模块元数据 */
export type ModuleChatInstance = SessionManager & {
    moduleName: string
    moduleTitle: string
    isExpanded: Ref<boolean>
    /** 是否隐藏（用户从状态条关闭标签后为 true，下次 expand 时重置为 false） */
    isHidden: Ref<boolean>
}

export interface ModuleChatManagerOptions {
    onAnalysisSaved?: () => void
}

export function useModuleChatManager(caseId: Ref<number>, options: ModuleChatManagerOptions = {}) {
    const instances = shallowReactive<Record<string, ModuleChatInstance>>({})
    const expandedModule = ref<string | null>(null)
    // 持有所有 session manager 的 effectScope，页面卸载时统一清理
    const scopes: EffectScope[] = []

    const activeModules = computed(() =>
        Object.values(instances).filter(i =>
            !i.isHidden.value
            && (i.isLoading.value || (i.sessions.value.length > 0 && i.currentSessionId.value)),
        ),
    )

    async function getOrCreateModuleManager(
        moduleName: string,
        moduleTitle: string,
    ): Promise<ModuleChatInstance> {
        if (instances[moduleName]) return instances[moduleName]

        // 在 effectScope 内创建 useChatSessionManager，确保其内部的
        // ref/computed/watch/onUnmounted 正确注册（异步事件回调中无 component context）
        const scope = effectScope()
        scopes.push(scope)
        const manager = scope.run(() => useChatSessionManager({
            caseId,
            listUrl: (id) =>
                `/api/v1/case/analysis/module-sessions?caseId=${id}&moduleName=${moduleName}`,
            createUrl: '/api/v1/case/analysis/module-session',
            deleteUrl: (sid) =>
                `/api/v1/case/analysis/module-session/${sid}`,
            buildCreateBody: (id, title) => ({ caseId: id, moduleName, title }),
            onCustomEvent: (eventData: any) => {
                if (eventData.name === 'analysis_result_saved') {
                    options.onAnalysisSaved?.()
                }
            },
        }))!

        const instance: ModuleChatInstance = Object.assign(manager, {
            moduleName,
            moduleTitle,
            isExpanded: ref(false),
            isHidden: ref(false),
        })

        instances[moduleName] = instance
        triggerRef(expandedModule)

        // 自动初始化 session 列表（等价于小索的 init），否则 sendMessage 时 currentChat 为 null
        await manager.init()

        return instance
    }

    /** 兼容旧接口别名 */
    const getOrCreateInstance = getOrCreateModuleManager

    function expandModule(moduleName: string) {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key].isExpanded.value = key === moduleName
        }
        // expand 时重置 isHidden，确保从状态条关闭后再次打开能正常显示
        const target = instances[moduleName]
        if (target) target.isHidden.value = false
        expandedModule.value = moduleName
    }

    /** 从状态条隐藏某个模块标签（不中断底层 chat，仅 UI 隐藏） */
    function hideModule(moduleName: string) {
        const target = instances[moduleName]
        if (target) target.isHidden.value = true
    }

    function collapseAll() {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key].isExpanded.value = false
        }
        expandedModule.value = null
    }

    async function restoreActiveSessions() {
        const sessionsData = await useApiFetch<Array<{
            sessionId: string
            moduleName: string
            nodeId: number
            title: string
            hasActiveRun: boolean
            createdAt: string
            updatedAt: string
        }>>(
            `/api/v1/case/analysis/module-sessions?caseId=${caseId.value}`,
        )
        if (!sessionsData) return

        const moduleNames = new Set(sessionsData.map(s => s.moduleName))
        for (const moduleName of moduleNames) {
            const moduleDef = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
            const title = moduleDef?.title ?? moduleName
            await getOrCreateModuleManager(moduleName, title)
            // getOrCreateModuleManager 内部已调用 manager.init()
        }
    }

    // 页面卸载时清理所有 scope
    onUnmounted(() => {
        for (const scope of scopes) {
            scope.stop()
        }
    })

    return {
        instances,
        getOrCreateModuleManager,
        getOrCreateInstance,
        expandModule,
        hideModule,
        collapseAll,
        expandedModule,
        activeModules,
        restoreActiveSessions,
    }
}

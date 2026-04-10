/**
 * 模块对话管理 composable
 * 每模块一个 useChatSessionManager 实例，manager 内部管理该模块的多个 session。
 * ModuleChatInstance = useChatSessionManager 返回值 + 模块元数据（moduleName/moduleTitle/isExpanded）
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { Ref } from 'vue'

type SessionManager = ReturnType<typeof useChatSessionManager>

/** 模块实例 = session manager + 模块元数据 */
export type ModuleChatInstance = SessionManager & {
    moduleName: string
    moduleTitle: string
    isExpanded: Ref<boolean>
}

export interface ModuleChatManagerOptions {
    onAnalysisSaved?: () => void
}

export function useModuleChatManager(caseId: Ref<number>, options: ModuleChatManagerOptions = {}) {
    const instances = shallowReactive<Record<string, ModuleChatInstance>>({})
    const expandedModule = ref<string | null>(null)

    const activeModules = computed(() =>
        Object.values(instances).filter(i =>
            i.isLoading.value || (i.sessions.value.length > 0 && i.currentSessionId.value),
        ),
    )

    async function getOrCreateModuleManager(
        moduleName: string,
        moduleTitle: string,
    ): Promise<ModuleChatInstance> {
        if (instances[moduleName]) return instances[moduleName]

        const manager = useChatSessionManager({
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
        })

        const instance: ModuleChatInstance = Object.assign(manager, {
            moduleName,
            moduleTitle,
            isExpanded: ref(false),
        })

        instances[moduleName] = instance
        triggerRef(expandedModule)
        return instance
    }

    /** 兼容旧接口别名 */
    const getOrCreateInstance = getOrCreateModuleManager

    function expandModule(moduleName: string) {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key].isExpanded.value = key === moduleName
        }
        expandedModule.value = moduleName
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
            const manager = await getOrCreateModuleManager(moduleName, title)
            await manager.init()
        }
    }

    return {
        instances,
        getOrCreateModuleManager,
        getOrCreateInstance,
        expandModule,
        collapseAll,
        expandedModule,
        activeModules,
        restoreActiveSessions,
    }
}

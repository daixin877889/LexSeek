/**
 * 案件模块对话 - 薄包装（阶段 7 重写）
 *
 * 替代 useModuleChatManager。每个 moduleName 独立 session pool 实例。
 * 用 useDomainAgentSessionPool（任务 1.3）实现多 key 池化。
 *
 * 用法：
 *   const manager = useCaseModuleAgent(caseIdRef, { onAnalysisSaved })
 *   const moduleChat = manager.getOrCreateInstance(moduleName, moduleTitle)
 *
 * 对外接口（与旧 useModuleChatManager 对齐）：
 *   - instances: Record<string, ModuleAgentInstance>  augmented factory 字典
 *   - activeModules: ComputedRef<ModuleAgentInstance[]>
 *   - expandedModule / generatingModules / getOrCreateInstance / expandModule / hideModule / collapseAll
 */

import { ref, computed, shallowReactive, type Ref } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSessionPool, type SessionFactory } from '../agent-platform/useDomainAgentSession'

export type ModuleAgentInstance = SessionFactory & {
    moduleName: string
    moduleTitle: string
    isExpanded: Ref<boolean>
    isHidden: Ref<boolean>
}

export interface CaseModuleAgentOptions {
    onAnalysisSaved?: () => void
}

export function useCaseModuleAgent(
    caseId: Ref<number>,
    options: CaseModuleAgentOptions = {},
) {
    const userStore = useUserStore()
    const userId = String(userStore.userInfo.id ?? '')

    const pool = useDomainAgentSessionPool({
        scope: 'case',
        userId,
        caseId: caseId.value,
        onCustomEvent: (data) => {
            if (data && typeof data === 'object' && 'name' in data && (data as any).name === 'analysis_result_saved') {
                options.onAnalysisSaved?.()
            }
        },
    })

    // augmented factory 字典：每模块一份（与旧 useModuleChatManager.instances 接口对齐）
    const instances = shallowReactive<Record<string, ModuleAgentInstance>>({})
    const expandedModule = ref<string | null>(null)
    // 正在通过模块对话生成中的模块名列表
    const generatingModules = ref<string[]>([])

    function recomputeGenerating() {
        generatingModules.value = Object.keys(instances)
            .filter(name => instances[name]?.isLoading?.value)
    }

    function getOrCreateInstance(moduleName: string, moduleTitle: string): ModuleAgentInstance {
        if (instances[moduleName]) return instances[moduleName]

        const factory = pool.getOrCreate(moduleName, {
            sessionId: 'auto',
            moduleName,  // 决定 listUrl 走 module-sessions 端点
        })

        const augmented: ModuleAgentInstance = Object.assign(factory, {
            moduleName,
            moduleTitle,
            isExpanded: ref(false),
            isHidden: ref(false),
        })

        instances[moduleName] = augmented

        // 跟踪 isLoading 变化以更新 generatingModules
        watch(() => factory.isLoading.value, recomputeGenerating, { immediate: true })

        return augmented
    }

    function expandModule(moduleName: string) {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key]!.isExpanded.value = key === moduleName
        }
        // expand 时重置 isHidden（与旧行为对齐：从状态条关闭后再次打开能正常显示）
        const target = instances[moduleName]
        if (target) target.isHidden.value = false
        expandedModule.value = moduleName
    }

    function hideModule(moduleName: string) {
        const target = instances[moduleName]
        if (target) target.isHidden.value = true
    }

    function collapseAll() {
        for (const key of Object.keys(instances)) {
            if (instances[key]) instances[key]!.isExpanded.value = false
        }
        expandedModule.value = null
    }

    // 与旧 useModuleChatManager.activeModules 对齐：未隐藏即显示。
    //
    // 历史回归：02c21ad6 重构期间额外加了 `(isLoading || (sessions.length>0 && currentSessionId))`
    // 条件，意图过滤"未真正发起分析的模块",但 instances 字典本身已经保证"仅用户交互过的模块入池"
    //（getOrCreateInstance 才插入,业务调用方都是用户操作触发）。新条件反而引入 race:
    // 用户点开对话框后,init() / sendMessage 是异步的,SDK isLoading / sessions 在某些时序下
    // 仍是初始态(false / 空数组),用户此时关闭对话框,标签会被 filter 掉,失去"分析中可点回打开"
    // 入口。回到旧的 `!isHidden` 单条件,与用户期望一致。
    const activeModules = computed<ModuleAgentInstance[]>(() =>
        Object.values(instances).filter(i => !i.isHidden.value),
    )

    return {
        instances,
        getOrCreateInstance,
        getOrCreateModuleManager: getOrCreateInstance,  // 兼容旧名
        expandModule,
        hideModule,
        collapseAll,
        expandedModule,
        activeModules,
        generatingModules,
    }
}

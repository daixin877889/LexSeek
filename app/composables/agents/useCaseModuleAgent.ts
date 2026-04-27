/**
 * 案件模块对话 - 薄包装（阶段 7 重写）
 *
 * 替代 useModuleChatManager。每个 moduleName 独立 session pool 实例。
 * 用 useDomainAgentSessionPool（任务 1.3）实现多 key 池化。
 *
 * 用法：
 *   const manager = useCaseModuleAgent(caseIdRef, { onAnalysisSaved })
 *   const moduleChat = manager.getOrCreateInstance(moduleName, moduleTitle)
 */

import { ref, computed, type Ref } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSessionPool } from '../agent-platform/useDomainAgentSession'
import type { SessionFactory } from '../agent-platform/useDomainAgentSession'

export interface ModuleAgentInstance extends SessionFactory {
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
        // case 模块对话走专用 API 端点（apiEndpoints 由工厂按 scope 推断时已支持 moduleName 参数）
        onCustomEvent: (data) => {
            if (data && typeof data === 'object' && 'name' in data && (data as any).name === 'analysis_result_saved') {
                options.onAnalysisSaved?.()
            }
        },
    })

    // 业务元数据存储（每 moduleName 一份 isExpanded / isHidden / moduleTitle）
    const metadata = ref<Record<string, { moduleTitle: string; isExpanded: Ref<boolean>; isHidden: Ref<boolean> }>>({})
    const expandedModule = ref<string | null>(null)
    const generatingModules = ref<string[]>([])

    function getOrCreateInstance(moduleName: string, moduleTitle: string): ModuleAgentInstance {
        const factory = pool.getOrCreate(moduleName, {
            // 每个模块的 session 通过 moduleName 隔离（apiEndpoints 内已支持）
            sessionId: 'auto',
        })
        if (!metadata.value[moduleName]) {
            metadata.value[moduleName] = {
                moduleTitle,
                isExpanded: ref(false),
                isHidden: ref(false),
            }
        }
        const meta = metadata.value[moduleName]!
        return Object.assign(factory, {
            moduleName,
            moduleTitle: meta.moduleTitle,
            isExpanded: meta.isExpanded,
            isHidden: meta.isHidden,
        })
    }

    function expandModule(moduleName: string) {
        Object.keys(metadata.value).forEach((k) => {
            metadata.value[k]!.isExpanded.value = (k === moduleName)
        })
        expandedModule.value = moduleName
    }

    function hideModule(moduleName: string) {
        const meta = metadata.value[moduleName]
        if (meta) {
            meta.isHidden.value = true
            meta.isExpanded.value = false
        }
        if (expandedModule.value === moduleName) expandedModule.value = null
    }

    function collapseAll() {
        Object.values(metadata.value).forEach(m => { m.isExpanded.value = false })
        expandedModule.value = null
    }

    const activeModules = computed(() => {
        return Object.entries(metadata.value)
            .filter(([_, meta]) => !meta.isHidden.value)
            .map(([name]) => name)
    })

    return {
        getOrCreateInstance,
        getOrCreateModuleManager: getOrCreateInstance,  // 兼容旧名
        expandModule,
        hideModule,
        collapseAll,
        expandedModule,
        activeModules,
        generatingModules,
        instances: metadata,  // 兼容旧名
    }
}

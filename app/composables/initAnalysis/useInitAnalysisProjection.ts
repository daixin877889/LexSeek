import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import type { AnalysisModuleCard } from '#shared/types/case'
import { coerceRawMessages } from '~/components/ai/composables/useMessageParser'
import type { InitAnalysisState } from './types'

export interface ProjectionDeps {
  moduleStates: Ref<Record<string, ModuleRunState>>
  values: ComputedRef<InitAnalysisState | undefined>
  streamMessages: ComputedRef<any[]>
  statusModules: Ref<InitAnalysisStatusResponse['modules']>
  resultFromDB: Ref<Record<string, string>>
  externalGenerating: Ref<string[]>
}

export function useInitAnalysisProjection(deps: ProjectionDeps) {
  const { moduleStates, values, streamMessages, statusModules, resultFromDB, externalGenerating } = deps

  const mergedResult = computed(() => ({
    ...resultFromDB.value,
    ...(values.value?.result ?? {}),
  }))

  const resolvedStreamMessages = computed(() => {
    const realtime = streamMessages.value
    if (realtime.length > 0) return realtime
    const checkpoint = values.value?.messages ?? []
    if (checkpoint.length > 0) {
      return coerceRawMessages(checkpoint)
    }
    return []
  })

  const allModuleCards = computed<AnalysisModuleCard[]>(() => {
    const globalModules = statusModules.value
    const streamResult = values.value?.result ?? {}
    const streamFailed = values.value?.failedModules ?? {}
    const localStates = moduleStates.value
    const extGenerating = new Set(externalGenerating.value)

    return INIT_ANALYSIS_MODULES.map(def => {
      const base = { moduleName: def.name, moduleTitle: def.title }

      const local = localStates[def.name]
      if (local) {
        if (local.status === 'complete' || streamResult[def.name]) {
          return {
            ...base,
            status: 'complete' as const,
            content: streamResult[def.name] ?? local.content,
          }
        }
        if (local.status === 'failed' || streamFailed[def.name]) {
          return { ...base, status: 'failed' as const }
        }
        if (local.status === 'streaming') {
          return { ...base, status: 'in_progress' as const }
        }
      }

      const g = globalModules.find(m => m.name === def.name)
      if (g?.status === 'complete' && g.result) {
        return {
          ...base,
          status: 'complete' as const,
          content: g.result,
          analyzedAt: g.analyzedAt,
          version: g.version,
        }
      }
      if (g?.status === 'failed') {
        return { ...base, status: 'failed' as const }
      }
      if (g?.status === 'in_progress' || extGenerating.has(def.name)) {
        return { ...base, status: 'in_progress' as const }
      }
      return { ...base, status: 'idle' as const }
    })
  })

  return {
    mergedResult,
    streamMessages: resolvedStreamMessages,
    allModuleCards,
  }
}

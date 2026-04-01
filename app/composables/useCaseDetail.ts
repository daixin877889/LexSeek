import type { AnalysisResult } from '#shared/types/case'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

/** 案件详情页视图类型（包含未来扩展） */
export type ActiveView = 'overview' | 'materials' | 'analysis' | 'todos' | 'documents'

/** MaterialItem 接口（与 MaterialList.vue 中定义一致） */
export interface MaterialItem {
  id: number
  name: string
  type: number
  typeText: string
  ossFileId: number | null
  isEncrypted: boolean
  status: number
  summary: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
}

/** 案件基本信息接口（与 API 返回对齐） */
export interface CaseDetailInfo {
  id: number
  title: string
  content: string
  caseTypeId: number
  plaintiff: string[] | Array<{ name: string }>
  defendant: string[] | Array<{ name: string }>
  status: number
  isDemo: boolean
  createdAt: string
  updatedAt: string
  caseType: { id: number; name: string; description: string } | null
  sessions: Array<{ id: number; sessionId: string; status: number; createdAt: string }>
  latestAnalyses: Array<{
    id: number
    nodeId: number
    analysisType: string
    version: number
    status: number
    createdAt: string
    node: { name: string; title: string; type: string } | null
  }>
}

export function useCaseDetail(caseId: Ref<number> | ComputedRef<number>) {
  const id = toRef(caseId)

  // 案件基本信息（响应式，用于页面头部标题等）
  const { data: caseInfo, refresh: refreshCase } = useApi<CaseDetailInfo>(
    () => `/api/v1/case/${id.value}`,
  )

  // 材料列表（响应式）
  const { data: materials, refresh: refreshMaterials } = useApi<MaterialItem[]>(
    () => `/api/v1/case/${id.value}/materials`,
  )

  // 分析状态和结果
  const { data: analysisStatus, refresh: refreshAnalysis } = useApi<InitAnalysisStatusResponse>(
    () => `/api/v1/case/init-analysis-status/${id.value}`,
  )

  // 将分析结果转换为 AnalysisResult[] 格式
  const analysisResults = computed<AnalysisResult[]>(() => {
    const status = analysisStatus.value
    if (!status?.modules) return []

    const results: AnalysisResult[] = []
    for (const m of status.modules) {
      if (m.status === 'complete' && m.result) {
        const moduleDef = INIT_ANALYSIS_MODULES.find(def => def.name === m.name)
        results.push({
          nodeId: 0, // init-analysis 无持久化 nodeId，用 0 占位
          moduleName: m.name,
          moduleTitle: moduleDef?.title ?? m.name,
          content: m.result,
          analyzedAt: '', // InitAnalysisStatusResponse 不含时间戳
          version: m.version ?? 1,
        })
      }
    }
    return results
  })

  return {
    caseInfo,
    materials,
    analysisResults,
    analysisStatus,
    refreshCase,
    refreshMaterials,
    refreshAnalysis,
  }
}

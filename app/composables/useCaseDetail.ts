import type { AnalysisResult } from '#shared/types/case'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import type { OssFileItem } from '~/store/file'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { getMaterialType } from '~/utils/caseMaterial'
import { toast } from 'vue-sonner'

/** 案件详情页视图类型（包含未来扩展） */
export type ActiveView = 'overview' | 'materials' | 'analysis' | 'todos' | 'documents'

/** CaseDetailMaterialItem 接口（案件详情页材料，与 API 返回对齐） */
export interface CaseDetailMaterialItem {
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
  const { data: materials, refresh: refreshMaterials } = useApi<CaseDetailMaterialItem[]>(
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
          nodeId: 0,
          moduleName: m.name,
          moduleTitle: moduleDef?.title ?? m.name,
          content: m.result,
          analyzedAt: m.analyzedAt ?? '',
          version: m.version ?? 1,
        })
      }
    }
    return results
  })

  // --- 识别轮询（仅轮询状态，不触发识别，识别由后端 processMaterialService 处理） ---
  const {
    fileRecognitionStatus,
    getRecognitionStatus,
    handleRecognitionResults,
    stopAllPolling,
  } = useFileRecognition()

  // 当前案件已有材料的 ossFileId 列表（用于 materialSelector 的 disabledFileIds）
  const disabledOssFileIds = computed<number[]>(() => {
    return (materials.value ?? [])
      .filter((m: CaseDetailMaterialItem) => m.ossFileId != null)
      .map((m: CaseDetailMaterialItem) => m.ossFileId!)
  })

  // 添加材料的 loading 状态
  const isAddingMaterials = ref(false)

  /**
   * 添加材料到当前案件
   * @param files materialSelector 返回的 OssFileItem[]
   */
  async function addMaterials(files: OssFileItem[]) {
    if (files.length === 0) return

    isAddingMaterials.value = true
    try {
      const materialParams = files.map(file => ({
        type: getMaterialType(file.fileType),
        name: file.fileName,
        ossFileId: file.id,
      }))

      const response = await useApiFetch<CaseDetailMaterialItem[]>(
        `/api/v1/case/materials/${id.value}`,
        {
          method: 'POST',
          body: { materials: materialParams },
        },
      )

      if (!response || (Array.isArray(response) && response.length === 0)) {
        toast.info('所有材料已存在，无需重复添加')
        return
      }

      toast.success(`成功添加 ${Array.isArray(response) ? response.length : 0} 个材料`)

      // 刷新材料列表
      await refreshMaterials()

      // 启动轮询（后端已通过 processMaterialService 触发识别，前端只需轮询状态）
      // 构造 processing 状态，通过 handleRecognitionResults 启动轮询
      const pollingResults = files.map(f => ({
        ossFileId: f.id,
        status: 'processing' as const,
      }))
      handleRecognitionResults(pollingResults)
    } catch {
      toast.error('添加材料失败')
    } finally {
      isAddingMaterials.value = false
    }
  }

  return {
    caseInfo,
    materials,
    analysisResults,
    analysisStatus,
    refreshCase,
    refreshMaterials,
    refreshAnalysis,
    // 添加材料相关
    addMaterials,
    isAddingMaterials,
    disabledOssFileIds,
    fileRecognitionStatus,
    getRecognitionStatus,
    stopAllPolling,
  }
}

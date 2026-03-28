import type { CaseMaterialParam, CaseTypeOption, ExtractedCaseInfo } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
import type { OssFileItem } from '~/store/file'
import { toast } from 'vue-sonner'

interface CreateCaseParams {
  caseTypeId: number
  title?: string
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  content?: string
  materials?: CaseMaterialParam[]
}

export interface ExtractedFormData {
  title?: string
  caseTypeId?: number
  plaintiff?: string[]
  defendant?: string[]
  content?: string
}

function mapExtractedInfoToFormData(info: ExtractedCaseInfo, types: CaseTypeOption[]): ExtractedFormData {
  return {
    title: info.title,
    caseTypeId: types.find(t => t.name === info.caseType || t.name.includes(info.caseType))?.id,
    plaintiff: info.plaintiff,
    defendant: info.defendant,
    content: info.summary,
  }
}

export function useCaseCreation() {
  const step = ref<'ai' | 'confirm'>('ai')
  const isSubmitting = ref(false)
  const isExtracting = ref(false)
  const caseTypes = ref<CaseTypeOption[]>([])
  const extractedFormData = ref<ExtractedFormData | null>(null)
  const uploadedMaterials = ref<CaseMaterialParam[]>([])

  async function loadCaseTypes() {
    const data = await useApiFetch<{ items: CaseTypeOption[] }>('/api/v1/case-types')
    caseTypes.value = data?.items ?? []
  }

  async function extractCaseInfo(message: string, files?: OssFileItem[]) {
    isExtracting.value = true
    try {
      // 保存上传的材料
      if (files?.length) {
        uploadedMaterials.value = files.map(f => ({
          type: CaseMaterialType.DOCUMENT,
          name: f.fileName,
          ossFileId: f.id,
        }))
      }

      // 用户可能只上传了文件而不输入文字
      const text = message.trim() || '请根据上传的材料提取案件信息'

      const result = await useApiFetch<{
        message: string
        extractedInfo?: ExtractedCaseInfo
      }>('/api/v1/case/extract', {
        method: 'POST',
        body: {
          message: text,
          materials: files?.map(f => ({ ossFileId: f.id, name: f.fileName })),
        },
      })

      if (result?.extractedInfo) {
        extractedFormData.value = mapExtractedInfoToFormData(result.extractedInfo, caseTypes.value)
        step.value = 'confirm'
      } else {
        toast.warning(result?.message || '未能提取到案件信息，请尝试补充描述或手动创建')
      }
    } catch {
      toast.error('提取失败，请重试或切换到手动创建')
    } finally {
      isExtracting.value = false
    }
  }

  async function createCase(params: CreateCaseParams): Promise<number | null> {
    isSubmitting.value = true
    try {
      const data = await useApiFetch<{ caseId: number; sessionId: string }>('/api/v1/case/create', {
        method: 'POST',
        body: params,
      })
      if (data?.sessionId) {
        await navigateTo(`/dashboard/cases/init-analysis/${data.sessionId}`)
        return data.caseId
      }
      return null
    } finally {
      isSubmitting.value = false
    }
  }

  return {
    step,
    isSubmitting,
    isExtracting,
    caseTypes,
    extractedFormData,
    uploadedMaterials,
    loadCaseTypes,
    createCase,
    extractCaseInfo,
  }
}

import type { CaseMaterialParam, CaseTypeOption, ExtractedCaseInfo, ExtraField, DemoCaseListItem, DemoCasePrepareResponse } from '#shared/types/case'
import type { OssFileDto } from '#shared/types/file'
import type { OssFileItem } from '~/store/file'
import { toast } from 'vue-sonner'

export interface CreateCaseParams {
  caseTypeId: number
  title?: string
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  content?: string
  materials?: CaseMaterialParam[]
  summary?: string
  extractedInfo?: ExtraField[]
}

export interface ExtractedFormData {
  title?: string
  caseTypeId?: number
  plaintiff?: string[]
  defendant?: string[]
  content?: string
}

/** 前端控制器接口：由 AiPromptInput 的 defineExpose 实现 */
interface PromptInputController {
  setText: (v: string) => void
  addFiles: (files: OssFileDto[]) => void
  reset: () => void
  hasContent: () => boolean
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

export function useCaseCreation(promptInputRef?: Ref<PromptInputController | null>) {
  const step = ref<'ai' | 'confirm'>('ai')
  const isSubmitting = ref(false)
  const isExtracting = ref(false)
  const caseTypes = ref<CaseTypeOption[]>([])
  const extractedFormData = ref<ExtractedFormData | null>(null)
  const rawExtractedInfo = ref<ExtractedCaseInfo | null>(null)
  const uploadedFiles = ref<OssFileItem[]>([])

  async function loadCaseTypes() {
    const data = await useApiFetch<{ items: CaseTypeOption[] }>('/api/v1/case-types')
    caseTypes.value = data?.items ?? []
  }

  async function extractCaseInfo(message: string, files?: OssFileItem[]) {
    isExtracting.value = true
    try {
      // 保存上传的材料
      if (files?.length) {
        uploadedFiles.value = [...files]
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
        rawExtractedInfo.value = result.extractedInfo
        extractedFormData.value = {
          ...mapExtractedInfoToFormData(result.extractedInfo, caseTypes.value),
          content: message.trim() || undefined,
        }
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

  // ---- demo case 扩展 ----

  const demoCases = ref<DemoCaseListItem[]>([])
  const demoCasesLoading = ref(true)
  const preparingDemoCaseId = ref<number | null>(null)
  const showReplaceConfirm = ref(false)
  const pendingExample = ref<DemoCaseListItem | null>(null)

  async function loadDemoCases() {
    demoCasesLoading.value = true
    try {
      const data = await useApiFetch<{ items: DemoCaseListItem[] }>('/api/v1/demo-cases')
      demoCases.value = data?.items ?? []
    } finally {
      demoCasesLoading.value = false
    }
  }

  async function fetchAndFillDemoCase(example: DemoCaseListItem): Promise<boolean> {
    const data = await useApiFetch<DemoCasePrepareResponse>(
      `/api/v1/demo-cases/prepare/${example.id}`,
      { method: 'POST' },
    )
    if (!data) return false
    if (data.content) promptInputRef?.value?.setText(data.content)
    if (data.files?.length) promptInputRef?.value?.addFiles(data.files)
    return true
  }

  async function applyDemoCase(example: DemoCaseListItem) {
    if (preparingDemoCaseId.value !== null) return
    preparingDemoCaseId.value = example.id
    try {
      await fetchAndFillDemoCase(example)
    } finally {
      preparingDemoCaseId.value = null
    }
  }

  async function handleExampleSelect(example: DemoCaseListItem) {
    if (promptInputRef?.value?.hasContent()) {
      pendingExample.value = example
      showReplaceConfirm.value = true
      return
    }
    await applyDemoCase(example)
  }

  async function confirmReplaceExample() {
    const example = pendingExample.value
    if (!example) return
    preparingDemoCaseId.value = example.id
    try {
      // 先请求 prepare，成功后再清空输入框，避免失败时内容丢失
      const data = await useApiFetch<DemoCasePrepareResponse>(
        `/api/v1/demo-cases/prepare/${example.id}`,
        { method: 'POST' },
      )
      if (!data) return
      promptInputRef?.value?.reset()
      await nextTick()
      if (data.content) promptInputRef?.value?.setText(data.content)
      if (data.files?.length) promptInputRef?.value?.addFiles(data.files)
    } finally {
      preparingDemoCaseId.value = null
      pendingExample.value = null
      showReplaceConfirm.value = false
    }
  }

  return {
    step,
    isSubmitting,
    isExtracting,
    caseTypes,
    extractedFormData,
    rawExtractedInfo,
    uploadedFiles,
    loadCaseTypes,
    createCase,
    extractCaseInfo,
    // demo case 扩展
    demoCases,
    demoCasesLoading,
    preparingDemoCaseId,
    showReplaceConfirm,
    loadDemoCases,
    handleExampleSelect,
    confirmReplaceExample,
    applyDemoCase,
  }
}

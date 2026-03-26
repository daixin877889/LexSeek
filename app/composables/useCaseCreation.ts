import type { CaseMaterialParam, CaseTypeOption } from '#shared/types/case'

interface CreateCaseParams {
  caseTypeId: number
  title?: string
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  content?: string
  materials?: CaseMaterialParam[]
}

export function useCaseCreation() {
  const mode = ref<'select' | 'manual' | 'ai'>('select')
  const isSubmitting = ref(false)
  const caseTypes = ref<CaseTypeOption[]>([])

  async function loadCaseTypes() {
    const data = await useApiFetch<{ items: CaseTypeOption[] }>('/api/v1/case-types')
    caseTypes.value = data?.items ?? []
  }

  async function createCase(params: CreateCaseParams): Promise<number | null> {
    isSubmitting.value = true
    try {
      const data = await useApiFetch<{ caseId: number; sessionId: string }>('/api/v1/case/create', {
        method: 'POST',
        body: params,
      })
      if (data?.caseId) {
        await navigateTo(`/dashboard/cases/init-analysis/${data.caseId}`)
        return data.caseId
      }
      return null
    } finally {
      isSubmitting.value = false
    }
  }

  return { mode, isSubmitting, caseTypes, loadCaseTypes, createCase }
}

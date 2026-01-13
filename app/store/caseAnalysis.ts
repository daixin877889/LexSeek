/**
 * 案件分析状态
 */

export const useCaseAnalysisStore = defineStore('caseAnalysis', () => {
  // 输入框文本内容
  const promptText = ref('')
  // 输入框附件数量
  const promptFilesCount = ref(0)


  // 是否有输入内容（文本或附件）
  const hasPromptInput = computed(() => {
    return promptText.value.trim() !== '' || promptFilesCount.value > 0
  })

  // 更新输入状态（由 PromptInputWatcher 调用）
  function updatePromptState(text: string, filesCount: number) {
    promptText.value = text
    promptFilesCount.value = filesCount
  }

  // 重置输入状态
  function resetPromptState() {
    promptText.value = ''
    promptFilesCount.value = 0
  }

  return {
    promptText,
    promptFilesCount,
    hasPromptInput,
    updatePromptState,
    resetPromptState,
  }
})




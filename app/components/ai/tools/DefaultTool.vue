<script lang="ts">
// 模块级常量：所有组件实例共享，避免每次实例化重建对象
// 仅包含未在 AiToolRenderer 注册专属组件的工具；专属组件由各自文件维护标题
const TOOL_NAME_MAP: Record<string, string> = {
  upload_workspace_file: '上传工作区文件',
  save_analysis_result: '保存分析结果',
  write_skill_file: '写入技能文件',
  read_skill_file: '读取技能文件',
  run_skill_script: '运行技能脚本',
}

const analysisNodes: Record<string, string> = {
  summary: '生成案件概要',
  chronicle: '提取案件大事记',
  claim: '预分析案件请求权',
  trend: '判决趋势预测',
  cause: '预选案由',
  defense: '抗辩分析及应对策略预测',
  evidence: '证据清单预梳理',
  caseInfoCheck: '案情信息检查'
}

const EXPERT_PATTERN = /^ask_([a-z0-9_]+?)_expert$/
</script>

<script setup lang="ts">
interface Props {
  toolName: string
  input?: any
  output?: any
  errorText?: string
  state: string | 'input-available' | 'output-available' | 'output-error'
}

const props = defineProps<Props>()

const displayName = computed(() => {
  const name = props.toolName
  const mapped = TOOL_NAME_MAP[name]
  if (mapped) return mapped
  const expertMatch = name.match(EXPERT_PATTERN)
  // if (expertMatch) return `咨询${expertMatch[1]}专家`
  if (expertMatch && expertMatch[1]) return analysisNodes[expertMatch[1]]
  return name
})
</script>

<template>
  <AiElementsTool>
    <AiElementsToolHeader :title="displayName" :type="`tool-${props.toolName}`" :state="props.state as any" />
    <AiElementsToolContent>
      <AiElementsToolInput v-if="props.input" :input="props.input" />
      <AiElementsToolOutput v-if="props.output != null" :output="props.output" :error-text="props.errorText" />
    </AiElementsToolContent>
  </AiElementsTool>
</template>

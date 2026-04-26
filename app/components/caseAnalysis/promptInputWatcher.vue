<template>
  <!-- 无渲染内容，仅用于监听输入状态并同步到 store -->
</template>

<script lang="ts" setup>
import { usePromptInput } from "@/components/ai-elements/prompt-input";
import { useCaseAnalysisStore } from '~/store/caseAnalysis'

const props = defineProps<{
  filesCount?: number
}>();

const store = useCaseAnalysisStore();
const { textInput } = usePromptInput();

// 监听输入变化，同步到 store
watch(
  [textInput, () => props.filesCount],
  ([text, count]) => {
    store.updatePromptState(text, count || 0);
  },
  { immediate: true }
);

// 组件卸载时重置状态
onUnmounted(() => {
  store.resetPromptState();
});
</script>

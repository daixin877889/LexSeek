<template>
  <!-- 无渲染内容，仅用于监听输入状态并同步到 store -->
</template>

<script lang="ts" setup>
import { usePromptInput } from "@/components/ai-elements/prompt-input";

const store = useCaseAnalysisStore();
const { textInput, files } = usePromptInput();

// 监听输入变化，同步到 store
watch(
  [textInput, files],
  ([text, fileList]) => {
    store.updatePromptState(text, fileList.length);
  },
  { deep: true, immediate: true }
);

// 组件卸载时重置状态
onUnmounted(() => {
  store.resetPromptState();
});
</script>

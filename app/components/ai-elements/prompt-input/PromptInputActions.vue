<script lang="ts" setup>
import { usePromptInput } from './context'

const { clearInput, clearFiles } = usePromptInput()

defineExpose({ clearInput, clearFiles })
</script>

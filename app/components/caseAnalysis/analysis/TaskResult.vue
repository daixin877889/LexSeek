<script setup lang="ts">
defineProps<{
    result: string
    name: string
}>()
</script>

<template>
    <AiElementsArtifact>
        <AiElementsArtifactHeader>
            {{ name }}
        </AiElementsArtifactHeader>
        <AiElementsArtifactContent>
            <div class="prose prose-sm max-w-none" v-html="result" />
        </AiElementsArtifactContent>
    </AiElementsArtifact>
</template>

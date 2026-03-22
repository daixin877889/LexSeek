<script setup lang="ts">
defineProps<{
    result: string
    name: string
}>()
</script>

<template>
    <AiElementsArtifactArtifact>
        <AiElementsArtifactArtifactHeader>
            {{ name }}
        </AiElementsArtifactArtifactHeader>
        <AiElementsArtifactArtifactContent>
            <div class="prose prose-sm max-w-none" v-html="result" />
        </AiElementsArtifactArtifactContent>
    </AiElementsArtifactArtifact>
</template>

<script setup lang="ts">
defineProps<{
    result: string
    name: string
}>()
</script>

<template>
    <Artifact>
        <ArtifactHeader>
            {{ name }}
        </ArtifactHeader>
        <ArtifactContent>
            <div class="prose prose-sm max-w-none" v-html="result" />
        </ArtifactContent>
    </Artifact>
</template>

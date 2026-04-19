<script setup lang="ts">
import { PencilIcon } from 'lucide-vue-next'

const props = defineProps<{
    title: string
}>()

const emit = defineEmits<{
    save: [newTitle: string]
}>()

const editing = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function startEdit() {
    draft.value = props.title
    editing.value = true
    nextTick(() => inputRef.value?.focus())
}

function commit() {
    const clean = draft.value.trim()
    editing.value = false
    if (!clean || clean === props.title) return
    emit('save', clean)
}

function cancel() {
    editing.value = false
    draft.value = props.title
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel()
    if (e.key === 'Enter') {
        e.preventDefault()
        commit()
    }
}
</script>

<template>
    <div class="flex items-center gap-2 min-w-0 flex-1">
        <template v-if="!editing">
            <h1 data-testid="title-display"
                class="text-base md:text-lg font-semibold truncate cursor-pointer hover:bg-muted/60 rounded px-1 py-0.5"
                :title="title" @click="startEdit">
                {{ title }}
            </h1>
            <button type="button" class="shrink-0 text-muted-foreground hover:text-foreground transition"
                @click="startEdit" aria-label="编辑标题">
                <PencilIcon class="size-3.5" />
            </button>
        </template>
        <template v-else>
            <input ref="inputRef" v-model="draft" type="text" maxlength="200"
                class="text-base md:text-lg font-semibold bg-transparent border-b border-primary outline-none px-1 py-0.5 flex-1 min-w-0"
                @blur="commit" @keydown="onKeydown" />
        </template>
    </div>
</template>

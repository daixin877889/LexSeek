<script setup lang="ts">
import { EyeIcon, RotateCcwIcon, DownloadIcon, Trash2Icon, PencilIcon } from 'lucide-vue-next'
import type { DocumentDraftVersion } from '#shared/types/document'

const props = defineProps<{
    versions: DocumentDraftVersion[]
}>()

const emit = defineEmits<{
    preview: [version: DocumentDraftVersion]
    restore: [version: DocumentDraftVersion]
    exportVersion: [version: DocumentDraftVersion]
    delete: [version: DocumentDraftVersion]
    rename: [id: number, newName: string]
}>()

const editingId = ref<number | null>(null)
const editingName = ref('')
const originalName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function startRename(v: DocumentDraftVersion) {
    editingId.value = v.id
    editingName.value = v.name
    originalName.value = v.name
    nextTick(() => inputRef.value?.focus())
}

function commitRename(id: number) {
    if (editingId.value !== id) return
    const clean = editingName.value.trim()
    editingId.value = null
    if (!clean || clean === originalName.value) return
    emit('rename', id, clean)
}

function cancelRename() {
    editingId.value = null
    editingName.value = originalName.value
}
</script>

<template>
    <div>
        <div v-if="!versions.length" class="text-sm text-muted-foreground p-6 text-center">
            还没有保存过版本，点顶部"保存当前为版本"记录里程碑
        </div>
        <ul v-else class="divide-y rounded-md border">
            <li v-for="v in versions" :key="v.id"
                class="flex items-center gap-4 p-3 transition-colors hover:bg-muted/40">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <template v-if="editingId === v.id">
                            <input ref="inputRef" v-model="editingName" type="text" maxlength="100"
                                class="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-sm font-medium px-1 py-0.5"
                                @blur="commitRename(v.id)"
                                @keydown.enter.prevent="commitRename(v.id)"
                                @keydown.escape="cancelRename" />
                        </template>
                        <template v-else>
                            <span class="text-sm font-medium truncate cursor-pointer hover:bg-muted/60 rounded px-1 py-0.5"
                                :title="v.name" @click="startRename(v)">{{ v.name }}</span>
                            <button type="button"
                                class="shrink-0 text-muted-foreground hover:text-foreground transition"
                                @click="startRename(v)" aria-label="重命名">
                                <PencilIcon class="size-3.5" />
                            </button>
                        </template>
                    </div>
                    <div class="text-xs text-muted-foreground tabular-nums mt-0.5 px-1">
                        {{ formatDate(v.createdAt, 'YYYY-MM-DD HH:mm') }}
                    </div>
                </div>
                <div class="flex items-center gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" class="h-7 px-2" @click="emit('preview', v)">
                        <EyeIcon class="size-3.5 mr-1" /> 预览
                    </Button>
                    <Button size="sm" variant="ghost" class="h-7 px-2" @click="emit('restore', v)">
                        <RotateCcwIcon class="size-3.5 mr-1" /> 恢复
                    </Button>
                    <Button size="sm" variant="ghost" class="h-7 px-2" @click="emit('exportVersion', v)">
                        <DownloadIcon class="size-3.5 mr-1" /> 导出
                    </Button>
                    <div class="h-4 w-px bg-border mx-1" />
                    <Button size="sm" variant="ghost" class="h-7 px-2 text-destructive hover:text-destructive"
                        @click="emit('delete', v)">
                        <Trash2Icon class="size-3.5 mr-1" /> 删除
                    </Button>
                </div>
            </li>
        </ul>
    </div>
</template>

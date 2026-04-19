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

function startRename(v: DocumentDraftVersion) {
    editingId.value = v.id
    editingName.value = v.name
}

function commitRename(id: number) {
    const clean = editingName.value.trim()
    editingId.value = null
    if (!clean) return
    emit('rename', id, clean)
}

function formatTime(iso: string) {
    return formatDate(iso, 'YYYY-MM-DD HH:mm')
}
</script>

<template>
    <div>
        <div v-if="!versions.length" class="text-sm text-muted-foreground p-6 text-center">
            还没有保存过版本，点顶部"保存当前为版本"记录里程碑
        </div>
        <ul v-else class="divide-y">
            <li v-for="v in versions" :key="v.id" class="p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                    <template v-if="editingId === v.id">
                        <input v-model="editingName" type="text" maxlength="100"
                            class="flex-1 bg-transparent border-b border-primary outline-none text-sm"
                            @blur="commitRename(v.id)"
                            @keydown.enter.prevent="commitRename(v.id)"
                            @keydown.escape="editingId = null" autofocus />
                    </template>
                    <template v-else>
                        <span class="text-sm font-medium truncate flex-1" :title="v.name">{{ v.name }}</span>
                        <button type="button" class="text-muted-foreground hover:text-foreground"
                            @click="startRename(v)" aria-label="重命名">
                            <PencilIcon class="size-3" />
                        </button>
                    </template>
                </div>
                <div class="text-xs text-muted-foreground">{{ formatTime(v.createdAt) }}</div>
                <div class="flex items-center gap-1">
                    <Button size="sm" variant="ghost" @click="emit('preview', v)">
                        <EyeIcon class="size-3.5 mr-1" /> 预览
                    </Button>
                    <Button size="sm" variant="ghost" @click="emit('restore', v)">
                        <RotateCcwIcon class="size-3.5 mr-1" /> 恢复
                    </Button>
                    <Button size="sm" variant="ghost" @click="emit('exportVersion', v)">
                        <DownloadIcon class="size-3.5 mr-1" /> 导出
                    </Button>
                    <Button size="sm" variant="ghost" class="text-destructive" @click="emit('delete', v)">
                        <Trash2Icon class="size-3.5 mr-1" /> 删除
                    </Button>
                </div>
            </li>
        </ul>
    </div>
</template>

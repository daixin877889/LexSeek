<script setup lang="ts">
import type { DocumentDraftVersion, DocumentDraftSnapshot } from '#shared/types/document'

defineProps<{
    open: boolean
    versions: DocumentDraftVersion[]
    snapshots: DocumentDraftSnapshot[]
    currentValues: Record<string, string | null>
}>()

const emit = defineEmits<{
    'update:open': [open: boolean]
    'preview-version': [version: DocumentDraftVersion]
    'restore-version': [version: DocumentDraftVersion]
    'export-version': [version: DocumentDraftVersion]
    'delete-version': [version: DocumentDraftVersion]
    'rename-version': [id: number, name: string]
    'apply-snapshot-field': [snapshotId: number, fieldName: string]
    'apply-snapshot-all': [snapshotId: number]
}>()

const activeTab = ref<'versions' | 'snapshots'>('versions')
const activeSnapshot = ref<DocumentDraftSnapshot | null>(null)

function onUpdate(v: boolean) {
    emit('update:open', v)
}

function onViewSnapshot(snapshot: DocumentDraftSnapshot) {
    activeSnapshot.value = snapshot
}

function onBackToList() {
    activeSnapshot.value = null
}

function onApplyField(fieldName: string) {
    if (!activeSnapshot.value) return
    emit('apply-snapshot-field', activeSnapshot.value.id, fieldName)
}

function onApplyAll() {
    if (!activeSnapshot.value) return
    emit('apply-snapshot-all', activeSnapshot.value.id)
}
</script>

<template>
    <Sheet :open="open" @update:open="onUpdate">
        <SheetContent side="right" class="w-full sm:w-[50vw] sm:max-w-[50vw] z-[70] p-0 flex flex-col">
            <SheetHeader class="shrink-0">
                <SheetTitle>历史</SheetTitle>
                <SheetDescription>查看已保存的版本与 AI 自动快照</SheetDescription>
            </SheetHeader>
            <Tabs v-model="activeTab" class="flex-1 min-h-0 flex flex-col px-4 pb-4">
                <TabsList class="grid grid-cols-2 w-full shrink-0">
                    <TabsTrigger value="versions">版本（{{ versions.length }}）</TabsTrigger>
                    <TabsTrigger value="snapshots">快照（{{ snapshots.length }}）</TabsTrigger>
                </TabsList>
                <TabsContent value="versions" class="mt-2 flex-1 min-h-0 overflow-y-auto">
                    <AssistantDocumentVersionList :versions="versions"
                        @preview="(v: DocumentDraftVersion) => emit('preview-version', v)"
                        @restore="(v: DocumentDraftVersion) => emit('restore-version', v)"
                        @export-version="(v: DocumentDraftVersion) => emit('export-version', v)"
                        @delete="(v: DocumentDraftVersion) => emit('delete-version', v)"
                        @rename="(id: number, n: string) => emit('rename-version', id, n)" />
                </TabsContent>
                <TabsContent value="snapshots" class="mt-2 flex-1 min-h-0 overflow-y-auto">
                    <div v-if="!activeSnapshot">
                        <AssistantDocumentSnapshotList :snapshots="snapshots"
                            @view-detail="onViewSnapshot" />
                    </div>
                    <div v-else class="space-y-2">
                        <Button size="sm" variant="ghost" @click="onBackToList">
                            ← 返回列表
                        </Button>
                        <AssistantDocumentSnapshotDetail :snapshot="activeSnapshot"
                            :current-values="currentValues"
                            @apply-field="onApplyField"
                            @apply-all="onApplyAll" />
                    </div>
                </TabsContent>
            </Tabs>
        </SheetContent>
    </Sheet>
</template>

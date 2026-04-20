<script setup lang="ts">
/**
 * AllMaterialsSheet —— 文书助手"所有材料"只读 Sheet
 *
 * **Feature: document-case-materials-sync (Task 10)**
 *
 * 只读约束：
 * - 不含任何上传/编辑/解绑按钮，仅 emit preview-material
 * - 新增/编辑/解绑走已有通道（agent chat 文件按钮上传；案件材料 Tab 解绑）
 */

import { FolderIcon } from 'lucide-vue-next'
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'

defineProps<{
    open: boolean
    materials: CaseDetailMaterialItem[]
    loading?: boolean
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    'preview-material': [material: CaseDetailMaterialItem]
}>()
</script>

<template>
    <Sheet :open="open" @update:open="(v: boolean) => emit('update:open', v)">
        <SheetContent side="right" class="w-full sm:w-[50vw] sm:max-w-[720px] z-[70] p-0 flex flex-col">
            <SheetHeader class="shrink-0 p-4 border-b">
                <SheetTitle>所有材料</SheetTitle>
                <SheetDescription>
                    本草稿与所属案件共享的全部材料（{{ materials.length }}）
                </SheetDescription>
            </SheetHeader>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
                <div v-if="!materials.length" class="text-center py-10 text-muted-foreground">
                    <FolderIcon class="size-10 opacity-40 mx-auto mb-2" />
                    暂无材料
                </div>
                <ul v-else class="divide-y">
                    <li v-for="m in materials" :key="m.id"
                        class="flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer"
                        @click="emit('preview-material', m)">
                        <component :is="getMaterialIcon(m.type)" class="size-5 shrink-0" />
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium truncate">{{ m.name }}</p>
                            <p class="text-xs text-muted-foreground">
                                {{ m.typeText }}<span v-if="m.fileSize"> · {{ formatByteSize(m.fileSize, 0) }}</span>
                            </p>
                        </div>
                    </li>
                </ul>
            </div>
        </SheetContent>
    </Sheet>
</template>

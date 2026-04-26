<script setup lang="ts">
/**
 * AllMaterialsSheet —— 文书助手"所有材料" Sheet
 *
 * **Feature: document-case-materials-sync**
 *
 * - 列表显示本草稿与所属案件共享的材料
 * - 点击行 emit preview-material
 * - 悬停行右侧显示删除按钮，emit delete（软删 case_materials，与案件材料 Tab 行为等价）
 */

import { FolderIcon, Trash2Icon } from 'lucide-vue-next'
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import { formatByteSize } from '#shared/utils/unitConverision'
import { getMaterialIcon } from '~/utils/caseMaterial'

defineProps<{
    open: boolean
    materials: CaseDetailMaterialItem[]
    loading?: boolean
    showDelete?: boolean
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    'preview-material': [material: CaseDetailMaterialItem]
    'delete': [material: CaseDetailMaterialItem]
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
                        class="group flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer"
                        @click="emit('preview-material', m)">
                        <component :is="getMaterialIcon(m.type)" class="size-5 shrink-0" />
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium truncate">{{ m.name }}</p>
                            <p class="text-xs text-muted-foreground">
                                {{ m.typeText }}<span v-if="m.fileSize"> · {{ formatByteSize(m.fileSize, 0) }}</span>
                            </p>
                        </div>
                        <button v-if="showDelete" type="button" title="删除该材料"
                            class="shrink-0 p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                            @click.stop="emit('delete', m)">
                            <Trash2Icon class="size-4" />
                        </button>
                    </li>
                </ul>
            </div>
        </SheetContent>
    </Sheet>
</template>

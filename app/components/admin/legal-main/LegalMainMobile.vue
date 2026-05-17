<template>
    <!-- 移动端法律法规卡片列表 -->
    <div class="md:hidden space-y-2">
        <div v-for="(legal, index) in legalList" :key="legal.id" class="bg-card rounded-lg border overflow-hidden">
            <!-- 卡片头部 - 可点击展开 -->
            <div class="p-3 cursor-pointer" @click="$emit('toggle-expand', legal.id)">
                <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                        <div class="w-5 h-5 rounded flex items-center justify-center bg-muted/50 shrink-0">
                            <ChevronDown v-if="expandedRows.has(legal.id)" class="w-3.5 h-3.5 text-primary" />
                            <ChevronRight v-else class="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span class="text-xs text-muted-foreground shrink-0">{{ startIndex + index + 1 }}</span>
                        <span class="font-medium truncate text-foreground"
                            @click.stop="$emit('view-detail', legal.id)">
                            {{ legal.name }}
                        </span>
                    </div>
                    <GeneralLegalStatusBadge :effective-date="legal.effectiveDate" :invalid-date="legal.invalidDate" />
                </div>
                <div class="flex items-center gap-2 mt-1.5 pl-7">
                    <GeneralLegalTypeBadge :type="legal.type" />
                    <span v-if="legal.issuingAuthority" class="text-xs text-muted-foreground">
                        {{ legal.issuingAuthority }}
                    </span>
                </div>
            </div>
            <!-- 展开内容 -->
            <div v-if="expandedRows.has(legal.id)" class="border-t bg-muted/30 p-3 space-y-3">
                <!-- 详细信息 -->
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <p class="text-muted-foreground mb-0.5">文号</p>
                        <p class="font-medium">{{ legal.documentNumber || '-' }}</p>
                    </div>
                    <div>
                        <p class="text-muted-foreground mb-0.5">发布日期</p>
                        <p class="font-medium">{{ legal.publishDate || '-' }}</p>
                    </div>
                    <div>
                        <p class="text-muted-foreground mb-0.5">生效日期</p>
                        <p class="font-medium">{{ legal.effectiveDate || '-' }}</p>
                    </div>
                    <div>
                        <p class="text-muted-foreground mb-0.5">失效日期</p>
                        <p class="font-medium">{{ legal.invalidDate || '-' }}</p>
                    </div>
                </div>
                <!-- 操作按钮 -->
                <div class="flex items-center gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" :class="['flex-1 h-8 text-xs', adminBrandFocusClass]"
                        @click.stop="$emit('view-articles', legal.id)">
                        <FileText class="h-3 w-3 mr-1" />
                        条文
                    </Button>
                    <Button variant="outline" size="sm" :class="['flex-1 h-8 text-xs', adminBrandFocusClass]"
                        @click.stop="$emit('edit', legal.id)">
                        <Pencil class="h-3 w-3 mr-1" />
                        编辑
                    </Button>
                    <Button variant="outline" size="sm" :class="['h-8 text-xs text-destructive hover:text-destructive', adminBrandFocusClass]"
                        @click.stop="$emit('delete', legal)">
                        <Trash2 class="h-3 w-3" />
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ChevronRight, ChevronDown, FileText, Pencil, Trash2 } from 'lucide-vue-next'
import type { LegalMainListItem } from '#shared/types/legal'
import GeneralLegalStatusBadge from '~/components/general/legal/LegalStatusBadge.vue'
import GeneralLegalTypeBadge from '~/components/general/legal/LegalTypeBadge.vue'
import { adminBrandFocusClass } from '~/utils/adminBrandStyles'

// 定义 props
defineProps<{
    legalList: LegalMainListItem[]
    expandedRows: Set<string>
    startIndex: number
}>()

// 定义事件
defineEmits<{
    'toggle-expand': [id: string]
    'view-detail': [id: string]
    'view-articles': [id: string]
    edit: [id: string]
    delete: [legal: LegalMainListItem]
}>()
</script>

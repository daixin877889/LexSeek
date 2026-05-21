<template>
    <!-- 桌面端法律法规折叠表格 -->
    <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="w-10 px-2 py-3"></th>
                    <th class="px-4 py-3 text-left text-sm font-medium w-16">序号</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">法律名称</th>
                    <th class="px-4 py-3 text-left text-sm font-medium w-24">类型</th>
                    <th class="px-4 py-3 text-center text-sm font-medium w-24">状态</th>
                    <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="(legal, index) in legalList" :key="legal.id">
                    <!-- 主行 - 可点击展开 -->
                    <tr class="border-b cursor-pointer transition-colors group hover:bg-muted/30"
                        @click="$emit('toggle-expand', legal.id)">
                        <!-- 展开图标 -->
                        <td class="px-2 py-2.5 text-center">
                            <div
                                class="w-6 h-6 rounded flex items-center justify-center bg-muted/50 group-hover:bg-primary/10 transition-colors">
                                <ChevronDown v-if="expandedRows.has(legal.id)"
                                    class="w-4 h-4 text-primary transition-transform" />
                                <ChevronRight v-else
                                    class="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                        </td>
                        <!-- 序号 -->
                        <td class="px-4 py-2.5 text-sm text-muted-foreground">
                            {{ startIndex + index + 1 }}
                        </td>
                        <!-- 法律名称（点击进入详情页） -->
                        <td class="py-2.5" @click.stop="$emit('view-detail', legal.id)">
                            <span class="font-medium text-foreground hover:underline cursor-pointer">
                                {{ legal.name }}
                            </span>
                        </td>
                        <!-- 类型 -->
                        <td class="px-4 py-2.5">
                            <GeneralLegalTypeBadge :type="legal.type" />
                        </td>
                        <!-- 状态 -->
                        <td class="px-4 py-2.5 text-center">
                            <GeneralLegalStatusBadge :effective-date="legal.effectiveDate"
                                :invalid-date="legal.invalidDate" />
                        </td>
                        <!-- 操作 - 阻止点击事件冒泡 -->
                        <td class="px-4 py-2.5 text-center" @click.stop>
                            <div class="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="icon" :class="['h-7 w-7', adminBrandFocusClass]" title="查看条文"
                                    @click="$emit('view-articles', legal.id)">
                                    <FileText class="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" :class="['h-7 w-7', adminBrandFocusClass]" title="编辑"
                                    @click="$emit('edit', legal.id)">
                                    <Pencil class="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon"
                                    :class="['h-7 w-7 text-destructive hover:text-destructive', adminBrandFocusClass]" title="删除"
                                    @click="$emit('delete', legal)">
                                    <Trash2 class="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </td>
                    </tr>
                    <!-- 展开详情行 -->
                    <tr v-if="expandedRows.has(legal.id)" class="bg-primary/5 border-b">
                        <td colspan="6" class="px-4 py-4">
                            <div class="pl-8 space-y-4">
                                <!-- 法律代码（单独一行） -->
                                <div class="text-sm">
                                    <p class="text-muted-foreground mb-1">法律代码</p>
                                    <p class="font-mono text-xs break-all">{{ legal.code }}</p>
                                </div>
                                <!-- 基本信息 -->
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <p class="text-muted-foreground mb-1">发文机关</p>
                                        <p class="font-medium">{{ legal.issuingAuthority || '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">文号</p>
                                        <p class="font-medium">{{ legal.documentNumber || '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">发布日期</p>
                                        <p class="font-medium">{{ legal.publishDate || '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">生效日期</p>
                                        <p class="font-medium">{{ legal.effectiveDate || '-' }}</p>
                                    </div>
                                </div>
                                <!-- 其他信息 -->
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <p class="text-muted-foreground mb-1">失效日期</p>
                                        <p class="font-medium">{{ legal.invalidDate || '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">创建时间</p>
                                        <p class="font-medium">{{ formatDate(legal.createdAt) }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">最后编辑</p>
                                        <p class="font-medium">{{ formatDate(legal.lastEditedAt) }}</p>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>
</template>

<script setup lang="ts">
import { ChevronRight, ChevronDown, FileText, Pencil, Trash2 } from 'lucide-vue-next'
import dayjs from 'dayjs'
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

/** 格式化日期 */
const formatDate = (date: string | Date | null | undefined): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}
</script>

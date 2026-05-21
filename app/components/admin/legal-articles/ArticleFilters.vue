<template>
    <!-- 条文筛选区域 -->
    <div class="theme-brand bg-card rounded-lg border p-4">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <!-- 关键词搜索 -->
            <div class="md:col-span-2">
                <Label class="text-sm text-muted-foreground mb-1.5 block">关键词搜索</Label>
                <Input v-model="localFilters.keyword" placeholder="搜索内容、标题..." :class="['w-full', adminBrandFocusClass]" />
            </div>
            <!-- 条文类型 -->
            <div>
                <Label class="text-sm text-muted-foreground mb-1.5 block">条文类型</Label>
                <Select v-model="localFilters.type">
                    <SelectTrigger :class="['w-full', adminBrandFocusClass]">
                        <SelectValue placeholder="全部类型" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="notice">通知</SelectItem>
                        <SelectItem value="header">正文头部</SelectItem>
                        <SelectItem value="footer">正文尾部</SelectItem>
                        <SelectItem value="annex">附件</SelectItem>
                        <SelectItem value="l1">编</SelectItem>
                        <SelectItem value="l2">分编</SelectItem>
                        <SelectItem value="l3">章</SelectItem>
                        <SelectItem value="l4">节</SelectItem>
                        <SelectItem value="l5">条</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <!-- 操作按钮 -->
            <div class="flex items-end gap-2">
                <Button @click="handleSearch" :class="['flex-1', adminBrandPrimaryButtonClass]">
                    <Search class="h-4 w-4 mr-2" />
                    搜索
                </Button>
                <Button variant="outline" :class="adminBrandFocusClass" @click="handleReset">
                    <RotateCcw class="h-4 w-4" />
                </Button>
            </div>
        </div>
        <!-- 高级筛选（可折叠） -->
        <Collapsible v-model:open="showAdvancedFilters" class="mt-4">
            <CollapsibleTrigger
                :class="['flex items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors', adminBrandFocusClass]">
                <ChevronDown v-if="showAdvancedFilters" class="h-4 w-4" />
                <ChevronRight v-else class="h-4 w-4" />
                高级筛选
            </CollapsibleTrigger>
            <CollapsibleContent class="mt-4">
                <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                        <Label class="text-sm text-muted-foreground mb-1.5 block">编 (L1)</Label>
                        <Input v-model="localFilters.l1" placeholder="如：第一编" :class="adminBrandFocusClass" />
                    </div>
                    <div>
                        <Label class="text-sm text-muted-foreground mb-1.5 block">分编 (L2)</Label>
                        <Input v-model="localFilters.l2" placeholder="如：第一分编" :class="adminBrandFocusClass" />
                    </div>
                    <div>
                        <Label class="text-sm text-muted-foreground mb-1.5 block">章 (L3)</Label>
                        <Input v-model="localFilters.l3" placeholder="如：第一章" :class="adminBrandFocusClass" />
                    </div>
                    <div>
                        <Label class="text-sm text-muted-foreground mb-1.5 block">节 (L4)</Label>
                        <Input v-model="localFilters.l4" placeholder="如：第一节" :class="adminBrandFocusClass" />
                    </div>
                    <div>
                        <Label class="text-sm text-muted-foreground mb-1.5 block">条 (L5)</Label>
                        <Input v-model="localFilters.l5" placeholder="如：第一条" :class="adminBrandFocusClass" />
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    </div>
</template>

<script setup lang="ts">
import { Search, RotateCcw, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

// 筛选条件类型
interface ArticleFilters {
    keyword: string
    type: string
    l1: string
    l2: string
    l3: string
    l4: string
    l5: string
}

// 定义 props
const props = defineProps<{
    filters: ArticleFilters
}>()

// 定义事件
const emit = defineEmits<{
    search: [filters: ArticleFilters]
    reset: []
}>()

// 本地筛选条件（双向绑定）
const localFilters = ref<ArticleFilters>({ ...props.filters })

// 是否显示高级筛选
const showAdvancedFilters = ref(false)

// 监听 props 变化，同步到本地
watch(() => props.filters, (newFilters) => {
    localFilters.value = { ...newFilters }
}, { deep: true })

// 搜索
const handleSearch = () => {
    emit('search', { ...localFilters.value })
}

// 重置
const handleReset = () => {
    localFilters.value = {
        keyword: '',
        type: 'all',
        l1: '',
        l2: '',
        l3: '',
        l4: '',
        l5: '',
    }
    emit('reset')
}
</script>

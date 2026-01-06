<template>
    <div class="bg-card rounded-lg border p-6">
        <!-- Tab 切换（替代标题） -->
        <div class="mb-4">
            <Tabs :model-value="activeTab"
                @update:model-value="(val) => emit('update:activeTab', val as 'legal' | 'article')">
                <TabsList>
                    <TabsTrigger value="legal">搜全文</TabsTrigger>
                    <TabsTrigger value="article">搜法条</TabsTrigger>
                </TabsList>
            </Tabs>
        </div>

        <!-- 搜索框 -->
        <div class="mb-4">
            <div class="relative">
                <Input v-if="activeTab === 'legal'" :model-value="keyword"
                    @update:model-value="(val) => emit('update:keyword', val as string)" type="text"
                    placeholder="输入法律名称或文号进行搜索..." class="w-full pl-10 h-11" @keyup.enter="handleSearch"
                    :disabled="loading" />
                <Input v-else :model-value="articleQuery"
                    @update:model-value="(val) => emit('update:articleQuery', val as string)" type="text"
                    placeholder="输入法条内容或相关描述进行语义搜索..." class="w-full pl-10 h-11" @keyup.enter="handleSearch"
                    :disabled="loading" />
                <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
        </div>

        <!-- 筛选条件 -->
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <!-- 法律类型筛选 -->
            <div>
                <label class="block text-sm font-medium text-foreground mb-2">法律类型</label>
                <Select :model-value="internalType" @update:model-value="handleTypeChange($event as string)">
                    <SelectTrigger class="w-full">
                        <SelectValue placeholder="选择类型..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="law">法律</SelectItem>
                        <SelectItem value="regulation">行政法规</SelectItem>
                        <SelectItem value="judicial_interp">司法解释</SelectItem>
                        <SelectItem value="guideline">指导意见</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- 发文机关筛选（仅搜全文模式） -->
            <div v-if="activeTab === 'legal'">
                <label class="block text-sm font-medium text-foreground mb-2">发文机关</label>
                <Popover v-model:open="authorityPopoverOpen">
                    <PopoverTrigger as-child>
                        <Button variant="outline" role="combobox" class="w-full justify-between font-normal px-3">
                            <span class="truncate" :class="!issuingAuthority ? 'text-muted-foreground' : ''">
                                {{ issuingAuthority || '全部机关' }}
                            </span>
                            <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[300px] p-0" align="start">
                        <!-- 搜索框 -->
                        <div class="p-2 border-b">
                            <Input v-model="authoritySearchTerm" placeholder="搜索发文机关..." class="h-8" />
                        </div>
                        <!-- 选项列表 -->
                        <div class="max-h-[250px] overflow-y-auto p-1">
                            <!-- 全部机关选项 -->
                            <div class="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm"
                                @click="selectAuthority(null)">
                                <Check class="h-4 w-4" :class="!issuingAuthority ? 'opacity-100' : 'opacity-0'" />
                                <span>全部机关</span>
                            </div>
                            <Separator class="my-1" />

                            <!-- 无结果提示 -->
                            <div v-if="filteredAuthorities.length === 0"
                                class="py-6 text-center text-sm text-muted-foreground">
                                未找到匹配的发文机关
                            </div>

                            <!-- 选项 -->
                            <div v-for="authority in filteredAuthorities" :key="authority"
                                class="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm"
                                @click="selectAuthority(authority)">
                                <Check class="h-4 w-4"
                                    :class="issuingAuthority === authority ? 'opacity-100' : 'opacity-0'" />
                                <span class="truncate">{{ authority }}</span>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            <!-- 生效状态筛选 -->
            <div>
                <label class="block text-sm font-medium text-foreground mb-2">生效状态</label>
                <Select :model-value="internalValidityStatus"
                    @update:model-value="handleValidityStatusChange($event as string)">
                    <SelectTrigger class="w-full">
                        <SelectValue placeholder="选择状态..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="valid">现行有效</SelectItem>
                        <SelectItem value="pending">尚未生效</SelectItem>
                        <SelectItem value="invalid">已失效</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- 占位（搜法条模式下需要占位以保持布局） -->
            <div v-if="activeTab === 'article'" class="hidden xl:block" />

            <!-- 操作按钮 -->
            <div class="flex items-end gap-3">
                <Button @click="handleSearch" :disabled="!canSearch || loading" class="flex-1">
                    <template v-if="loading">
                        <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                        搜索中
                    </template>
                    <template v-else>
                        <Search class="h-4 w-4 mr-2" />
                        搜索
                    </template>
                </Button>
                <Button variant="outline" @click="handleReset">
                    重置
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Search, ChevronsUpDown, Check, Loader2 } from 'lucide-vue-next'
import type { ValidityStatus } from '#shared/types/legal-search'
import { LegalType } from '#shared/types/legal'

// ==================== Props ====================

interface Props {
    /** 当前激活的 Tab */
    activeTab: 'legal' | 'article'
    /** 搜全文关键词 */
    keyword?: string
    /** 搜法条查询 */
    articleQuery?: string
    /** 法律类型（搜全文） */
    type?: LegalType | null
    /** 法律类型（搜法条） */
    articleType?: LegalType | null
    /** 选中的发文机关 */
    issuingAuthority?: string | null
    /** 生效状态（搜全文） */
    validityStatus?: ValidityStatus
    /** 生效状态（搜法条） */
    articleValidityStatus?: ValidityStatus
    /** 发文机关选项列表 */
    issuingAuthoritiesOptions?: string[]
    /** 加载状态 */
    loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    keyword: '',
    articleQuery: '',
    type: null,
    articleType: null,
    issuingAuthority: null,
    validityStatus: 'valid',
    articleValidityStatus: 'valid',
    issuingAuthoritiesOptions: () => [],
    loading: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    'update:activeTab': [value: 'legal' | 'article']
    'update:keyword': [value: string]
    'update:articleQuery': [value: string]
    'update:type': [value: LegalType | null]
    'update:articleType': [value: LegalType | null]
    'update:issuingAuthority': [value: string | null]
    'update:validityStatus': [value: ValidityStatus]
    'update:articleValidityStatus': [value: ValidityStatus]
    search: []
    reset: []
}>()

// ==================== 响应式状态 ====================

/** 发文机关下拉框是否打开 */
const authorityPopoverOpen = ref(false)

/** 发文机关搜索关键词 */
const authoritySearchTerm = ref('')

// ==================== 计算属性 ====================

/** 是否可以搜索 */
const canSearch = computed(() => {
    if (props.activeTab === 'legal') {
        return !!props.keyword?.trim()
    } else {
        return !!props.articleQuery?.trim()
    }
})

/** 筛选后的发文机关列表 */
const filteredAuthorities = computed(() => {
    if (!authoritySearchTerm.value.trim()) {
        return props.issuingAuthoritiesOptions
    }
    const query = authoritySearchTerm.value.toLowerCase()
    return props.issuingAuthoritiesOptions.filter(authority =>
        authority.toLowerCase().includes(query)
    )
})

/** 法律类型内部值 */
const internalType = computed(() => {
    if (props.activeTab === 'legal') {
        return props.type || 'all'
    } else {
        return props.articleType || 'all'
    }
})

/** 生效状态内部值 */
const internalValidityStatus = computed(() => {
    if (props.activeTab === 'legal') {
        return props.validityStatus || 'valid'
    } else {
        return props.articleValidityStatus || 'valid'
    }
})

// ==================== 方法 ====================

/** 选择发文机关 */
const selectAuthority = (authority: string | null) => {
    emit('update:issuingAuthority', authority)
    authorityPopoverOpen.value = false
    authoritySearchTerm.value = ''
}

/** 处理法律类型变化 */
const handleTypeChange = (val: string) => {
    const newType = val === 'all' ? null : val as LegalType
    if (props.activeTab === 'legal') {
        emit('update:type', newType)
    } else {
        emit('update:articleType', newType)
    }
}

/** 处理生效状态变化 */
const handleValidityStatusChange = (val: string) => {
    const newStatus = val as ValidityStatus
    if (props.activeTab === 'legal') {
        emit('update:validityStatus', newStatus)
    } else {
        emit('update:articleValidityStatus', newStatus)
    }
}

/** 处理搜索 */
const handleSearch = () => {
    if (!canSearch.value) return
    emit('search')
}

/** 处理重置 */
const handleReset = () => {
    authoritySearchTerm.value = ''
    emit('reset')
}
</script>

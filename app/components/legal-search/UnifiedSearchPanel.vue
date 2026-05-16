<template>
    <div class="bg-card rounded-xl border overflow-hidden">
        <!-- 模式切换 Tab（下划线式） -->
        <div class="flex gap-1 px-4 pt-3.5">
            <button v-for="t in TAB_OPTIONS" :key="t.value" type="button"
                class="mr-3.5 border-b-2 px-1 pb-2 text-sm transition-colors"
                :class="activeTab === t.value
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-muted-foreground font-medium hover:text-foreground'"
                @click="emit('update:activeTab', t.value)">
                {{ t.label }}
            </button>
        </div>

        <!-- 搜索输入行 -->
        <div class="flex items-center gap-2.5 border-t px-4 py-3.5">
            <Search class="h-5 w-5 shrink-0 text-muted-foreground" />
            <input :value="activeTab === 'legal' ? keyword : articleQuery" :disabled="loading"
                :placeholder="activeTab === 'legal'
                    ? '输入法律名称或文号进行检索，例如：建设工程、民法典…'
                    : '输入法条内容或相关描述进行语义检索，例如：违约金过高如何调整…'"
                class="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
                @input="handleInput" @keyup.enter="handleSearch" />
            <Button class="shrink-0 bg-gradient-brand-button text-white" :disabled="!canSearch || loading"
                @click="handleSearch">
                <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
                检索
            </Button>
        </div>

        <!-- 筛选条件 -->
        <div class="border-t bg-muted/40 px-4 py-3">
            <!-- 法律类型胶囊组 -->
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs font-semibold text-muted-foreground">法律类型</span>
                <button v-for="lt in LEGAL_TYPE_OPTIONS" :key="lt.value" type="button"
                    class="rounded-md px-3 py-1 text-[13px] transition-colors"
                    :class="internalType === lt.value
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-foreground font-medium hover:bg-muted'"
                    @click="handleTypeChange(lt.value)">
                    {{ lt.label }}
                </button>
            </div>

            <!-- 发文机关 + 生效状态 + 重置 -->
            <div class="mt-3 flex flex-wrap items-center gap-4">
                <!-- 发文机关（仅搜全文） -->
                <div v-if="activeTab === 'legal'" class="flex items-center gap-2">
                    <span class="whitespace-nowrap text-xs font-semibold text-muted-foreground">发文机关</span>
                    <Popover v-model:open="authorityPopoverOpen">
                        <PopoverTrigger as-child>
                            <Button variant="outline" role="combobox" size="sm"
                                class="w-[200px] justify-between px-3 font-normal">
                                <span class="truncate" :class="!issuingAuthority ? 'text-muted-foreground' : ''">
                                    {{ issuingAuthority || '全部机关' }}
                                </span>
                                <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="w-[300px] p-0" align="start">
                            <!-- 搜索框 -->
                            <div class="border-b p-2">
                                <Input v-model="authoritySearchTerm" placeholder="搜索发文机关..." class="h-8" />
                            </div>
                            <!-- 选项列表 -->
                            <div class="max-h-[250px] overflow-y-auto p-1">
                                <div class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                                    @click="selectAuthority(null)">
                                    <Check class="h-4 w-4" :class="!issuingAuthority ? 'opacity-100' : 'opacity-0'" />
                                    <span>全部机关</span>
                                </div>
                                <Separator class="my-1" />
                                <div v-if="filteredAuthorities.length === 0"
                                    class="py-6 text-center text-sm text-muted-foreground">
                                    未找到匹配的发文机关
                                </div>
                                <div v-for="authority in filteredAuthorities" :key="authority"
                                    class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                                    @click="selectAuthority(authority)">
                                    <Check class="h-4 w-4"
                                        :class="issuingAuthority === authority ? 'opacity-100' : 'opacity-0'" />
                                    <span class="truncate">{{ authority }}</span>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                <!-- 生效状态 -->
                <div class="flex items-center gap-2">
                    <span class="whitespace-nowrap text-xs font-semibold text-muted-foreground">生效状态</span>
                    <Select :model-value="internalValidityStatus"
                        @update:model-value="handleValidityStatusChange($event as string)">
                        <SelectTrigger class="w-[140px]">
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

                <Button variant="outline" size="sm" class="ml-auto" @click="handleReset">
                    重置筛选
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Search, ChevronsUpDown, Check, Loader2 } from 'lucide-vue-next'
import type { ValidityStatusFilter } from '#shared/types/legal-search'
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
    validityStatus?: ValidityStatusFilter
    /** 生效状态（搜法条） */
    articleValidityStatus?: ValidityStatusFilter
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
    'update:validityStatus': [value: ValidityStatusFilter]
    'update:articleValidityStatus': [value: ValidityStatusFilter]
    search: []
    reset: []
}>()

// ==================== 常量 ====================

/** 模式切换 Tab 选项 */
const TAB_OPTIONS = [
    { value: 'legal', label: '搜全文' },
    { value: 'article', label: '搜法条' },
] as const

/** 法律类型筛选选项 */
const LEGAL_TYPE_OPTIONS = [
    { value: 'all', label: '全部' },
    { value: 'law', label: '法律' },
    { value: 'regulation', label: '行政法规' },
    { value: 'judicial_interp', label: '司法解释' },
    { value: 'guideline', label: '指导意见' },
] as const

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

/** 处理搜索框输入 */
const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    if (props.activeTab === 'legal') {
        emit('update:keyword', value)
    } else {
        emit('update:articleQuery', value)
    }
}

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
    const newStatus = val as ValidityStatusFilter
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

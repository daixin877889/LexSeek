<template>
    <div class="bg-card rounded-lg border p-6">
        <!-- 搜索框 -->
        <div class="mb-6">
            <label class="block text-sm font-medium text-foreground mb-3">搜索法律法规</label>
            <div class="relative">
                <Input :model-value="keyword" @update:model-value="(val) => emit('update:keyword', val as string)"
                    type="text" placeholder="输入法律名称或文号进行搜索..." class="w-full pl-10 h-11" @keyup.enter="handleSearch" />
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

            <!-- 发文机关筛选（单选+搜索） -->
            <div>
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
                <Select :model-value="internalValidOnly" @update:model-value="handleValidOnlyChange($event as string)">
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

            <!-- 操作按钮 -->
            <div class="flex items-end gap-3">
                <Button @click="handleSearch" :disabled="!keyword?.trim()" class="flex-1">
                    <Search class="h-4 w-4 mr-2" />
                    搜索
                </Button>
                <Button variant="outline" @click="handleReset">
                    重置
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Search, ChevronsUpDown, Check } from 'lucide-vue-next'
import type { LegalSearchFilters, ValidityStatus } from '#shared/types/legal-search'
import { LegalType } from '#shared/types/legal'

// ==================== Props ====================

interface Props {
    /** 搜索关键词 */
    keyword?: string
    /** 法律类型 */
    type?: LegalType | null
    /** 选中的发文机关（单选） */
    issuingAuthority?: string | null
    /** 生效状态 */
    validityStatus?: ValidityStatus
    /** 发文机关选项列表 */
    issuingAuthoritiesOptions?: string[]
    /** 加载状态 */
    loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    keyword: '',
    type: null,
    issuingAuthority: null,
    validityStatus: 'all',
    issuingAuthoritiesOptions: () => [],
    loading: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    'update:keyword': [value: string]
    'update:type': [value: LegalType | null]
    'update:issuingAuthority': [value: string | null]
    'update:validityStatus': [value: ValidityStatus]
    search: [keyword: string]
    filtersChange: [filters: Partial<LegalSearchFilters>]
    reset: []
}>()

// ==================== 响应式状态 ====================

/** 发文机关下拉框是否打开 */
const authorityPopoverOpen = ref(false)

/** 发文机关搜索关键词 */
const authoritySearchTerm = ref('')

// ==================== 计算属性 ====================

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
const internalType = computed(() => props.type || 'all')

/** 生效状态内部值 */
const internalValidOnly = computed(() => props.validityStatus || 'all')

// ==================== 方法 ====================

/** 选择发文机关 */
const selectAuthority = (authority: string | null) => {
    emit('update:issuingAuthority', authority)
    authorityPopoverOpen.value = false
    authoritySearchTerm.value = ''
    // 直接传递新值，因为此时 props 还没更新
    emitFiltersChange({ issuingAuthority: authority })
}

/** 处理法律类型变化 */
const handleTypeChange = (val: string) => {
    const newType = val === 'all' ? null : val as LegalType
    emit('update:type', newType)
    emitFiltersChange({ type: newType })
}

/** 处理生效状态变化 */
const handleValidOnlyChange = (val: string) => {
    const newStatus = val as ValidityStatus
    emit('update:validityStatus', newStatus)
    emitFiltersChange({ validityStatus: newStatus })
}

/** 处理搜索 */
const handleSearch = () => {
    if (!props.keyword?.trim()) return
    emit('search', props.keyword)
}

/** 发送筛选条件变化事件 */
const emitFiltersChange = (overrides: Partial<LegalSearchFilters> = {}) => {
    const filters: Partial<LegalSearchFilters> = {
        type: props.type,
        issuingAuthority: props.issuingAuthority,
        validityStatus: props.validityStatus,
        ...overrides, // 使用传入的新值覆盖
    }
    emit('filtersChange', filters)
}

/** 处理重置 */
const handleReset = () => {
    authoritySearchTerm.value = ''
    emit('update:keyword', '')
    emit('update:type', null)
    emit('update:issuingAuthority', null)
    emit('update:validityStatus', 'all')
    emit('reset')
}
</script>

<template>
    <div class="demo-case-list">
        <!-- 标题区域 -->
        <div v-if="showTitle" class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
                <BookOpenIcon class="h-5 w-5 text-primary" />
                <h3 class="text-base font-medium text-foreground">示范案例</h3>
            </div>
            <span v-if="demoCases.length > 0" class="text-xs text-muted-foreground">
                {{ demoCases.length }} 个案例
            </span>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex items-center justify-center py-8">
            <LoaderIcon class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="demoCases.length === 0"
            class="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <FileTextIcon class="h-10 w-10 mb-3 opacity-40" />
            <p class="text-sm">暂无示范案例</p>
            <p class="text-xs mt-1">管理员可在后台添加示范案例</p>
        </div>

        <!-- 简洁列表模式（类似 Prompts 组件） -->
        <div v-else-if="layout === 'list' && !showCover" class="flex flex-wrap gap-2">
            <Button v-for="demoCase in demoCases" :key="demoCase.id" variant="outline" size="sm"
                class="h-auto py-2 px-3 text-left justify-start hover:bg-primary/5 hover:border-primary/30"
                :disabled="creating === demoCase.id" @click="handleCaseClick(demoCase)">
                <template v-if="creating === demoCase.id">
                    <LoaderIcon class="h-4 w-4 mr-2 animate-spin shrink-0" />
                    <span class="truncate">创建中...</span>
                </template>
                <template v-else>
                    <span class="truncate">{{ demoCase.title }}</span>
                </template>
            </Button>
        </div>

        <!-- 卡片列表模式 -->
        <div v-else :class="listClass">
            <div v-for="demoCase in demoCases" :key="demoCase.id"
                class="group cursor-pointer p-4 border rounded-xl bg-background hover:shadow-md hover:border-primary/30 transition-all"
                :class="{ 'opacity-60 pointer-events-none': creating === demoCase.id }"
                @click="handleCaseClick(demoCase)">
                <!-- 封面图片（可选） -->
                <div v-if="demoCase.coverImage && showCover"
                    class="relative h-32 overflow-hidden rounded-lg mb-3 -mx-1 -mt-1">
                    <img :src="demoCase.coverImage" :alt="demoCase.title"
                        class="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>

                <!-- 标题和标签 -->
                <div class="flex items-start justify-between gap-2 mb-2">
                    <h4 class="font-semibold line-clamp-1 group-hover:text-primary transition-colors">
                        {{ demoCase.title }}
                    </h4>
                    <Badge variant="secondary" class="shrink-0 text-xs">
                        {{ demoCase.caseTypeName }}
                    </Badge>
                </div>

                <!-- 描述 - 显示更多行 -->
                <p v-if="demoCase.description" class="text-sm text-muted-foreground line-clamp-3">
                    {{ demoCase.description }}
                </p>

                <!-- 加载状态 -->
                <div v-if="creating === demoCase.id" class="flex items-center gap-2 mt-3 text-primary">
                    <LoaderIcon class="h-4 w-4 animate-spin" />
                    <span class="text-xs">创建中...</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    BookOpenIcon,
    FileTextIcon,
    LoaderIcon,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

/**
 * 示范案例数据结构
 */
export interface DemoCaseItem {
    /** 案例 ID */
    id: number
    /** 案例标题 */
    title: string
    /** 案例描述 */
    description?: string
    /** 案件类型 ID */
    caseTypeId: number
    /** 案件类型名称 */
    caseTypeName: string
    /** 封面图片 */
    coverImage?: string
    /** 排序优先级 */
    priority: number
}

/**
 * 创建案件结果
 */
export interface CreateCaseResult {
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
}

/**
 * 组件 Props
 */
interface Props {
    /** 是否显示标题 */
    showTitle?: boolean
    /** 是否显示封面图片 */
    showCover?: boolean
    /** 案件类型筛选 */
    caseTypeId?: number
    /** 布局模式 */
    layout?: 'grid' | 'list'
    /** 每行显示数量（grid 模式） */
    columns?: 1 | 2 | 3 | 4
}

/**
 * 组件事件
 */
const emit = defineEmits<{
    /** 案件创建成功 */
    (e: 'case-created', result: CreateCaseResult): void
    /** 案件创建失败 */
    (e: 'case-error', error: Error): void
    /** 点击案例 */
    (e: 'case-click', demoCase: DemoCaseItem): void
}>()

const props = withDefaults(defineProps<Props>(), {
    showTitle: true,
    showCover: true,
    caseTypeId: undefined,
    layout: 'grid',
    columns: 2,
})

// 状态
const demoCases = ref<DemoCaseItem[]>([])
const loading = ref(false)
const creating = ref<number | null>(null)

// 计算列表样式
const listClass = computed(() => {
    if (props.layout === 'list') {
        return 'space-y-3'
    }

    const columnClasses: Record<number, string> = {
        1: 'grid grid-cols-1 gap-4',
        2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
        3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
        4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
    }

    return columnClasses[props.columns] || columnClasses[2]
})

/**
 * 加载示范案例列表
 */
const loadDemoCases = async () => {
    loading.value = true

    try {
        const query: Record<string, unknown> = {}
        if (props.caseTypeId) {
            query.caseTypeId = props.caseTypeId
        }

        const result = await useApiFetch<{ items: DemoCaseItem[] }>('/api/v1/demo-cases', {
            query,
            showError: true,
        })

        if (result?.items) {
            demoCases.value = result.items
        }
    } catch (error) {
        logger.error('加载示范案例失败:', error)
    } finally {
        loading.value = false
    }
}

/**
 * 处理案例点击
 */
const handleCaseClick = async (demoCase: DemoCaseItem) => {
    emit('case-click', demoCase)

    // 创建案件
    await createCaseFromDemo(demoCase)
}

/**
 * 使用示范案例创建案件
 */
const createCaseFromDemo = async (demoCase: DemoCaseItem) => {
    if (creating.value) return

    creating.value = demoCase.id

    try {
        const result = await useApiFetch<CreateCaseResult>(
            `/api/v1/demo-cases/create-case/${demoCase.id}`,
            {
                method: 'POST',
                showError: true,
            }
        )

        if (result) {
            toast.success('案件创建成功')
            emit('case-created', result)
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error('创建案件失败')
        emit('case-error', err)
    } finally {
        creating.value = null
    }
}

/**
 * 刷新列表
 */
const refresh = () => {
    loadDemoCases()
}

// 初始化加载
onMounted(() => {
    loadDemoCases()
})

// 监听筛选条件变化
watch(
    () => props.caseTypeId,
    () => {
        loadDemoCases()
    }
)

// 暴露方法
defineExpose({
    refresh,
    demoCases,
})
</script>

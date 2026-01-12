<template>
    <AiElementsConfirmationConfirmation :approval="approval" :state="confirmationState" class="w-full">
        <!-- 请求状态：等待用户选择 -->
        <AiElementsConfirmationConfirmationRequest>
            <div class="space-y-4">
                <!-- 标题和说明 -->
                <div class="space-y-2">
                    <AiElementsConfirmationConfirmationTitle class="flex items-center gap-2 text-base font-medium">
                        <LayoutGridIcon class="h-5 w-5 text-primary" />
                        {{ interrupt.message || '请选择分析模块' }}
                    </AiElementsConfirmationConfirmationTitle>
                    <p class="text-sm text-muted-foreground">
                        选择您需要执行的分析模块，系统将按顺序进行分析
                    </p>
                </div>

                <!-- 积分信息 -->
                <div class="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div class="flex items-center gap-2">
                        <CoinsIcon class="h-4 w-4 text-amber-500" />
                        <span class="text-sm">可用积分</span>
                    </div>
                    <span class="text-sm font-medium">{{ userAvailablePoints }}</span>
                </div>

                <!-- 积分不足提示 -->
                <Alert v-if="!hasEnoughPoints" variant="destructive">
                    <AlertCircleIcon class="h-4 w-4" />
                    <AlertDescription>
                        您的积分不足，请先充值后再进行分析
                    </AlertDescription>
                </Alert>

                <!-- 模块列表 -->
                <div class="space-y-3">
                    <!-- 全选/取消全选 -->
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <Checkbox id="select-all" :checked="isAllSelected" :indeterminate="isPartialSelected"
                                @update:checked="toggleSelectAll" :disabled="isSubmitting || !hasEnoughPoints" />
                            <Label for="select-all" class="text-sm cursor-pointer">
                                {{ isAllSelected ? '取消全选' : '全选' }}
                            </Label>
                        </div>
                        <div class="text-sm text-muted-foreground">
                            已选 {{ selectedModules.length }} 个模块，
                            预计消耗 <span class="font-medium text-foreground">{{ totalPointCost }}</span> 积分
                        </div>
                    </div>

                    <!-- 模块卡片列表 -->
                    <div class="grid gap-2">
                        <div v-for="module in availableModules" :key="module.nodeId"
                            class="flex items-start gap-3 p-3 border rounded-lg transition-colors cursor-pointer"
                            :class="[
                                isModuleSelected(module.nodeId)
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-muted-foreground/50',
                                !module.hasAccess ? 'opacity-50' : '',
                            ]" @click="toggleModule(module)">
                            <!-- 选择框 -->
                            <Checkbox :checked="isModuleSelected(module.nodeId)"
                                :disabled="!module.hasAccess || isSubmitting || !hasEnoughPoints" class="mt-0.5"
                                @click.stop @update:checked="() => toggleModule(module)" />

                            <!-- 模块信息 -->
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="font-medium">{{ module.title }}</span>
                                    <Badge v-if="module.type === 'document'" variant="secondary" class="text-xs">
                                        文书
                                    </Badge>
                                    <Badge v-if="!module.hasAccess" variant="outline" class="text-xs text-amber-600">
                                        <LockIcon class="h-3 w-3 mr-1" />
                                        需升级会员
                                    </Badge>
                                </div>
                                <p v-if="module.name !== module.title" class="text-xs text-muted-foreground mt-0.5">
                                    {{ module.name }}
                                </p>
                            </div>

                            <!-- 积分消耗 -->
                            <div class="shrink-0 text-right">
                                <div class="flex items-center gap-1">
                                    <CoinsIcon class="h-3.5 w-3.5 text-amber-500" />
                                    <span class="text-sm font-medium"
                                        :class="{ 'line-through text-muted-foreground': module.discount && module.discount < 1 }">
                                        {{ module.pointCost }}
                                    </span>
                                    <span v-if="module.discount && module.discount < 1"
                                        class="text-sm font-medium text-green-600">
                                        {{ Math.round(module.pointCost * module.discount) }}
                                    </span>
                                </div>
                                <Badge v-if="module.discount && module.discount < 1" variant="secondary"
                                    class="text-xs mt-1">
                                    {{ Math.round((1 - module.discount) * 100) }}% 折扣
                                </Badge>
                            </div>
                        </div>
                    </div>

                    <!-- 无可用模块提示 -->
                    <div v-if="availableModules.length === 0"
                        class="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <PackageXIcon class="h-8 w-8 mb-2 opacity-50" />
                        <p class="text-sm">暂无可用的分析模块</p>
                    </div>
                </div>

                <!-- 操作按钮 -->
                <AiElementsConfirmationConfirmationActions class="pt-2">
                    <AiElementsConfirmationConfirmationAction variant="outline" @click="handleCancel"
                        :disabled="isSubmitting">
                        取消
                    </AiElementsConfirmationConfirmationAction>
                    <AiElementsConfirmationConfirmationAction @click="handleSubmit"
                        :disabled="!canSubmit || isSubmitting">
                        <LoaderIcon v-if="isSubmitting" class="h-4 w-4 mr-2 animate-spin" />
                        {{ isSubmitting ? '提交中...' : `开始分析 (${totalPointCost} 积分)` }}
                    </AiElementsConfirmationConfirmationAction>
                </AiElementsConfirmationConfirmationActions>
            </div>
        </AiElementsConfirmationConfirmationRequest>

        <!-- 已接受状态 -->
        <AiElementsConfirmationConfirmationAccepted>
            <div class="flex items-center gap-2 text-green-600">
                <CheckCircleIcon class="h-5 w-5" />
                <span>已选择 {{ selectedModules.length }} 个分析模块</span>
            </div>
        </AiElementsConfirmationConfirmationAccepted>

        <!-- 已拒绝状态 -->
        <AiElementsConfirmationConfirmationRejected>
            <div class="flex items-center gap-2 text-muted-foreground">
                <XCircleIcon class="h-5 w-5" />
                <span>已取消选择</span>
            </div>
        </AiElementsConfirmationConfirmationRejected>
    </AiElementsConfirmationConfirmation>
</template>

<script setup lang="ts">
/**
 * 模块选择处理器（中断点3）
 *
 * 展示可用的分析模块列表，供用户选择要执行的模块
 * 显示每个模块的积分消耗和用户权限状态
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4
 */
import type { ModuleSelectInterruptData, AnalysisModuleInfo } from '@/composables/useCaseAnalysis'
import type { ExtendedToolState } from '@/components/ai-elements/types'
import type { ToolUIPartApproval } from '@/components/ai-elements/confirmation/context'
import {
    LayoutGridIcon,
    CoinsIcon,
    AlertCircleIcon,
    LockIcon,
    PackageXIcon,
    LoaderIcon,
    CheckCircleIcon,
    XCircleIcon,
} from 'lucide-vue-next'

/**
 * 组件 Props
 */
interface Props {
    /** 中断数据 */
    interrupt: ModuleSelectInterruptData
    /** 是否正在提交 */
    isSubmitting?: boolean
}

/**
 * 组件事件
 */
const emit = defineEmits<{
    /** 提交选择的模块 */
    (e: 'submit', selectedModules: string[]): void
    /** 取消操作 */
    (e: 'cancel'): void
}>()

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
})

// 状态
const selectedModuleIds = ref<Set<number>>(new Set())

// Confirmation 组件状态
const approval = ref<ToolUIPartApproval>({ id: 'module-select' })
const confirmationState = ref<ExtendedToolState>('approval-requested')

// 计算属性
const availableModules = computed(() => props.interrupt.data.availableModules || [])
const userAvailablePoints = computed(() => props.interrupt.data.userAvailablePoints || 0)
const hasEnoughPoints = computed(() => props.interrupt.data.hasEnoughPoints !== false)

// 可选择的模块（有权限的）
const selectableModules = computed(() => availableModules.value.filter(m => m.hasAccess))

// 已选择的模块列表
const selectedModules = computed(() => {
    return availableModules.value.filter(m => selectedModuleIds.value.has(m.nodeId))
})

// 总积分消耗
const totalPointCost = computed(() => {
    return selectedModules.value.reduce((total, module) => {
        const cost = module.discount ? Math.round(module.pointCost * module.discount) : module.pointCost
        return total + cost
    }, 0)
})

// 是否全选
const isAllSelected = computed(() => {
    return selectableModules.value.length > 0 &&
        selectableModules.value.every(m => selectedModuleIds.value.has(m.nodeId))
})

// 是否部分选择
const isPartialSelected = computed(() => {
    return selectedModuleIds.value.size > 0 && !isAllSelected.value
})

// 是否可以提交
const canSubmit = computed(() => {
    return selectedModuleIds.value.size > 0 &&
        hasEnoughPoints.value &&
        totalPointCost.value <= userAvailablePoints.value
})

/**
 * 检查模块是否被选中
 */
const isModuleSelected = (nodeId: number): boolean => {
    return selectedModuleIds.value.has(nodeId)
}

/**
 * 切换模块选择状态
 */
const toggleModule = (module: AnalysisModuleInfo) => {
    if (!module.hasAccess || props.isSubmitting || !hasEnoughPoints.value) return

    const newSet = new Set(selectedModuleIds.value)
    if (newSet.has(module.nodeId)) {
        newSet.delete(module.nodeId)
    } else {
        newSet.add(module.nodeId)
    }
    selectedModuleIds.value = newSet
}

/**
 * 全选/取消全选
 */
const toggleSelectAll = () => {
    if (isAllSelected.value) {
        // 取消全选
        selectedModuleIds.value = new Set()
    } else {
        // 全选（只选择有权限的）
        selectedModuleIds.value = new Set(selectableModules.value.map(m => m.nodeId))
    }
}

/**
 * 处理提交
 */
const handleSubmit = () => {
    if (!canSubmit.value) return

    // 获取选中模块的名称列表
    const moduleNames = selectedModules.value.map(m => m.name)

    // 更新状态
    approval.value = { id: 'module-select', approved: true }
    confirmationState.value = 'approval-responded'

    emit('submit', moduleNames)
}

/**
 * 处理取消
 */
const handleCancel = () => {
    approval.value = { id: 'module-select', approved: false, reason: '用户取消' }
    confirmationState.value = 'approval-responded'
    emit('cancel')
}

// 初始化：默认选中所有有权限的模块
onMounted(() => {
    if (selectableModules.value.length > 0) {
        selectedModuleIds.value = new Set(selectableModules.value.map(m => m.nodeId))
    }
})
</script>

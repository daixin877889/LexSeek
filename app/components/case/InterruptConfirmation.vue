<template>
    <div class="interrupt-confirmation">
        <!-- 案情信息检查中断（中断点1） -->
        <CaseInfoCheckHandler v-if="isCaseInfoCheck" :interrupt="interrupt as CaseInfoCheckInterruptData"
            :is-submitting="isSubmitting" @submit="handleCaseInfoSubmit" @cancel="handleCancel" />

        <!-- 基本信息确认中断（中断点2） -->
        <BasicInfoConfirmHandler v-else-if="isBasicInfoConfirm" :interrupt="interrupt as BasicInfoConfirmInterruptData"
            :is-submitting="isSubmitting" @submit="handleBasicInfoSubmit" @cancel="handleCancel" />

        <!-- 模块选择中断（中断点3） -->
        <ModuleSelectHandler v-else-if="isModuleSelect" :interrupt="interrupt as ModuleSelectInterruptData"
            :is-submitting="isSubmitting" @submit="handleModuleSelectSubmit" @cancel="handleCancel" />

        <!-- 未知中断类型 -->
        <Alert v-else variant="destructive" class="flex flex-col gap-2">
            <AlertDescription>
                未知的中断类型：{{ interrupt?.type }}
            </AlertDescription>
        </Alert>
    </div>
</template>

<script setup lang="ts">
/**
 * 中断确认组件
 *
 * 处理工作流中断事件，根据中断类型显示对应的交互界面：
 * - 中断点1：案情信息检查 - 提示用户补充案情信息
 * - 中断点2：基本信息确认 - 展示提取的信息供用户确认或修改
 * - 中断点3：模块选择 - 展示可用模块供用户选择
 *
 * @see Requirements 10.7, 4.4, 4.5, 4.6, 5.4, 5.5
 * @see design.md - AI 界面组件集成
 */
import type {
    InterruptData,
    CaseInfoCheckInterruptData,
    BasicInfoConfirmInterruptData,
    ModuleSelectInterruptData,
} from '#shared/types/case'
import {
    isCaseInfoCheckInterrupt,
    isBasicInfoConfirmInterrupt,
    isModuleSelectInterrupt,
} from '@/composables/useCaseAnalysis'
import { InterruptType } from '#shared/types/case'

// 子组件
import CaseInfoCheckHandler from './interrupt/CaseInfoCheckHandler.vue'
import BasicInfoConfirmHandler from './interrupt/BasicInfoConfirmHandler.vue'
import ModuleSelectHandler from './interrupt/ModuleSelectHandler.vue'

/**
 * 组件 Props
 */
interface Props {
    /** 中断数据 */
    interrupt: InterruptData | null
    /** 是否正在提交 */
    isSubmitting?: boolean
}

/**
 * 组件事件
 */
const emit = defineEmits<{
    /** 提交恢复数据 */
    (e: 'submit', data: unknown): void
    /** 取消操作 */
    (e: 'cancel'): void
}>()

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
})

// 计算属性：判断中断类型
const isCaseInfoCheck = computed(() => isCaseInfoCheckInterrupt(props.interrupt))
const isBasicInfoConfirm = computed(() => isBasicInfoConfirmInterrupt(props.interrupt))
const isModuleSelect = computed(() => isModuleSelectInterrupt(props.interrupt))

/**
 * 处理案情信息补充提交
 */
const handleCaseInfoSubmit = (supplementInfo: string) => {
    emit('submit', supplementInfo)
}

/**
 * 处理基本信息确认提交
 */
const handleBasicInfoSubmit = (confirmedInfo: unknown) => {
    emit('submit', confirmedInfo)
}

/**
 * 处理模块选择提交
 */
const handleModuleSelectSubmit = (selectedModules: string[]) => {
    emit('submit', { modules: selectedModules })
}

/**
 * 处理取消操作
 */
const handleCancel = () => {
    emit('cancel')
}
</script>

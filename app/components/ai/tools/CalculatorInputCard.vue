<script setup lang="ts">
/**
 * 办案计算器 interrupt 输入卡片
 *
 * 协议对齐 StanceSelectCard：
 * - props.interrupt: 来自 LangGraph interrupt() 的平铺对象（type + toolName + prefilled + missing）
 * - props.onResolve(value | null): null 表示用户取消，由 LangGraph resume 消费
 * - props.resumeValue: undefined = active 模式；值存在（含 null）= snapshot 模式（只读历史）
 */
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { Calculator, CircleCheck, Ban, Loader2, X } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import CalculatorFormFields from '~/components/ai/tools/CalculatorFormFields.vue'
import { CALCULATOR_TOOL_META, type CalcFieldMeta } from '#shared/utils/tools/agentTools/_fieldMetadata'

interface CalculatorInputInterrupt {
    type: 'calculator_input'
    toolName: string
    prefilled: Record<string, any>
    missing: string[]
}

const props = defineProps<{
    interrupt: CalculatorInputInterrupt
    onResolve?: (value: Record<string, any> | null) => Promise<void> | void
    /** snapshot 模式：传入用户之前 resolve 的值；undefined = active 模式 */
    resumeValue?: Record<string, any> | null
}>()

const isSnapshot = computed(() => props.resumeValue !== undefined)
const isCancelled = computed(() =>
    props.resumeValue === null
    || (props.resumeValue != null && (props.resumeValue as { cancelled?: boolean }).cancelled === true),
)

const displayName = computed(() =>
    CALCULATOR_TOOL_META[props.interrupt.toolName]?.displayName ?? props.interrupt.toolName,
)

const meta = computed(() => CALCULATOR_TOOL_META[props.interrupt.toolName])

// 初始化表单数据：优先用 snapshot 值，其次 prefilled
const formData = ref<Record<string, any>>({
    ...props.interrupt.prefilled,
    ...(isSnapshot.value && props.resumeValue ? props.resumeValue : {}),
})

const selectedBranch = ref<string>(
    (formData.value[meta.value?.branchField ?? ''] as string)
    ?? meta.value?.branchOptions?.[0]?.value
    ?? '',
)

const submitting = ref(false)
const confirmed = ref(isSnapshot.value)

const isValid = computed(() => {
    if (!meta.value) return false
    const requiredNames = meta.value.fields
        .filter((f: CalcFieldMeta) => f.required || f.requiredBy?.[selectedBranch.value])
        .map((f) => f.name)
    return requiredNames.every((n) => formData.value[n] !== undefined && formData.value[n] !== '')
})

// active 模式首次 mount 滚到视口
const cardRef = ref<HTMLElement | null>(null)
onMounted(() => {
    if (isSnapshot.value) return
    nextTick(() => {
        cardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
})

async function onSubmit() {
    if (!isValid.value || submitting.value || confirmed.value) return
    submitting.value = true
    try {
        await props.onResolve?.(formData.value)
        confirmed.value = true
    } catch (err) {
        const msg = err instanceof Error ? err.message : '提交失败，请重试'
        toast.error(msg)
    } finally {
        submitting.value = false
    }
}

async function onCancel() {
    if (submitting.value || confirmed.value) return
    submitting.value = true
    try {
        await props.onResolve?.(null)
        confirmed.value = true
    } catch (err) {
        const msg = err instanceof Error ? err.message : '取消失败'
        toast.error(msg)
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <div
        ref="cardRef"
        :class="[
            'not-prose my-2 w-full max-w-lg rounded-lg border p-4',
            isSnapshot
                ? 'border-muted bg-muted/20 opacity-70 dark:border-muted dark:bg-muted/10'
                : 'border-primary/40 bg-primary/5 dark:border-primary/30 dark:bg-primary/10',
        ]"
    >
        <!-- 标题 -->
        <div class="mb-3 flex items-center gap-2">
            <Calculator class="size-4 text-primary" />
            <p class="text-sm font-medium text-foreground">{{ displayName }}</p>
        </div>

        <!-- 描述 -->
        <p class="mb-4 text-xs text-muted-foreground">
            <template v-if="isSnapshot && isCancelled">已取消本次计算</template>
            <template v-else-if="isSnapshot">已提交，等待计算结果...</template>
            <template v-else-if="interrupt.missing.length > 0">
                案件信息不全，请补全
                <strong class="text-destructive">{{ interrupt.missing.length }}</strong> 个必填项
            </template>
            <template v-else>请确认参数后开始计算</template>
        </p>

        <!-- 表单（非取消态才展示） -->
        <CalculatorFormFields
            v-if="!isCancelled"
            :tool-name="interrupt.toolName"
            :prefilled="interrupt.prefilled"
            :missing="interrupt.missing"
            v-model="formData"
            v-model:branch="selectedBranch"
        />

        <!-- 操作按钮（active 模式） -->
        <div v-if="!confirmed" class="mt-4 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" :disabled="submitting" @click="onCancel">
                <X class="mr-1 size-3.5" />
                取消
            </Button>
            <Button size="sm" :disabled="!isValid || submitting" @click="onSubmit">
                <Loader2 v-if="submitting" class="mr-1 size-3.5 animate-spin" />
                计算
            </Button>
        </div>

        <!-- snapshot 状态提示 -->
        <div v-else class="mt-4 flex items-center gap-1 text-xs">
            <Ban v-if="isCancelled" class="size-3.5 text-muted-foreground" />
            <CircleCheck v-else class="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span :class="isCancelled ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'">
                {{ isCancelled ? '用户取消了本次计算' : `用户已提交，${Object.keys(resumeValue ?? {}).length} 个字段` }}
            </span>
        </div>
    </div>
</template>

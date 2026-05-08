<script setup lang="ts">
/**
 * 合同审查立场选择 interrupt 卡片（Mockup B）
 *
 * 来自子代理 review_contract 工具：用户在助手对话里直接选立场 + 甲乙方名。
 * - props.interrupt.payload: { partyAHint?, partyBHint?, fileName? }
 * - onResolve({ stance, partyA, partyB } | null) 由父级回填到 LangGraph resume。
 */
import { CheckCircle2, Loader2, Pause, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'

type Stance = 'partyA' | 'partyB' | 'neutral'

/**
 * LangGraph interrupt() 在 createAgent 路径下传入的对象会被 useStreamChat
 * 通过 `__interrupt__[0].value` 暴露出来 — 所有字段平铺，**没有 payload 中间层**
 * （与 server/services/agent-platform/tools/reviewContract.tool.ts 的
 * `interrupt({ type, toolCallId, partyAHint, partyBHint, ... })` 保持一致）。
 */
interface StanceInterrupt {
    type: 'stance_select'
    toolCallId?: string
    partyAHint?: string
    partyBHint?: string
    fileName?: string
}

interface StanceResolveValue {
    stance: Stance
    partyA?: string
    partyB?: string
}

const props = defineProps<{
    interrupt: StanceInterrupt
    onResolve?: (value: StanceResolveValue | null) => Promise<void> | void
    /** snapshot 模式：传入用户之前 resolve 的值；undefined = active 模式 */
    resumeValue?: StanceResolveValue | null
}>()

const isSnapshot = computed(() => props.resumeValue !== undefined)

const STANCE_OPTIONS: Array<{ value: Stance; label: string; desc: string }> = [
    { value: 'partyA', label: '甲方', desc: '保护甲方利益' },
    { value: 'partyB', label: '乙方', desc: '保护乙方利益' },
    { value: 'neutral', label: '中立', desc: '客观分析双方' },
]

const stance = ref<Stance>('partyB')
const partyA = ref<string>(props.interrupt.partyAHint ?? '')
const partyB = ref<string>(props.interrupt.partyBHint ?? '')

const submitting = ref(false)
const confirmed = ref(false)

// snapshot 模式：mount 时即视为 confirmed，立场初始化为 resumeValue
if (isSnapshot.value && props.resumeValue) {
    if (props.resumeValue.stance) stance.value = props.resumeValue.stance
    if (props.resumeValue.partyA !== undefined) partyA.value = props.resumeValue.partyA ?? ''
    if (props.resumeValue.partyB !== undefined) partyB.value = props.resumeValue.partyB ?? ''
    confirmed.value = true
}
if (isSnapshot.value && props.resumeValue === null) {
    confirmed.value = true
}

const fileName = computed(() => props.interrupt.fileName?.trim() || '')

const stanceLabel = computed(
    () => STANCE_OPTIONS.find(o => o.value === stance.value)?.label ?? '',
)

async function handleSubmit() {
    if (submitting.value || confirmed.value) return
    submitting.value = true
    try {
        await props.onResolve?.({
            stance: stance.value,
            partyA: partyA.value.trim(),
            partyB: partyB.value.trim(),
        })
        confirmed.value = true
    } catch (err) {
        const msg = err instanceof Error ? err.message : '提交失败，请重试'
        toast.error(msg)
    } finally {
        submitting.value = false
    }
}

async function handleCancel() {
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

// active 模式首次 mount 滚到视口（snapshot 不滚——用户已在历史里）
const cardRef = ref<HTMLElement | null>(null)
onMounted(() => {
    if (isSnapshot.value) return
    nextTick(() => {
        cardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
})
</script>

<template>
    <div
        ref="cardRef"
        :class="[
            'not-prose my-2 w-full max-w-md rounded-lg border p-4 shadow-sm',
            isSnapshot
                ? 'border-muted bg-muted/20 opacity-70 dark:border-muted dark:bg-muted/10'
                : 'border-amber-300/60 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/30',
        ]"
    >
        <!-- 标题 -->
        <div class="mb-3 flex items-center gap-2">
            <Pause class="size-4 text-amber-600 dark:text-amber-400" />
            <p class="text-sm font-medium text-foreground">请确认审查立场</p>
        </div>

        <!-- 描述 -->
        <p class="mb-3 text-xs text-muted-foreground">
            <template v-if="fileName">
                以哪一方的视角审查 <span class="font-medium text-foreground">{{ fileName }}</span>？
            </template>
            <template v-else>
                以哪一方的视角审查这份合同？
            </template>
        </p>

        <!-- 立场单选 -->
        <RadioGroup v-model="stance" :disabled="submitting || confirmed" class="mb-4 space-y-2">
            <label
                v-for="opt in STANCE_OPTIONS"
                :key="opt.value"
                :class="[
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                    stance === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:border-primary/40',
                    (submitting || confirmed) && 'cursor-not-allowed opacity-60',
                ]"
            >
                <RadioGroupItem :value="opt.value" class="mt-0.5" />
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-foreground">{{ opt.label }}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">{{ opt.desc }}</p>
                </div>
            </label>
        </RadioGroup>

        <!-- 甲乙方名称 -->
        <div class="mb-4 grid grid-cols-1 gap-3">
            <div class="space-y-1">
                <Label class="text-xs text-muted-foreground">甲方名称（可选）</Label>
                <Input
                    v-model="partyA"
                    placeholder="例如：阿里云"
                    :disabled="submitting || confirmed"
                    class="h-8 text-sm"
                />
            </div>
            <div class="space-y-1">
                <Label class="text-xs text-muted-foreground">乙方名称（可选）</Label>
                <Input
                    v-model="partyB"
                    placeholder="例如：我方"
                    :disabled="submitting || confirmed"
                    class="h-8 text-sm"
                />
            </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center justify-end gap-2">
            <Button
                v-if="!confirmed"
                size="sm"
                variant="ghost"
                :disabled="submitting"
                @click="handleCancel"
            >
                <X class="mr-1 size-3.5" />
                取消
            </Button>
            <Button
                v-if="!confirmed"
                size="sm"
                :disabled="submitting"
                @click="handleSubmit"
            >
                <Loader2 v-if="submitting" class="mr-1 size-3.5 animate-spin" />
                开始审查
            </Button>
            <p v-else class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 class="size-3.5" />
                {{ isSnapshot && resumeValue === null ? '已取消' : (isSnapshot ? `已选立场：${stanceLabel}` : '已确认，开始审查') }}
            </p>
        </div>
    </div>
</template>

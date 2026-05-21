<template>
    <div class="space-y-4">
        <!-- 主分支：Tab 形式（≤4 选项） -->
        <Tabs v-if="meta.branchField && meta.branchUiType === 'tab'"
              :model-value="branchValue" @update:model-value="onBranchChange">
            <TabsList class="w-full">
                <TabsTrigger v-for="opt in meta.branchOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                </TabsTrigger>
            </TabsList>
        </Tabs>

        <!-- 主分支：Select 形式（≥5 选项） -->
        <div v-else-if="meta.branchField && meta.branchUiType === 'select'" class="space-y-1.5">
            <Label>{{ branchFieldLabel }}</Label>
            <Select :model-value="branchValue" @update:model-value="onBranchChange">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem v-for="opt in meta.branchOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>

        <!-- 嵌套子分支（Radio 形式） -->
        <div v-if="nestedBranchMeta" class="space-y-1.5">
            <Label>{{ nestedBranchMeta.label }}</Label>
            <RadioGroup :model-value="nestedBranchValue" @update:model-value="onNestedBranchChange">
                <div v-for="opt in nestedBranchMeta.options" :key="opt.value" class="flex items-center gap-2">
                    <RadioGroupItem :value="opt.value" :id="`nb-${opt.value}`" />
                    <Label :for="`nb-${opt.value}`" class="cursor-pointer">{{ opt.label }}</Label>
                </div>
            </RadioGroup>
        </div>

        <!-- 字段网格 -->
        <div class="grid grid-cols-2 gap-3">
            <div v-for="field in visibleFields" :key="field.name" class="space-y-1.5"
                 :class="{ 'col-span-2': isLongLabel(field) }">
                <Label class="flex flex-wrap items-center gap-1.5">
                    <span class="inline-flex items-baseline">
                        <span v-if="isRequired(field)" class="text-destructive mr-0.5">*</span>
                        <span>{{ field.label }}</span>
                        <span v-if="field.unit" class="text-muted-foreground">（{{ field.unit }}）</span>
                    </span>
                    <Badge v-if="isPrefilled(field) && !isMissing(field)" variant="secondary" class="text-xs">
                        已自动填入
                    </Badge>
                    <Badge v-if="isMissing(field)" variant="destructive" class="text-xs">需补全</Badge>
                </Label>

                <!-- 数字输入 -->
                <Input v-if="field.type === 'number'"
                       type="number"
                       :model-value="formData[field.name]"
                       :placeholder="field.placeholder || '0'"
                       :class="fieldClass(field)"
                       @update:model-value="(v: any) => onFieldInput(field.name, v === '' ? undefined : Number(v))" />

                <!-- 下拉选择 -->
                <Select v-else-if="field.type === 'select'"
                        :model-value="String(formData[field.name] ?? '')"
                        @update:model-value="(v: any) => onSelectInput(field.name, v)">
                    <SelectTrigger class="w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="opt in field.options" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>

                <!-- 日期选择（统一用 shadcn-vue 封装的 DatePicker） -->
                <DatePicker v-else-if="field.type === 'date'"
                            :model-value="formData[field.name] ?? null"
                            :class="fieldClass(field)"
                            @update:model-value="(v: string | null) => onFieldInput(field.name, v ?? undefined)" />

                <!-- 布尔（开关）-->
                <div v-else-if="field.type === 'boolean'" class="flex items-center h-9">
                    <Switch :model-value="formData[field.name] === true"
                            @update:model-value="(v: any) => onFieldInput(field.name, v)" />
                    <span class="ml-2 text-sm text-muted-foreground">
                        {{ formData[field.name] === true ? '是' : '否' }}
                    </span>
                </div>

                <!-- 文本输入（兜底） -->
                <Input v-else :model-value="formData[field.name]" :placeholder="field.placeholder"
                       @update:model-value="(v: any) => onFieldInput(field.name, v)" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { Switch } from '~/components/ui/switch'
import DatePicker from '~/components/general/DatePicker.vue'
import { CALCULATOR_TOOL_META, type CalcFieldMeta } from '#shared/utils/tools/agentTools/_fieldMetadata'

const props = defineProps<{
    toolName: string
    prefilled: Record<string, any>
    missing: string[]
    modelValue: Record<string, any>
    branch?: string
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', val: Record<string, any>): void
    (e: 'update:branch', val: string): void
}>()

const meta = computed(() => CALCULATOR_TOOL_META[props.toolName]!)
const formData = computed(() => props.modelValue)

const branchValue = computed(() =>
    props.branch
    ?? (props.prefilled[meta.value.branchField ?? ''] as string)
    ?? meta.value.branchOptions?.[0]?.value
    ?? '',
)

const branchFieldLabel = computed(() => {
    const m: Record<string, string> = {
        type: '赔偿类型',
        caseType: '服务类型',
        mode: '计算方式',
        feeTypeLevel1: '费用类型',
        queryType: '查询类型',
    }
    return m[meta.value.branchField!] ?? meta.value.branchField!
})

const nestedBranchMeta = computed(() => meta.value.nestedBranchByValue?.[branchValue.value])
const nestedBranchValue = computed(() =>
    nestedBranchMeta.value
        ? (formData.value[nestedBranchMeta.value.field] ?? nestedBranchMeta.value.options[0]?.value ?? '')
        : '',
)

const visibleFields = computed<CalcFieldMeta[]>(() => {
    const names = meta.value.fieldsByBranch?.[branchValue.value] ?? meta.value.fields.map((f) => f.name)
    return names
        .map((n) => meta.value.fields.find((f) => f.name === n))
        .filter((f): f is CalcFieldMeta => !!f)
        // 字段级条件可见：showWhen 指定的依赖字段当前值不在 in 列表时隐藏
        .filter((f) => {
            if (!f.showWhen) return true
            return f.showWhen.in.includes(String(formData.value[f.showWhen.field]))
        })
})

function isRequired(f: CalcFieldMeta): boolean {
    // showWhen 隐藏的字段不计必填（避免用户填不到的字段卡住提交）
    if (f.showWhen && !f.showWhen.in.includes(String(formData.value[f.showWhen.field]))) return false
    return !!(f.required || f.requiredBy?.[branchValue.value])
}

function isMissing(f: CalcFieldMeta): boolean {
    return props.missing.includes(f.name) && (formData.value[f.name] === undefined || formData.value[f.name] === '')
}

function isPrefilled(f: CalcFieldMeta): boolean {
    return props.prefilled[f.name] !== undefined
}

/** label + unit 总长超 8 字（中文宽字符）时该字段占整行，避免在 grid-cols-2 半列宽下被 badge 挤压折行 */
function isLongLabel(f: CalcFieldMeta): boolean {
    const len = f.label.length + (f.unit ? f.unit.length + 2 : 0)
    return len > 8
}

function fieldClass(f: CalcFieldMeta): string {
    if (isMissing(f)) return 'border-destructive'
    if (isPrefilled(f)) return 'bg-primary/5'
    return ''
}

function onFieldInput(name: string, value: any) {
    emit('update:modelValue', { ...formData.value, [name]: value })
}

/** select 字段：纯数字字符串自动转 number（如伤残等级 '5' → 5），避免 service 收到字符串拿不到数据 */
function onSelectInput(name: string, value: any) {
    const coerced = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value
    emit('update:modelValue', { ...formData.value, [name]: coerced })
}

function onBranchChange(v: any) {
    if (meta.value.branchField) {
        emit('update:branch', v as string)
        emit('update:modelValue', { ...formData.value, [meta.value.branchField]: v })
    }
}

function onNestedBranchChange(v: any) {
    if (nestedBranchMeta.value) {
        emit('update:modelValue', { ...formData.value, [nestedBranchMeta.value.field]: v })
    }
}
</script>

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
                <SelectTrigger><SelectValue /></SelectTrigger>
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
            <div v-for="field in visibleFields" :key="field.name" class="space-y-1.5">
                <Label>
                    <span v-if="isRequired(field)" class="text-destructive mr-1">*</span>
                    {{ field.label }}
                    <Badge v-if="isPrefilled(field) && !isMissing(field)" variant="secondary" class="ml-2 text-xs">
                        已自动填入
                    </Badge>
                    <Badge v-if="isMissing(field)" variant="destructive" class="ml-2 text-xs">需补全</Badge>
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
                        @update:model-value="(v: any) => onFieldInput(field.name, v)">
                    <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="opt in field.options" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>

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
        caseType: '案件类型',
        mode: '计算模式',
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
})

function isRequired(f: CalcFieldMeta): boolean {
    return !!(f.required || f.requiredBy?.[branchValue.value])
}

function isMissing(f: CalcFieldMeta): boolean {
    return props.missing.includes(f.name) && (formData.value[f.name] === undefined || formData.value[f.name] === '')
}

function isPrefilled(f: CalcFieldMeta): boolean {
    return props.prefilled[f.name] !== undefined
}

function fieldClass(f: CalcFieldMeta): string {
    if (isMissing(f)) return 'border-destructive'
    if (isPrefilled(f)) return 'bg-primary/5'
    return ''
}

function onFieldInput(name: string, value: any) {
    emit('update:modelValue', { ...formData.value, [name]: value })
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

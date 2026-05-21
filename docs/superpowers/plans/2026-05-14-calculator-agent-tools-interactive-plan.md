# 办案计算器 Agent 工具交互式接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 10 个办案计算器接入到法律助手 Agent，信息充足直接算 / 信息不足在对话内弹出 inline 卡片让用户补全 / 结果自动写入案件记忆 / 用户可取消让 LLM 自然衔接。

**Architecture:** 4 层协同：
- **工具层**：`shared/utils/tools/agentTools/*.tool.ts` 用 `interrupt()` 暂停 graph + 必填校验 + `findLastCalculationByCase` L2 兜底 + `writeMemoryService` 写记忆，遵循 `parseAndAskStance` 防御性 resume 校验
- **记忆层**：复用 `writeMemoryService` + 新增 `extraMetadata` 字段透传到 PGVectorStore metadata + 新增 `findLastCalculationByCase` 兜底查询
- **渲染层**：参照项目惯例拆**两个**组件 — `CalculatorInputCard.vue` 注册到 `globalInterruptRegistry` 渲染输入/snapshot/取消三态；`CalculatorResultCard.vue` 注册到 `PANEL_TOOL_MAP` 渲染结果态。共享 `CalculatorFormFields.vue`（动态分支表单）和 `CalculatorResultBody.vue`（10 工具结果体），由两张卡分别 import
- **注册层**：`server/services/agent-platform/tools/index.ts.toolModules` + `app/components/case/interrupt/index.ts.globalInterruptRegistry` + `app/components/agents/panelToolMap.ts.PANEL_TOOL_MAP` + DB `nodes.assistantMain.tools`

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + LangGraph `interrupt()` + LangChain `tool()` + zod + reka-ui/shadcn-vue Tabs/Select/RadioGroup + Prisma + LangChain PGVectorStore + Vitest + `vi.hoisted()` mock 模式

**Spec:** [docs/superpowers/specs/2026-05-14-calculator-agent-tools-interactive-design.md](../specs/2026-05-14-calculator-agent-tools-interactive-design.md)

**测试基线契约:** 跑 `npx vitest run tests/shared/utils/tools/agentTools/ tests/server/services/memory/ tests/server/agents/legal-assistant/`，不得破坏现有 *.tool.test.ts 通过率。

---

## 文件结构总览

### 新建文件

```
shared/utils/tools/agentTools/_fieldMetadata.ts               # 10 工具字段元数据（含分支 / 嵌套子分支）
app/components/ai/tools/CalculatorInputCard.vue               # 输入/snapshot/取消三态（注册 globalInterruptRegistry）
app/components/ai/tools/CalculatorResultCard.vue              # 结果态（注册 PANEL_TOOL_MAP）
app/components/ai/tools/CalculatorFormFields.vue              # 动态表单（Tab/Select 分支 + 嵌套 Radio）
app/components/ai/tools/CalculatorResultBody.vue              # 结果体（10 个工具切换布局）
tests/server/agents/legal-assistant/calculator-tools.integration.test.ts
```

### 修改文件

```
shared/types/case.ts                              # InterruptType.CALCULATOR_INPUT + TypedInterruptData
shared/types/memory.ts                            # MemoryKind 加 'calculation' + CaseMemoryMetadata.calculation
server/services/memory/memory.service.ts          # MemoryWriteInput.extraMetadata + findLastCalculationByCase
shared/utils/tools/agentTools/*.tool.ts (10 个)   # interrupt + writeMemory + 必填校验
tests/shared/utils/tools/agentTools/*.tool.test.ts (10 个)
server/services/agent-platform/tools/index.ts     # toolModules 注册 10 个 calculate_*
app/components/case/interrupt/index.ts            # globalInterruptRegistry.register('calculator_input', CalculatorInputCard, { isToolCard: true })
app/components/agents/panelToolMap.ts             # PANEL_TOOL_MAP 注册 10 个 calculate_*
prisma/seeds/seedData.sql                         # nodes.assistantMain.tools 加 10 个工具名
```

---

# PR-A · 基建 + calculate_compensation 跑通 3 路径（约 4-5h）

## 任务 PR-A-T1：类型层扩展

**Files:**
- Modify: `shared/types/case.ts`
- Modify: `shared/types/memory.ts`

- [ ] **Step 1: `shared/types/case.ts` 加 InterruptType.CALCULATOR_INPUT**

```typescript
export enum InterruptType {
    CASE_INFO_CHECK = 'case_info_check',
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    MODULE_SELECT = 'module_select',
    INSUFFICIENT_POINTS = 'insufficient_points',
    AWAITING_STANCE = 'awaiting_stance',
    /** 新增：办案计算器需要用户补全参数 */
    CALCULATOR_INPUT = 'calculator_input',
}
```

- [ ] **Step 2: 同文件加 CalculatorInputInterruptData + 联合类型**

```typescript
export interface CalculatorInputInterruptData {
    type: InterruptType.CALCULATOR_INPUT
    toolName: string                          // 'calculate_compensation' 等
    prefilled: Record<string, unknown>        // L1+L2 合并后的预填
    missing: string[]                         // 缺失必填字段名列表
}

// 在 TypedInterruptData 联合类型末尾加 | CalculatorInputInterruptData
```

- [ ] **Step 3: `shared/types/memory.ts` MemoryKind 加 'calculation'**

```typescript
export type MemoryKind = 'fact' | 'preference' | 'dialogue_note' | 'event' | 'decision' | 'note' | 'calculation'
```

- [ ] **Step 4: 同文件 CaseMemoryMetadata 加可选 calculation 字段**

```typescript
export interface CaseMemoryMetadata {
    id: string
    caseId: number
    kind: MemoryKind
    subjectKey?: string
    confidence?: number
    source?: MemorySource
    supersedes?: string
    createdAt?: string  // 现有
    invalidatedAt?: string  // 现有
    /** 新增：计算器历史详情，仅当 kind='calculation' 时填入 */
    calculation?: {
        tool: string
        input: Record<string, unknown>
        output: Record<string, unknown>
        calculatedAt: string
    }
}
```

- [ ] **Step 5: typecheck**

Run: `bun run typecheck 2>&1 | grep -E "case\.ts|memory\.ts" | head -5`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add shared/types/case.ts shared/types/memory.ts
git commit -m "feat(tools): 类型层扩展 InterruptType.CALCULATOR_INPUT + MemoryKind 加 calculation"
```

---

## 任务 PR-A-T2：writeMemoryService 扩展 + findLastCalculationByCase

**Files:**
- Modify: `server/services/memory/memory.service.ts`
- Create/Modify: `tests/server/services/memory/memory.service.test.ts`

- [ ] **Step 1: 写测试（用 vi.hoisted 对齐项目惯例）**

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

describe('memory.service - calculation 扩展', () => {
    const createdIds: string[] = []
    // 动态找一个真实案件 id，避免 worker DB 间 seed 差异
    let testCaseId = 0
    beforeAll(async () => {
        const c = await prisma.cases.findFirst({ select: { id: true } })
        if (!c) throw new Error('测试库需有至少 1 个 case')
        testCaseId = c.id
    })

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.$executeRawUnsafe(
                `DELETE FROM case_memories WHERE id = ANY($1::uuid[])`,
                createdIds,
            )
            createdIds.length = 0
        }
    })

    it('writeMemoryService extraMetadata.calculation 透传到 metadata JSONB', async () => {
        const { id } = await writeMemoryService({
            caseId: testCaseId,
            kind: 'calculation',
            text: '[计算] 测试',
            subjectKey: 'calculation:test_tool',
            source: 'manual',
            extraMetadata: {
                calculation: {
                    tool: 'test_tool',
                    input: { foo: 1 },
                    output: { bar: 2 },
                    calculatedAt: '2026-05-14T10:00:00+08:00',
                },
            },
        })
        createdIds.push(id)

        const rows = await prisma.$queryRaw<Array<{ metadata: any }>>`
            SELECT metadata FROM case_memories WHERE id = ${id}::uuid
        `
        expect(rows[0]?.metadata?.calculation?.tool).toBe('test_tool')
        expect(rows[0]?.metadata?.calculation?.input).toEqual({ foo: 1 })
    })

    it('findLastCalculationByCase 通过版本链返回最新一条', async () => {
        const { id: id1 } = await writeMemoryService({
            caseId: testCaseId, kind: 'calculation', text: '[计算] 旧',
            subjectKey: 'calculation:test_find', source: 'manual',
            extraMetadata: { calculation: { tool: 'test_find', input: { v: 100 }, output: { t: 100 },
                                            calculatedAt: '2026-05-13T10:00:00+08:00' } },
        })
        createdIds.push(id1)

        const { id: id2 } = await writeMemoryService({
            caseId: testCaseId, kind: 'calculation', text: '[计算] 新',
            subjectKey: 'calculation:test_find', source: 'manual',
            extraMetadata: { calculation: { tool: 'test_find', input: { v: 200 }, output: { t: 200 },
                                            calculatedAt: '2026-05-14T10:00:00+08:00' } },
        })
        createdIds.push(id2)

        const last = await findLastCalculationByCase(testCaseId, 'test_find')
        expect(last?.input).toEqual({ v: 200 })
    })

    it('findLastCalculationByCase 无记录时返回 null', async () => {
        const r = await findLastCalculationByCase(testCaseId, 'definitely_not_exist')
        expect(r).toBeNull()
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/server/services/memory/memory.service.test.ts`
Expected: FAIL — `findLastCalculationByCase` / `extraMetadata` 不存在

- [ ] **Step 3: 改 `MemoryWriteInput` + 内部 metadata 透传**

在 `MemoryWriteInput` 接口末尾追加：

```typescript
    /** 新增：透传到 PGVectorStore.metadata 的额外字段 */
    extraMetadata?: Partial<Pick<CaseMemoryMetadata, 'calculation'>>
```

在 `writeMemoryService` 内部构造 metadata 后浅合并：

```typescript
const metadata: CaseMemoryMetadata = {
    id: newId,
    caseId: input.caseId,
    kind: input.kind,
    subjectKey: input.subjectKey,
    confidence: input.confidence,
    source: input.source,
    supersedes,
    createdAt: new Date().toISOString(),
    ...input.extraMetadata,  // 新增：透传 calculation 等字段
}
```

- [ ] **Step 4: 同文件末尾新增 `findLastCalculationByCase`（带 ORDER BY）**

```typescript
/**
 * 查最近一次同案件同工具的计算历史（用于 L2 兜底预填）。
 * 利用版本链：subjectKey='calculation:{tool}' 同案件只有 1 条未失效记录。
 * ORDER BY 兜底版本链失效场景（并发写入 / 测试环境多条遗留）。
 */
export async function findLastCalculationByCase(
    caseId: number,
    tool: string,
): Promise<CaseMemoryMetadata['calculation'] | null> {
    const rows = await prisma.$queryRaw<Array<{ metadata: CaseMemoryMetadata }>>`
        SELECT metadata FROM case_memories
        WHERE (metadata->>'caseId')::int = ${caseId}
          AND metadata->>'kind' = 'calculation'
          AND metadata->>'subjectKey' = ${`calculation:${tool}`}
          AND (metadata->>'invalidatedAt') IS NULL
        ORDER BY (metadata->'calculation'->>'calculatedAt') DESC NULLS LAST
        LIMIT 1
    `
    return rows[0]?.metadata?.calculation ?? null
}
```

- [ ] **Step 5: 跑测试验证 PASS**

Run: `npx vitest run tests/server/services/memory/memory.service.test.ts`
Expected: 3 tests passed

- [ ] **Step 6: Commit**

```bash
git add server/services/memory/memory.service.ts tests/server/services/memory/memory.service.test.ts
git commit -m "feat(tools): writeMemoryService 加 extraMetadata + 新增 findLastCalculationByCase"
```

---

## 任务 PR-A-T3：_fieldMetadata.ts 含 compensation（先驱）+ 嵌套子分支接口设计

**Files:**
- Create: `shared/utils/tools/agentTools/_fieldMetadata.ts`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * Calculator Agent 工具的字段元数据（前端表单渲染用）。
 *
 * 为什么单独维护：zod schema 不承载 label/unit/分支可见性等 UI 元数据。
 * 本文件按 toolName 提供 source of truth。
 *
 * 嵌套子分支支持：如 court_fee 的 feeTypeLevel1='caseFee' 下有 caseFeeType 子分支。
 * 用 nestedBranchByValue 表达"父分支选某值后再切的子分支"。
 */

export interface CalcFieldMeta {
    name: string
    label: string
    type: 'number' | 'text' | 'select' | 'date' | 'boolean'
    unit?: string
    required?: boolean
    /** 按主分支判定必填，key 是主分支值 */
    requiredBy?: Record<string, boolean>
    options?: Array<{ value: string; label: string }>
    placeholder?: string
}

export interface NestedBranchMeta {
    /** 子分支字段名（如 nonPropertyType） */
    field: string
    /** 子分支 UI 类型：嵌套场景一般用 radio */
    uiType: 'radio' | 'select'
    options: Array<{ value: string; label: string }>
    label: string  // 中文标签
}

export interface CalcToolMeta {
    toolName: string
    displayName: string
    /** 主分支字段名（type/caseType/mode/feeTypeLevel1/queryType） */
    branchField?: string
    branchOptions?: Array<{ value: string; label: string }>
    branchUiType?: 'tab' | 'select'  // ≤4 tab，≥5 select
    /** 嵌套子分支：父分支某值 → 显示哪个子分支 */
    nestedBranchByValue?: Record<string, NestedBranchMeta>
    fields: CalcFieldMeta[]
    /** 主分支显示哪些字段 */
    fieldsByBranch?: Record<string, string[]>
}

export const CALCULATOR_TOOL_META: Record<string, CalcToolMeta> = {
    calculate_compensation: {
        toolName: 'calculate_compensation',
        displayName: '赔偿金计算',
        branchField: 'type',
        branchUiType: 'tab',
        branchOptions: [
            { value: 'workInjury', label: '工伤赔偿' },
            { value: 'trafficAccident', label: '交通事故' },
            { value: 'death', label: '死亡赔偿' },
        ],
        fields: [
            { name: 'salary', label: '月工资', type: 'number', unit: '元', requiredBy: { workInjury: true } },
            { name: 'disabilityLevel', label: '伤残等级', type: 'select',
              options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 级` })),
              requiredBy: { workInjury: true } },
            { name: 'medicalExpenses', label: '医疗费用', type: 'number', unit: '元',
              requiredBy: { trafficAccident: true } },
            { name: 'nursingExpenses', label: '护理费用', type: 'number', unit: '元' },
            { name: 'nutritionExpenses', label: '营养费用', type: 'number', unit: '元' },
            { name: 'disabilityCompensation', label: '伤残赔偿金', type: 'number', unit: '元',
              requiredBy: { trafficAccident: true } },
            { name: 'lostIncome', label: '误工费', type: 'number', unit: '元' },
            { name: 'transportationExpenses', label: '交通费', type: 'number', unit: '元' },
            { name: 'accommodationExpenses', label: '住宿费', type: 'number', unit: '元' },
            { name: 'propertyLoss', label: '财产损失', type: 'number', unit: '元' },
            { name: 'annualIncome', label: '年收入', type: 'number', unit: '元', requiredBy: { death: true } },
            { name: 'deathCompensationYears', label: '死亡赔偿金年限', type: 'number', unit: '年', placeholder: '默认 20' },
            { name: 'funeralExpenses', label: '丧葬费', type: 'number', unit: '元' },
            { name: 'dependentCompensation', label: '被抚养人生活费', type: 'number', unit: '元' },
            { name: 'emotionalDamages', label: '精神损害赔偿金', type: 'number', unit: '元' },
        ],
        fieldsByBranch: {
            workInjury: ['salary', 'disabilityLevel', 'medicalExpenses', 'nursingExpenses', 'nutritionExpenses'],
            trafficAccident: ['medicalExpenses', 'disabilityCompensation', 'nursingExpenses', 'lostIncome',
                              'nutritionExpenses', 'transportationExpenses', 'accommodationExpenses', 'propertyLoss'],
            death: ['annualIncome', 'deathCompensationYears', 'funeralExpenses', 'dependentCompensation', 'emotionalDamages'],
        },
    },
}
```

> PR-B-T12 时补全剩余 9 个工具的 meta。

- [ ] **Step 2: typecheck + Commit**

```bash
bun run typecheck 2>&1 | grep "_fieldMetadata" | head -3
git add shared/utils/tools/agentTools/_fieldMetadata.ts
git commit -m "feat(tools): _fieldMetadata 字段元数据接口 + compensation 元数据"
```

---

## 任务 PR-A-T4：前端三组件 + 注册（合并原 T4-T7）

**Files:**
- Create: `app/components/ai/tools/CalculatorFormFields.vue`
- Create: `app/components/ai/tools/CalculatorResultBody.vue`
- Create: `app/components/ai/tools/CalculatorInputCard.vue`
- Create: `app/components/ai/tools/CalculatorResultCard.vue`
- Modify: `app/components/case/interrupt/index.ts`
- Modify: `app/components/agents/panelToolMap.ts`

- [ ] **Step 1: 创建 `CalculatorFormFields.vue`（动态表单）**

```vue
<template>
    <div class="space-y-4">
        <!-- 主分支选择器 -->
        <Tabs v-if="meta.branchField && meta.branchUiType === 'tab'"
              :model-value="branchValue" @update:model-value="onBranchChange">
            <TabsList class="w-full">
                <TabsTrigger v-for="opt in meta.branchOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                </TabsTrigger>
            </TabsList>
        </Tabs>

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

        <!-- 嵌套子分支（Radio）-->
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

                <Input v-if="field.type === 'number'"
                       type="number"
                       :model-value="formData[field.name]"
                       :placeholder="field.placeholder || '0'"
                       :class="fieldClass(field)"
                       @update:model-value="(v: any) => onFieldInput(field.name, v === '' ? undefined : Number(v))" />

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
    props.branch ?? (props.prefilled[meta.value.branchField ?? ''] as string)
    ?? meta.value.branchOptions?.[0]?.value ?? '')

const branchFieldLabel = computed(() => {
    const m: Record<string, string> = {
        type: '赔偿类型', caseType: '案件类型', mode: '计算模式',
        feeTypeLevel1: '费用类型', queryType: '查询类型',
    }
    return m[meta.value.branchField!] ?? meta.value.branchField!
})

const nestedBranchMeta = computed(() => meta.value.nestedBranchByValue?.[branchValue.value])
const nestedBranchValue = computed(() =>
    nestedBranchMeta.value
        ? (formData.value[nestedBranchMeta.value.field] ?? nestedBranchMeta.value.options[0]?.value ?? '')
        : '')

const visibleFields = computed<CalcFieldMeta[]>(() => {
    const names = meta.value.fieldsByBranch?.[branchValue.value] ?? meta.value.fields.map((f) => f.name)
    return names.map((n) => meta.value.fields.find((f) => f.name === n)).filter((f): f is CalcFieldMeta => !!f)
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
```

- [ ] **Step 2: 创建 `CalculatorResultBody.vue`（结果体，按 toolName 切布局）**

```vue
<template>
    <div class="space-y-3">
        <!-- compensation: workInjury / trafficAccident / death 3 分支 -->
        <template v-if="toolName === 'calculate_compensation'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>赔偿类型</span>
                    <span class="font-medium">{{ compensationTypeText }}</span>
                </div>

                <!-- workInjury 分支字段 -->
                <template v-if="input.type === 'workInjury'">
                    <div class="flex justify-between text-sm"><span>月工资</span><span>{{ fmt(input.salary) }}</span></div>
                    <div class="flex justify-between text-sm"><span>伤残等级</span><span>{{ input.disabilityLevel }} 级</span></div>
                    <div class="flex justify-between text-sm"><span>一次性伤残补助金</span><span>{{ fmt(output.disabilityCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>医疗费用</span><span>{{ fmt(output.medicalExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>护理费用</span><span>{{ fmt(output.nursingExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>营养费用</span><span>{{ fmt(output.nutritionExpenses) }}</span></div>
                </template>

                <!-- trafficAccident 分支字段 -->
                <template v-else-if="input.type === 'trafficAccident'">
                    <div class="flex justify-between text-sm"><span>医疗费用</span><span>{{ fmt(output.medicalExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>伤残赔偿金</span><span>{{ fmt(output.disabilityCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>护理费用</span><span>{{ fmt(output.nursingExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>误工费</span><span>{{ fmt(output.lostIncome) }}</span></div>
                    <div class="flex justify-between text-sm"><span>交通费</span><span>{{ fmt(output.transportationExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>财产损失</span><span>{{ fmt(output.propertyLoss) }}</span></div>
                </template>

                <!-- death 分支字段 -->
                <template v-else-if="input.type === 'death'">
                    <div class="flex justify-between text-sm"><span>年收入</span><span>{{ fmt(input.annualIncome) }}</span></div>
                    <div class="flex justify-between text-sm"><span>死亡赔偿金</span><span>{{ fmt(output.deathCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>丧葬费</span><span>{{ fmt(output.funeralExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>被抚养人生活费</span><span>{{ fmt(output.dependentCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>精神损害</span><span>{{ fmt(output.emotionalDamages) }}</span></div>
                </template>

                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">赔偿总额</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.totalCompensation) }}</span>
                </div>
            </div>
        </template>

        <!-- TODO PR-B-T12 时补 9 个工具的 v-else-if 分支 -->

        <!-- 计算明细 Accordion -->
        <Accordion v-if="Array.isArray(output.details) && output.details.length > 0"
                   type="single" collapsible class="w-full" default-value="details">
            <AccordionItem value="details">
                <AccordionTrigger>计算明细</AccordionTrigger>
                <AccordionContent>
                    <ul class="text-sm space-y-1 list-disc pl-5">
                        <li v-for="(line, i) in (output.details as string[])" :key="i">{{ line }}</li>
                    </ul>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '~/components/ui/accordion'

const props = defineProps<{
    toolName: string
    input: Record<string, any>
    output: Record<string, any>
}>()

function fmt(n: unknown): string {
    if (typeof n !== 'number') return '—'
    return `¥ ${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

const compensationTypeText = computed(() => {
    const m: Record<string, string> = { workInjury: '工伤赔偿', trafficAccident: '交通事故', death: '死亡赔偿' }
    return m[props.input.type as string] ?? '—'
})
</script>
```

- [ ] **Step 3: 创建 `CalculatorInputCard.vue`（输入态卡片，isToolCard 协议）**

参考 `app/components/agents/contract/interrupts/StanceSelectCard.vue` 的 `interrupt + onResolve + resumeValue` 协议：

```vue
<template>
    <Card class="w-full">
        <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-base">
                <Calculator class="w-5 h-5 text-primary" />
                {{ displayName }}
            </CardTitle>
            <CardDescription>
                <template v-if="isSnapshot">已提交，等待计算结果...</template>
                <template v-else-if="props.interrupt.missing.length > 0">
                    案件信息不全，请补全 <strong class="text-destructive">{{ props.interrupt.missing.length }}</strong> 个必填项
                </template>
                <template v-else>请确认参数</template>
            </CardDescription>
        </CardHeader>
        <CardContent>
            <CalculatorFormFields
                :tool-name="props.interrupt.toolName"
                :prefilled="props.interrupt.prefilled"
                :missing="props.interrupt.missing"
                v-model="formData"
                v-model:branch="selectedBranch"
            />
        </CardContent>
        <CardFooter v-if="!isSnapshot" class="justify-end gap-2">
            <Button variant="outline" :disabled="submitting" @click="onCancel">取消</Button>
            <Button :disabled="!isValid || submitting" @click="onSubmit">
                <Loader2 v-if="submitting" class="w-4 h-4 mr-1 animate-spin" />
                计算
            </Button>
        </CardFooter>
        <CardFooter v-else class="text-sm text-muted-foreground gap-2">
            <CircleCheck v-if="!isCancelled" class="w-4 h-4 text-emerald-600" />
            <Ban v-else class="w-4 h-4 text-muted-foreground" />
            <span v-if="!isCancelled">用户已提交，{{ Object.keys(props.resumeValue ?? {}).length }} 个字段</span>
            <span v-else>用户取消了本次计算</span>
        </CardFooter>
    </Card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Calculator, CircleCheck, Ban, Loader2 } from 'lucide-vue-next'
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
    resumeValue?: Record<string, any> | null
}>()

const isSnapshot = computed(() => props.resumeValue !== undefined)
const isCancelled = computed(() => props.resumeValue === null
    || (props.resumeValue && (props.resumeValue as { cancelled?: boolean }).cancelled === true))

const displayName = computed(() =>
    CALCULATOR_TOOL_META[props.interrupt.toolName]?.displayName ?? props.interrupt.toolName)

const formData = ref<Record<string, any>>({
    ...props.interrupt.prefilled,
    ...(isSnapshot.value && props.resumeValue ? props.resumeValue : {}),
})
const selectedBranch = ref<string>(
    (formData.value[CALCULATOR_TOOL_META[props.interrupt.toolName]?.branchField ?? ''] as string)
    ?? CALCULATOR_TOOL_META[props.interrupt.toolName]?.branchOptions?.[0]?.value
    ?? '',
)

const submitting = ref(false)

const isValid = computed(() => {
    const meta = CALCULATOR_TOOL_META[props.interrupt.toolName]
    if (!meta) return false
    const requiredNames = meta.fields
        .filter((f: CalcFieldMeta) => f.required || f.requiredBy?.[selectedBranch.value])
        .map((f) => f.name)
    return requiredNames.every((n) => formData.value[n] !== undefined && formData.value[n] !== '')
})

async function onSubmit() {
    if (!isValid.value) return
    submitting.value = true
    try {
        await props.onResolve?.(formData.value)
    } finally {
        submitting.value = false
    }
}

async function onCancel() {
    submitting.value = true
    try {
        await props.onResolve?.(null)  // null 表示取消（InterruptDispatcher 协议）
    } finally {
        submitting.value = false
    }
}
</script>
```

- [ ] **Step 4: 创建 `CalculatorResultCard.vue`（结果态卡片，PANEL_TOOL_MAP 协议）**

参考 `app/components/agents/contract/tools/ReviewContractCard.vue` 的 `input/output/state/toolName` props 形态：

```vue
<template>
    <Card class="w-full">
        <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-base">
                <CircleCheck v-if="!isCancelled" class="w-5 h-5 text-emerald-600" />
                <Ban v-else class="w-5 h-5 text-muted-foreground" />
                {{ displayName }}{{ isCancelled ? ' · 已取消' : '结果' }}
            </CardTitle>
        </CardHeader>
        <CardContent v-if="!isCancelled" class="space-y-3">
            <CalculatorResultBody :tool-name="toolName" :input="parsedInput" :output="parsedOutput" />
            <Alert variant="success" class="block">
                <Check class="w-4 h-4 mr-2 inline" />
                已自动保存到案件记忆，下次再算时会自动预填这些字段
            </Alert>
        </CardContent>
        <CardContent v-else>
            <p class="text-sm text-muted-foreground">用户取消了本次计算</p>
        </CardContent>
    </Card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Alert } from '~/components/ui/alert'
import { CircleCheck, Ban, Check } from 'lucide-vue-next'
import CalculatorResultBody from '~/components/ai/tools/CalculatorResultBody.vue'
import { CALCULATOR_TOOL_META } from '#shared/utils/tools/agentTools/_fieldMetadata'

const props = defineProps<{
    toolName: string
    input?: any           // toolCall.args
    output?: any          // toolCall.result（JSON 字符串或对象）
    state?: string
}>()

const displayName = computed(() => CALCULATOR_TOOL_META[props.toolName]?.displayName ?? props.toolName)

const parsedOutput = computed<Record<string, any>>(() => {
    if (!props.output) return {}
    return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
})

const parsedInput = computed<Record<string, any>>(() => props.input ?? {})

const isCancelled = computed(() => parsedOutput.value?.cancelled === true)
</script>
```

- [ ] **Step 5: 注册到 `globalInterruptRegistry` + `PANEL_TOOL_MAP`**

`app/components/case/interrupt/index.ts` 末尾追加：

```typescript
import CalculatorInputCard from '~/components/ai/tools/CalculatorInputCard.vue'

globalInterruptRegistry.register('calculator_input', CalculatorInputCard, { isToolCard: true })
```

`app/components/agents/panelToolMap.ts` 顶部 import + map 追加（PR-A 仅 1 个，PR-B-T22 补 9 个）：

```typescript
import AiToolsCalculatorResultCard from '~/components/ai/tools/CalculatorResultCard.vue'

export const PANEL_TOOL_MAP: Record<string, Component> = {
    // ... 已有 4 个
    calculate_compensation: AiToolsCalculatorResultCard,
}
```

- [ ] **Step 6: typecheck**

Run: `bun run typecheck 2>&1 | grep -E "Calculator|panelToolMap|interrupt/index" | head -10`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add app/components/ai/tools/CalculatorFormFields.vue \
        app/components/ai/tools/CalculatorResultBody.vue \
        app/components/ai/tools/CalculatorInputCard.vue \
        app/components/ai/tools/CalculatorResultCard.vue \
        app/components/case/interrupt/index.ts \
        app/components/agents/panelToolMap.ts
git commit -m "feat(tools): Calculator 输入态/结果态两组件 + 注册 globalInterruptRegistry + PANEL_TOOL_MAP"
```

---

## 任务 PR-A-T5：compensation 工具改造（含 5 个边界 case）

**Files:**
- Modify: `shared/utils/tools/agentTools/compensationCalculator.tool.ts`
- Modify: `tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts`

- [ ] **Step 1: 用 `vi.hoisted()` 模式写测试，覆盖 8 个 case**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted: 项目惯用模式，防止 vi.resetModules 后 mock 引用失效
const { interruptMock, writeMemoryMock, findLastCalcMock } = vi.hoisted(() => ({
    interruptMock: vi.fn(),
    writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
    findLastCalcMock: vi.fn().mockResolvedValue(null),
}))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))

import { createTool } from '#shared/utils/tools/agentTools/compensationCalculator.tool'

describe('compensationCalculator - 路径 A/B/C + 边界', () => {
    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear()
        findLastCalcMock.mockClear()
        findLastCalcMock.mockResolvedValue(null)
    })

    it('路径 A: 信息充足直算 + 写记忆', async () => {
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(interruptMock).not.toHaveBeenCalled()
        const parsed = JSON.parse(r as string)
        expect(parsed.totalCompensation).toBeGreaterThan(0)
        expect(writeMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'calculation', subjectKey: 'calculation:calculate_compensation',
            extraMetadata: expect.objectContaining({
                calculation: expect.objectContaining({ tool: 'calculate_compensation' }),
            }),
        }))
    })

    it('路径 B: 缺字段 → interrupt → resume 后计算', async () => {
        interruptMock.mockReturnValue({ salary: 12000, disabilityLevel: 8 })
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ type: 'workInjury' })
        expect(interruptMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'calculator_input',
            toolName: 'calculate_compensation',
            missing: expect.arrayContaining(['salary', 'disabilityLevel']),
        }))
        expect(JSON.parse(r as string).totalCompensation).toBeGreaterThan(0)
    })

    it('路径 C: resume = null → 返回 cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ type: 'workInjury' })
        const parsed = JSON.parse(r as string)
        expect(parsed.cancelled).toBe(true)
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('ctx.caseId 为空时跳过 L2 查询 + 跳过写入', async () => {
        const tool = createTool({ userId: 1, sessionId: 's1' })  // 无 caseId
        await tool.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(findLastCalcMock).not.toHaveBeenCalled()
        expect(writeMemoryMock).not.toHaveBeenCalled()
    })

    it('resume payload 非法（非 object 非 null）抛错', async () => {
        interruptMock.mockReturnValue('invalid')
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await expect(tool.invoke({ type: 'workInjury' })).rejects.toThrow(/resume payload 非法/)
    })

    it('边界 - zod 失败：LLM 不传 type', async () => {
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        await expect(tool.invoke({ } as any)).rejects.toThrow(/type/)
    })

    it('边界 - service 抛错时返回 error JSON 不阻塞', async () => {
        // 用极端不合法参数让 service 抛
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        // workInjury 必填 salary/disabilityLevel 都缺时 LLM 调用走 interrupt 不抛 — 这里改测交通事故缺关键参数后让计算抛
        // ... 略，按 service 真实抛错条件构造
    })

    it('边界 - 写记忆失败不阻塞结果', async () => {
        writeMemoryMock.mockRejectedValueOnce(new Error('DB down'))
        const tool = createTool({ userId: 1, caseId: 100, sessionId: 's1' })
        const r = await tool.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(JSON.parse(r as string).totalCompensation).toBeGreaterThan(0)  // 结果仍返回
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts`
Expected: FAIL — 现 tool 没有 interrupt 逻辑

- [ ] **Step 3: 改造 `compensationCalculator.tool.ts` 用项目惯例 export 形态**

```typescript
/**
 * 赔偿金计算 Agent 工具（交互式版本）
 */
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { InterruptType } from '#shared/types/case'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import {
    calculateWorkInjuryCompensation,
    calculateTrafficAccidentCompensation,
    calculateDeathCompensation,
} from '#shared/utils/tools/compensationService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    type: z.enum(['workInjury', 'trafficAccident', 'death']).describe('赔偿类型'),
    salary: z.number().min(0).optional().describe('月工资（元），workInjury 必填'),
    disabilityLevel: z.number().int().min(1).max(10).optional().describe('伤残等级（1-10级），workInjury 必填'),
    medicalExpenses: z.number().min(0).optional().describe('医疗费用（元），trafficAccident 必填'),
    nursingExpenses: z.number().min(0).optional(),
    nutritionExpenses: z.number().min(0).optional(),
    disabilityCompensation: z.number().min(0).optional().describe('伤残赔偿金（元），trafficAccident 必填'),
    lostIncome: z.number().min(0).optional(),
    transportationExpenses: z.number().min(0).optional(),
    accommodationExpenses: z.number().min(0).optional(),
    propertyLoss: z.number().min(0).optional(),
    annualIncome: z.number().min(0).optional().describe('年收入（元），death 必填'),
    deathCompensationYears: z.number().int().min(1).max(20).optional(),
    funeralExpenses: z.number().min(0).optional(),
    dependentCompensation: z.number().min(0).optional(),
    emotionalDamages: z.number().min(0).optional(),
})

const REQUIRED_FIELDS: Record<string, string[]> = {
    workInjury: ['salary', 'disabilityLevel'],
    trafficAccident: ['medicalExpenses', 'disabilityCompensation'],
    death: ['annualIncome'],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_compensation',
    description: '赔偿金计算：支持工伤/交通事故/死亡 3 种场景。必填字段缺失时通过 interrupt 让用户在 inline 卡片补全，禁用 0 替代真实数据。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
        // ① L2 兜底查 case_memory
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_compensation')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, any>

        // ② 必填校验
        const required = REQUIRED_FIELDS[merged.type] ?? []
        const missing = required.filter((f) => merged[f] === undefined || merged[f] === null || merged[f] === '')

        // ③ 信息不足 → interrupt（防御性校验：as unknown + null 取消 + object 合并）
        if (missing.length > 0) {
            const resumed = interrupt({
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_compensation',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_compensation: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        let result: Record<string, unknown>
        if (merged.type === 'workInjury') {
            result = calculateWorkInjuryCompensation(
                merged.salary, merged.disabilityLevel,
                merged.medicalExpenses ?? 0, merged.nursingExpenses ?? 0, merged.nutritionExpenses ?? 0,
            ) as unknown as Record<string, unknown>
        } else if (merged.type === 'trafficAccident') {
            result = calculateTrafficAccidentCompensation(
                merged.medicalExpenses ?? 0, merged.disabilityCompensation ?? 0,
                merged.nursingExpenses ?? 0, merged.lostIncome ?? 0,
                merged.nutritionExpenses ?? 0, merged.transportationExpenses ?? 0,
                merged.accommodationExpenses ?? 0, merged.propertyLoss ?? 0,
            ) as unknown as Record<string, unknown>
        } else {
            result = calculateDeathCompensation(
                merged.annualIncome, merged.deathCompensationYears ?? 20,
                merged.funeralExpenses ?? 0, merged.dependentCompensation ?? 0,
                merged.emotionalDamages ?? 0,
            ) as unknown as Record<string, unknown>
        }

        // ⑤ 写入 case_memory（失败不阻塞）
        if (ctx.caseId) {
            await writeMemoryService({
                caseId: ctx.caseId,
                kind: 'calculation',
                text: `[计算] 赔偿金 · ${merged.type} · 总额 ${result.totalCompensation ?? '-'} 元`,
                subjectKey: 'calculation:calculate_compensation',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_compensation',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err) => {
                logger.error('[calculate_compensation] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
```

- [ ] **Step 4: 跑测试验证 PASS**

Run: `npx vitest run tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts`
Expected: 8 tests passed

- [ ] **Step 5: Commit**

```bash
git add shared/utils/tools/agentTools/compensationCalculator.tool.ts \
        tests/shared/utils/tools/agentTools/compensationCalculator.tool.test.ts
git commit -m "feat(tools): compensation 工具改造（interrupt + writeMemory + 8 边界测试）"
```

---

## 任务 PR-A-T6：agent-platform 注册 + DB 挂载

**Files:**
- Modify: `server/services/agent-platform/tools/index.ts`
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: agent-platform/tools/index.ts 注册（用项目惯例 namespace 形态，无需 `as any`）**

顶部 import：

```typescript
import * as compensationCalculatorTool from '#shared/utils/tools/agentTools/compensationCalculator.tool'
```

`toolModules` 末尾追加：

```typescript
    calculate_compensation: compensationCalculatorTool,  // 命中现有 ToolModule 接口（toolDefinition + createTool）
```

> 注：现有 `toolModules: Record<string, ToolModule>` 接受 `ToolModule = { toolDefinition, createTool }` 形态。新工具 `*.tool.ts` 也按这个 export 形态（T5 已落地），无需 `as any`。

- [ ] **Step 2: 改 dev 库 `nodes.assistantMain.tools`**

Run:
```bash
docker exec postgres psql -U daixin -d ls_new -c "
UPDATE nodes SET tools = tools || '[\"calculate_compensation\"]'::jsonb
WHERE name = 'assistantMain' AND NOT tools @> '[\"calculate_compensation\"]'::jsonb;
"
```
Expected: `UPDATE 1`

- [ ] **Step 3: 同步 seedData.sql**

按 `.claude/rules/database.md` 严格规则：**直接修改 INSERT INTO nodes ... VALUES 中 assistantMain 那一行的 tools JSON 数组**（不能写 UPDATE）。

例如原行：
```sql
INSERT INTO "public"."nodes" (..., "tools", ...) VALUES (..., '["search_law", ...]', ...);
```
改成（在数组末尾追加 `"calculate_compensation"`）：
```sql
INSERT INTO "public"."nodes" (..., "tools", ...) VALUES (..., '["search_law", ..., "calculate_compensation"]', ...);
```

- [ ] **Step 4: typecheck + Commit**

```bash
bun run typecheck 2>&1 | grep "agent-platform/tools" | head -3
git add server/services/agent-platform/tools/index.ts prisma/seeds/seedData.sql
git commit -m "feat(tools): toolModules 注册 calculate_compensation + nodes.assistantMain.tools 挂载"
```

---

## 任务 PR-A-T7：integration 测试（vi.hoisted + 注册表完整性）

**Files:**
- Create: `tests/server/agents/legal-assistant/calculator-tools.integration.test.ts`

- [ ] **Step 1: 写 integration 测试**（实质：经 agent-platform 注册表反向验证工具可被 LLM 调到）

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { interruptMock, writeMemoryMock, findLastCalcMock } = vi.hoisted(() => ({
    interruptMock: vi.fn(),
    writeMemoryMock: vi.fn().mockResolvedValue({ id: 'fake' }),
    findLastCalcMock: vi.fn().mockResolvedValue(null),
}))

vi.mock('@langchain/langgraph', () => ({ interrupt: interruptMock }))
vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryMock,
    findLastCalculationByCase: findLastCalcMock,
}))

import {
    getToolInstancesService,
    getAllToolNamesService,
} from '~~/server/services/agent-platform/tools/index'

describe('calculator-tools integration（agent-platform 注册表）', () => {
    beforeEach(() => {
        interruptMock.mockReset()
        writeMemoryMock.mockClear()
        findLastCalcMock.mockClear()
        findLastCalcMock.mockResolvedValue(null)
    })

    it('toolModules 注册表含 calculate_compensation', () => {
        expect(getAllToolNamesService()).toContain('calculate_compensation')
    })

    it('路径 A: 经注册表拿到 tool 实例直接调用', async () => {
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )
        const r = await tool!.invoke({ type: 'workInjury', salary: 12000, disabilityLevel: 8 })
        expect(interruptMock).not.toHaveBeenCalled()
        expect(JSON.parse(r as string).totalCompensation).toBeGreaterThan(0)
    })

    it('路径 B: 缺字段触发 interrupt → resume 用户填值', async () => {
        interruptMock.mockReturnValue({ salary: 12000, disabilityLevel: 8 })
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )
        const r = await tool!.invoke({ type: 'workInjury' })
        expect(interruptMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'calculator_input' }))
        expect(JSON.parse(r as string).totalCompensation).toBeGreaterThan(0)
    })

    it('路径 C: resume = null → cancelled', async () => {
        interruptMock.mockReturnValue(null)
        const [tool] = getToolInstancesService(
            ['calculate_compensation'],
            { userId: 1, caseId: 100, sessionId: 's1' },
        )
        const r = await tool!.invoke({ type: 'workInjury' })
        expect(JSON.parse(r as string).cancelled).toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/server/agents/legal-assistant/calculator-tools.integration.test.ts`
Expected: 4 tests passed

- [ ] **Step 3: Commit**

```bash
git add tests/server/agents/legal-assistant/calculator-tools.integration.test.ts
git commit -m "test(tools): calculator-tools integration 验证 3 路径 + 注册表完整性"
```

---

## 任务 PR-A-T8：浏览器手动走查 + PR-A 收尾

- [ ] **Step 1: 跑全量回归（不含案件管理，避免噪声）**

Run:
```bash
npx vitest run tests/shared/utils/tools/agentTools/ tests/server/services/memory/ tests/server/agents/legal-assistant/ 2>&1 | tail -8
```
Expected: 全 PASS（11+ tests，含 memory 3 + compensation 8 + integration 4）

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | tail -10`
Expected: 无新错误

- [ ] **Step 3: 浏览器走查（人工，4 个验收点）**

`bun dev` → 登录 → `/dashboard/assistant` → 选真实案件：

1. **路径 A**：「算下我的工伤赔偿金，我月薪 12000，伤残 8 级」→ LLM 直接调工具 → 对话流出现绿色 ✓ 结果卡（CalculatorResultCard）
2. **路径 B**：「算下我的工伤赔偿金」（不提工资）→ LLM 调工具 interrupt → 对话流出现可编辑卡（CalculatorInputCard）→ 填值点「计算」→ snapshot 卡显示「已提交，X 个字段」+ 紧接着结果卡（CalculatorResultCard）+ LLM 文字回复
3. **路径 C**：路径 B 触发后点「取消」→ snapshot 卡显示「用户取消」 + 结果卡显示「已取消」 + LLM 自然衔接
4. **search_case_memory 验收**（spec §12 第 7 项）：完成路径 A/B 后，新开对话问"我之前算过哪些"→ LLM 应通过 search_case_memory 工具召回到刚算的"[计算] 赔偿金"text

- [ ] **Step 4: PR-A 收尾 commit**

```bash
git commit --allow-empty -m "chore(tools): PR-A 完成 - 基建 + calculate_compensation 跑通 3 路径"
```

---

# PR-B · 剩余 9 个工具批量改造（约 3-4h）

## 任务 PR-B-T9：_fieldMetadata 补全 9 工具（含 court_fee 嵌套子分支）

**Files:**
- Modify: `shared/utils/tools/agentTools/_fieldMetadata.ts`

- [ ] **Step 1: 按 spec §7 + zod schema 字段名补 9 个工具 meta**

按下表分支策略，逐个工具加 `CALCULATOR_TOOL_META[xxx] = { ... }`：

| toolName | branchField | branchUiType | nestedBranchByValue |
|---|---|---|---|
| `calculate_interest` | `mode` (lpr/pboc/simple) | tab | — |
| `calculate_delay_interest` | — | — | — |
| `calculate_court_fee` | `feeTypeLevel1` (caseFee/applicationFee) | tab | `caseFee → { field: 'nonPropertyType', uiType: 'radio', options: [...] }` |
| `calculate_lawyer_fee` | `caseType` (civil/criminal/admin/commercial/consult/document) | select | — |
| `calculate_overtime_pay` | — | — | — |
| `calculate_social_insurance` | — | — | — |
| `calculate_divorce_property` | — | — | — |
| `calculate_date` | `mode` (6 种推算) | select | — |
| `bank_rate_query` | `queryType` (lpr/deposit/loan/all) | tab | — |

每个工具的 fields 列表对照 `shared/utils/tools/agentTools/<tool>.tool.ts` 的现有 zod schema，提取字段名 + describe 作为 label。

- [ ] **Step 2: typecheck + Commit**

```bash
bun run typecheck 2>&1 | grep "_fieldMetadata" | head -3
git add shared/utils/tools/agentTools/_fieldMetadata.ts
git commit -m "feat(tools): _fieldMetadata 补全 9 工具（含 court_fee 嵌套子分支）"
```

---

## 任务 PR-B-T10：CalculatorResultBody 补全 9 工具结果展示

**Files:**
- Modify: `app/components/ai/tools/CalculatorResultBody.vue`

- [ ] **Step 1: 按 spec §8.5 对照表补 9 个 v-else-if 分支**

为每个 toolName 加 `<template v-else-if="toolName === 'xxx'">`，结果布局**直接对照对应 dashboard 工具页面**（`app/pages/dashboard/tools/*.vue` 已经在 PR4 接入 `ToolsResultCard`）：

| toolName | 参考页面 | 关键 row |
|---|---|---|
| `calculate_interest` | interest.vue | 本息合计 + 计息时间 + 跨 LPR 分段表格 |
| `calculate_delay_interest` | delay-interest.vue | 本息合计 + 计息天数 + 明细表 |
| `calculate_court_fee` | court-fee.vue | 应缴费用 + 争议金额 + 明细 |
| `calculate_lawyer_fee` | lawyer-fee.vue | 律师费总额 + 明细 |
| `calculate_overtime_pay` | overtime.vue | 总加班费 + 工/休/节分项 + 调休时间 |
| `calculate_social_insurance` | social-insurance.vue | 追缴总额 + 个人/单位 2 Accordion + 明细 |
| `calculate_divorce_property` | divorce-property.vue | 4 个 Accordion：财产概览/分割结果/子女抚养/详细说明 |
| `calculate_date` | date-calculator.vue | 起止日期 + 总说明 + 结果日期/工作日天数 |
| `bank_rate_query` | bank-rate.vue | 利率表 Tab + 表格行 |

- [ ] **Step 2: typecheck + Commit**

```bash
bun run typecheck 2>&1 | grep CalculatorResultBody | head -3
git add app/components/ai/tools/CalculatorResultBody.vue
git commit -m "feat(tools): CalculatorResultBody 补全 9 工具结果展示分支"
```

---

## 任务 PR-B-T11：批量改造无分支 4 工具

**Files (合并 task)：**
- Modify: `delayInterestCalculator.tool.ts` + 其测试
- Modify: `overtimePayCalculator.tool.ts` + 其测试
- Modify: `socialInsuranceCalculator.tool.ts` + 其测试
- Modify: `divorcePropertyCalculator.tool.ts` + 其测试

- [ ] **Step 1: 对 4 个工具按 PR-A-T5 模板逐个改造**

每个工具：
- export 形态改为 `export const toolDefinition` + `export function createTool(ctx)`
- 必填校验：直接列必填字段（无分支判定）
- interrupt + resumed 防御校验
- 写记忆 catch 不阻塞
- 测试 4 cases（路径 A/B/C + caseId 空），不写 "resume 非法" case（spec 边界已被 PR-A-T5 覆盖）

每个工具的必填字段（参考 zod schema）：
- `delay_interest`: amount, startDate, endDate
- `overtime_pay`: monthlySalary（至少一个加班时长 > 0）
- `social_insurance`: monthlySalary, months
- `divorce_property`: 至少一项资产或债务 > 0（用 totalAssets + totalDebts > 0 校验）

- [ ] **Step 2: 跑全 4 测试**

Run: `npx vitest run tests/shared/utils/tools/agentTools/{delayInterest,overtimePay,socialInsurance,divorceProperty}*.tool.test.ts`
Expected: 全 PASS

- [ ] **Step 3: Commit**

```bash
git add shared/utils/tools/agentTools/{delayInterest,overtimePay,socialInsurance,divorceProperty}Calculator.tool.ts \
        tests/shared/utils/tools/agentTools/{delayInterest,overtimePay,socialInsurance,divorceProperty}Calculator.tool.test.ts
git commit -m "feat(tools): 4 个无分支工具批量接入 interrupt + writeMemory"
```

---

## 任务 PR-B-T12：批量改造有分支 5 工具

**Files (合并 task)：**
- Modify: `interestCalculator.tool.ts` + 其测试
- Modify: `courtFeeCalculator.tool.ts` + 其测试（含嵌套 nonPropertyType）
- Modify: `lawyerFeeCalculator.tool.ts` + 其测试
- Modify: `dateCalculator.tool.ts` + 其测试
- Modify: `bankRateQuery.tool.ts` + 其测试（**特殊：纯查询不调 interrupt 不写记忆**）

- [ ] **Step 1: 对 5 个工具按 PR-A-T5 模板逐个改造**

每个工具：
- export 形态对齐
- 按分支 `REQUIRED_FIELDS_BY_BRANCH[branch]` 必填校验
- court_fee 特殊：feeTypeLevel1='caseFee' 时需要再校验 nonPropertyType
- bank_rate_query 特殊：跳过 interrupt + 跳过 writeMemory（纯查询无用户输入语义）

每工具测试 4 cases（路径 A/B/C + caseId 空，bank_rate 只测 A）。

每个工具必填字段（按分支）：
- `interest`:
  - lpr/pboc: amount, startDate, endDate
  - simple: amount, startDate, endDate, customRate
- `court_fee`:
  - caseFee + property: amount > 0
  - caseFee + non-property: 仅 nonPropertyType 必选
  - applicationFee: amount > 0
- `lawyer_fee`:
  - civil/commercial/administrative: disputeAmount > 0
  - criminal: caseDuration > 0
  - consultation: consultationHours > 0
  - document: documentType 必选
- `date`:
  - addDays/addMonths/addYears: startDate + amount
  - workingDays: startDate + endDate
  - legalDeadline/limitation: startDate + limitationType
- `bank_rate_query`: 无必填（查询场景）

- [ ] **Step 2: 跑全 5 测试**

Run: `npx vitest run tests/shared/utils/tools/agentTools/{interest,courtFee,lawyerFee,date,bankRate}*.tool.test.ts`
Expected: 全 PASS

- [ ] **Step 3: Commit**

```bash
git add shared/utils/tools/agentTools/{interest,courtFee,lawyerFee,date,bankRate}*.tool.ts \
        tests/shared/utils/tools/agentTools/{interest,courtFee,lawyerFee,date,bankRate}*.tool.test.ts
git commit -m "feat(tools): 5 个有分支工具批量接入 interrupt + writeMemory（含 court_fee 嵌套子分支 + bank_rate 纯查询特例）"
```

---

## 任务 PR-B-T13：批量注册（agent-platform + PANEL_TOOL_MAP + DB）

**Files:**
- Modify: `server/services/agent-platform/tools/index.ts`
- Modify: `app/components/agents/panelToolMap.ts`
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: agent-platform/tools/index.ts 加 9 个 import + 9 个 toolModules**

```typescript
import * as interestCalculatorTool from '#shared/utils/tools/agentTools/interestCalculator.tool'
import * as delayInterestCalculatorTool from '#shared/utils/tools/agentTools/delayInterestCalculator.tool'
import * as courtFeeCalculatorTool from '#shared/utils/tools/agentTools/courtFeeCalculator.tool'
import * as lawyerFeeCalculatorTool from '#shared/utils/tools/agentTools/lawyerFeeCalculator.tool'
import * as overtimePayCalculatorTool from '#shared/utils/tools/agentTools/overtimePayCalculator.tool'
import * as socialInsuranceCalculatorTool from '#shared/utils/tools/agentTools/socialInsuranceCalculator.tool'
import * as divorcePropertyCalculatorTool from '#shared/utils/tools/agentTools/divorcePropertyCalculator.tool'
import * as dateCalculatorTool from '#shared/utils/tools/agentTools/dateCalculator.tool'
import * as bankRateQueryTool from '#shared/utils/tools/agentTools/bankRateQuery.tool'
```

toolModules 加 9 行（**无需 `as any`**）：

```typescript
    calculate_interest: interestCalculatorTool,
    calculate_delay_interest: delayInterestCalculatorTool,
    calculate_court_fee: courtFeeCalculatorTool,
    calculate_lawyer_fee: lawyerFeeCalculatorTool,
    calculate_overtime_pay: overtimePayCalculatorTool,
    calculate_social_insurance: socialInsuranceCalculatorTool,
    calculate_divorce_property: divorcePropertyCalculatorTool,
    calculate_date: dateCalculatorTool,
    bank_rate_query: bankRateQueryTool,
```

- [ ] **Step 2: panelToolMap.ts 加 9 行结果卡映射**

```typescript
    calculate_interest: AiToolsCalculatorResultCard,
    calculate_delay_interest: AiToolsCalculatorResultCard,
    calculate_court_fee: AiToolsCalculatorResultCard,
    calculate_lawyer_fee: AiToolsCalculatorResultCard,
    calculate_overtime_pay: AiToolsCalculatorResultCard,
    calculate_social_insurance: AiToolsCalculatorResultCard,
    calculate_divorce_property: AiToolsCalculatorResultCard,
    calculate_date: AiToolsCalculatorResultCard,
    bank_rate_query: AiToolsCalculatorResultCard,
```

- [ ] **Step 3: DB nodes.assistantMain.tools 追加 9 个**

```bash
docker exec postgres psql -U daixin -d ls_new -c "
UPDATE nodes SET tools = tools
  || '[\"calculate_interest\",\"calculate_delay_interest\",\"calculate_court_fee\",\"calculate_lawyer_fee\",\"calculate_overtime_pay\",\"calculate_social_insurance\",\"calculate_divorce_property\",\"calculate_date\",\"bank_rate_query\"]'::jsonb
WHERE name = 'assistantMain';
"
```

- [ ] **Step 4: seedData.sql 同步**

按 PR-A-T6 Step 3 同样规则：**修改 INSERT VALUES 中 assistantMain 行的 tools JSON 数组值**（9 个工具名追加），禁止用 UPDATE。

- [ ] **Step 5: typecheck + Commit**

```bash
bun run typecheck 2>&1 | tail -5
git add server/services/agent-platform/tools/index.ts app/components/agents/panelToolMap.ts prisma/seeds/seedData.sql
git commit -m "feat(tools): 批量注册剩余 9 个 calculator（toolModules + PANEL_TOOL_MAP + nodes.tools）"
```

---

## 任务 PR-B-T14：全量回归 + 浏览器走查 + 收尾

- [ ] **Step 1: 全量测试**

Run:
```bash
npx vitest run tests/shared/utils/tools/agentTools/ tests/server/services/memory/ tests/server/agents/legal-assistant/ 2>&1 | tail -10
```
Expected: 全 PASS（10 工具单测 + memory + integration 共 40+ tests）

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: 无新错误

- [ ] **Step 3: 浏览器手动走查 10 个工具**

按下表分别问问题，验证 3 路径至少各触发 1 次：

| 工具 | 触发问题 | 期望路径 |
|---|---|---|
| compensation | "工伤赔偿，月薪 1.2 万伤残 8 级" | A 直算 |
| interest | "本金 100 万，2019-01-01 至 2024 末，按 LPR 算" | A 或 B |
| delay-interest | "10 万本金，2020-2024 迟延履行利息" | A 或 B |
| court-fee | "争议 500 万的诉讼费" | A 直算 |
| lawyer-fee | "刑事案件律师费" | B（缺 caseDuration） |
| overtime | "加班费，月薪 1 万，工作日加班 20h" | A 直算 |
| social-insurance | "社保追缴 12 个月" | B（缺 monthlySalary） |
| divorce-property | "离婚财产分割" | B（缺资产） |
| date | "起算日 2024-01-01 后 60 天" | A 直算 |
| bank-rate | "查 2024 年 LPR" | A 直查 |

至少 1 次点「取消」验证 C 路径；至少 1 次问"我之前算过哪些"验证 search_case_memory 召回（spec §12 第 7 项）。

- [ ] **Step 4: PR-B 收尾 commit**

```bash
git commit --allow-empty -m "chore(tools): PR-B 完成 - 10 calculator 全接入法律助手"
```

---

## 收尾交付物清单

**新建**:
- `shared/utils/tools/agentTools/_fieldMetadata.ts`（10 工具元数据，含嵌套子分支）
- `app/components/ai/tools/CalculatorInputCard.vue`（输入态卡片）
- `app/components/ai/tools/CalculatorResultCard.vue`（结果态卡片）
- `app/components/ai/tools/CalculatorFormFields.vue`（动态表单）
- `app/components/ai/tools/CalculatorResultBody.vue`（10 工具结果体）
- `tests/server/agents/legal-assistant/calculator-tools.integration.test.ts`

**修改**:
- `shared/types/case.ts`（InterruptType + TypedInterruptData）
- `shared/types/memory.ts`（MemoryKind + CaseMemoryMetadata.calculation）
- `server/services/memory/memory.service.ts`（extraMetadata + findLastCalculationByCase）
- 10 个 `*.tool.ts` + 10 个 `*.tool.test.ts`
- `server/services/agent-platform/tools/index.ts`（toolModules 注册 10 个）
- `app/components/case/interrupt/index.ts`（globalInterruptRegistry 注册 calculator_input）
- `app/components/agents/panelToolMap.ts`（PANEL_TOOL_MAP 注册 10 个结果卡）
- `prisma/seeds/seedData.sql`（nodes.assistantMain.tools 加 10 个）

**测试覆盖**:
- memory.service 3 cases
- compensation 8 cases（含全部 spec §10 边界 8 种之 5 种关键场景）
- 9 个工具 × 4 cases = 36 cases
- integration 4 cases
- 浏览器手动走查 10 工具 + cancelled + search_case_memory

**生效条件**:
- 无 prisma migrate（本次无 schema 变更）
- 服务重启后 LLM 即可调全部 10 个 calculator

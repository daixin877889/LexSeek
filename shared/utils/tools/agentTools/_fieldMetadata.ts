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

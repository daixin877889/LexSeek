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

    calculate_interest: {
        toolName: 'calculate_interest',
        displayName: '利息计算',
        branchField: 'mode',
        branchUiType: 'tab',
        branchOptions: [
            { value: 'lpr', label: 'LPR利率' },
            { value: 'pboc', label: '央行基准利率' },
            { value: 'simple', label: '自定义利率' },
        ],
        fields: [
            { name: 'amount', label: '本金金额', type: 'number', unit: '元', required: true },
            { name: 'startDate', label: '计息开始日期', type: 'date', required: true },
            { name: 'endDate', label: '计息结束日期', type: 'date', required: true },
            { name: 'annualRate', label: '年化利率', type: 'number', unit: '%', requiredBy: { simple: true } },
            {
                name: 'adjustmentMethod', label: '利率调整方式', type: 'select',
                options: [
                    { value: '无', label: '无调整' },
                    { value: '上浮', label: '上浮' },
                    { value: '下浮', label: '下浮' },
                    { value: '倍率', label: '倍率' },
                    { value: '倍数', label: '倍数' },
                    { value: '加点', label: '加点' },
                    { value: '减点', label: '减点' },
                ],
            },
            { name: 'adjustmentValue', label: '调整值', type: 'number', placeholder: '倍率填倍数，加点填点数' },
            {
                name: 'lprPeriod', label: 'LPR期限档', type: 'select',
                options: [
                    { value: '1', label: '一年期' },
                    { value: '2', label: '五年期以上' },
                ],
                requiredBy: { lpr: true },
            },
            {
                name: 'pbocPeriod', label: '贷款期限档', type: 'select',
                options: [
                    { value: '1', label: '六个月以内' },
                    { value: '2', label: '六个月至一年' },
                    { value: '3', label: '一至三年' },
                    { value: '4', label: '三至五年' },
                    { value: '5', label: '五年以上' },
                ],
                requiredBy: { pboc: true },
            },
        ],
        fieldsByBranch: {
            lpr: ['amount', 'startDate', 'endDate', 'lprPeriod', 'adjustmentMethod', 'adjustmentValue'],
            pboc: ['amount', 'startDate', 'endDate', 'pbocPeriod', 'adjustmentMethod', 'adjustmentValue'],
            simple: ['amount', 'startDate', 'endDate', 'annualRate'],
        },
    },

    calculate_delay_interest: {
        toolName: 'calculate_delay_interest',
        displayName: '迟延履行利息',
        fields: [
            { name: 'amount', label: '本金金额', type: 'number', unit: '元', required: true },
            { name: 'startDate', label: '迟延开始日期', type: 'date', required: true },
            { name: 'endDate', label: '迟延结束日期', type: 'date', required: true },
        ],
    },

    calculate_court_fee: {
        toolName: 'calculate_court_fee',
        displayName: '诉讼费计算',
        branchField: 'feeTypeLevel1',
        branchUiType: 'tab',
        branchOptions: [
            { value: 'caseFee', label: '受理费' },
            { value: 'applicationFee', label: '申请费' },
        ],
        nestedBranchByValue: {
            caseFee: {
                field: 'nonPropertyType',
                uiType: 'radio',
                options: [
                    { value: 'property', label: '财产案件' },
                    { value: 'personality', label: '人格权' },
                    { value: 'other', label: '其他' },
                ],
                label: '非财产案件子类型',
            },
        },
        fields: [
            {
                name: 'feeTypeLevel2', label: '案件类型', type: 'select',
                options: [
                    { value: 'property', label: '财产案件' },
                    { value: 'nonProperty', label: '非财产案件' },
                    { value: 'intellectual', label: '知识产权' },
                    { value: 'maritime', label: '海事案件' },
                    { value: 'administrative', label: '行政案件' },
                    { value: 'appeal', label: '上诉案件' },
                    { value: 'small', label: '小额诉讼' },
                    { value: 'preservation', label: '保全申请' },
                    { value: 'execution', label: '强制执行' },
                    { value: 'arbitration', label: '仲裁申请' },
                ],
                requiredBy: { caseFee: true, applicationFee: true },
            },
            { name: 'amount', label: '争议金额', type: 'number', unit: '元' },
            {
                name: 'nonPropertyType', label: '非财产案件子类型', type: 'select',
                options: [
                    { value: 'divorce', label: '离婚案件' },
                    { value: 'personality', label: '人格权案件' },
                    { value: 'other', label: '其他非财产' },
                ],
            },
            { name: 'hasProperty', label: '是否涉及财产分割', type: 'boolean' },
            { name: 'hasDamages', label: '是否涉及损害赔偿', type: 'boolean' },
        ],
        fieldsByBranch: {
            caseFee: ['feeTypeLevel2', 'amount', 'nonPropertyType', 'hasProperty', 'hasDamages'],
            applicationFee: ['feeTypeLevel2', 'amount'],
        },
    },

    calculate_lawyer_fee: {
        toolName: 'calculate_lawyer_fee',
        displayName: '律师费计算',
        branchField: 'caseType',
        branchUiType: 'select',
        branchOptions: [
            { value: 'civil', label: '民事案件' },
            { value: 'criminal', label: '刑事案件' },
            { value: 'administrative', label: '行政案件' },
            { value: 'commercial', label: '商事案件' },
            { value: 'consultation', label: '法律咨询' },
            { value: 'document', label: '文书制作' },
        ],
        fields: [
            { name: 'disputeAmount', label: '争议金额', type: 'number', unit: '元', requiredBy: { civil: true, commercial: true } },
            {
                name: 'complexity', label: '案件复杂程度', type: 'select',
                options: [
                    { value: 'simple', label: '简单' },
                    { value: 'medium', label: '一般' },
                    { value: 'complex', label: '复杂' },
                ],
            },
            {
                name: 'region', label: '地区档次', type: 'select',
                options: [
                    { value: 'tier1', label: '一线城市' },
                    { value: 'tier2', label: '二线城市' },
                    { value: 'tier3', label: '三线及以下' },
                ],
            },
            { name: 'hasAppeal', label: '是否含上诉阶段', type: 'boolean' },
            { name: 'hasExecution', label: '是否含执行阶段', type: 'boolean' },
            { name: 'consultationHours', label: '咨询小时数', type: 'number', unit: '小时', requiredBy: { consultation: true } },
            { name: 'caseDuration', label: '案件预计时长', type: 'number', unit: '月', requiredBy: { criminal: true } },
        ],
        fieldsByBranch: {
            civil: ['disputeAmount', 'complexity', 'region', 'hasAppeal', 'hasExecution'],
            criminal: ['caseDuration', 'complexity', 'region', 'hasAppeal'],
            administrative: ['complexity', 'region', 'hasAppeal', 'hasExecution'],
            commercial: ['disputeAmount', 'complexity', 'region', 'hasAppeal', 'hasExecution'],
            consultation: ['consultationHours'],
            document: ['complexity', 'region'],
        },
    },

    calculate_overtime_pay: {
        toolName: 'calculate_overtime_pay',
        displayName: '加班费计算',
        fields: [
            { name: 'baseSalary', label: '月基本工资', type: 'number', unit: '元', required: true },
            { name: 'workdayOvertimeHours', label: '工作日加班时长', type: 'number', unit: '小时' },
            { name: 'weekendOvertimeHours', label: '休息日加班时长', type: 'number', unit: '小时' },
            { name: 'holidayOvertimeHours', label: '节假日加班时长', type: 'number', unit: '小时' },
            { name: 'workdaysPerMonth', label: '月工作日天数', type: 'number', unit: '天', placeholder: '默认 21.75 天' },
            { name: 'hoursPerDay', label: '每天工作时长', type: 'number', unit: '小时', placeholder: '默认 8 小时' },
        ],
    },

    calculate_social_insurance_backpay: {
        toolName: 'calculate_social_insurance_backpay',
        displayName: '社保追缴计算',
        fields: [
            { name: 'monthlySalary', label: '月工资基数', type: 'number', unit: '元', required: true },
            { name: 'months', label: '追缴月数', type: 'number', unit: '月', required: true },
            { name: 'includeEmployerPart', label: '是否含单位缴纳部分', type: 'boolean' },
            { name: 'pensionEmployee', label: '养老保险个人比例', type: 'number', unit: '%', placeholder: '留空用法定默认值' },
            { name: 'pensionEmployer', label: '养老保险单位比例', type: 'number', unit: '%', placeholder: '留空用法定默认值' },
            { name: 'medicalEmployee', label: '医疗保险个人比例', type: 'number', unit: '%', placeholder: '留空用法定默认值' },
            { name: 'medicalEmployer', label: '医疗保险单位比例', type: 'number', unit: '%', placeholder: '留空用法定默认值' },
            { name: 'housingEmployee', label: '公积金个人比例', type: 'number', unit: '%', placeholder: '留空用法定默认值' },
            { name: 'housingEmployer', label: '公积金单位比例', type: 'number', unit: '%', placeholder: '留空用法定默认值' },
        ],
    },

    calculate_divorce_property: {
        toolName: 'calculate_divorce_property',
        displayName: '离婚财产分割',
        fields: [
            { name: 'house', label: '房产价值', type: 'number', unit: '元' },
            { name: 'car', label: '车辆价值', type: 'number', unit: '元' },
            { name: 'savings', label: '存款金额', type: 'number', unit: '元' },
            { name: 'investments', label: '投资理财金额', type: 'number', unit: '元' },
            { name: 'otherAssets', label: '其他财产', type: 'number', unit: '元' },
            { name: 'mortgage', label: '房贷余额', type: 'number', unit: '元' },
            { name: 'carLoan', label: '车贷余额', type: 'number', unit: '元' },
            { name: 'creditCard', label: '信用卡债务', type: 'number', unit: '元' },
            { name: 'otherDebts', label: '其他债务', type: 'number', unit: '元' },
            { name: 'husbandRatio', label: '丈夫分得比例', type: 'number', placeholder: '0~1，默认 0.5' },
            { name: 'wifeRatio', label: '妻子分得比例', type: 'number', placeholder: '0~1，默认 0.5' },
            { name: 'hasChildren', label: '是否有子女', type: 'boolean' },
            {
                name: 'childCustody', label: '子女抚养权', type: 'select',
                options: [
                    { value: 'husband', label: '丈夫' },
                    { value: 'wife', label: '妻子' },
                    { value: 'shared', label: '共同抚养' },
                ],
            },
        ],
    },

    calculate_date: {
        toolName: 'calculate_date',
        displayName: '法律日期计算',
        branchField: 'mode',
        branchUiType: 'select',
        branchOptions: [
            { value: 'addDays', label: '加减天数' },
            { value: 'addMonths', label: '加减月数' },
            { value: 'addYears', label: '加减年数' },
            { value: 'workingDays', label: '工作日天数' },
            { value: 'legalDeadline', label: '法定期限截止日' },
            { value: 'limitation', label: '诉讼时效期限' },
        ],
        fields: [
            { name: 'startDate', label: '起始日期', type: 'date', required: true },
            { name: 'endDate', label: '结束日期', type: 'date', requiredBy: { workingDays: true } },
            { name: 'days', label: '天数', type: 'number', unit: '天', requiredBy: { addDays: true, legalDeadline: true } },
            { name: 'months', label: '月数', type: 'number', unit: '月', requiredBy: { addMonths: true } },
            { name: 'years', label: '年数', type: 'number', unit: '年', requiredBy: { addYears: true } },
            { name: 'excludeHolidays', label: '排除法定节假日', type: 'boolean', placeholder: '默认排除' },
            {
                name: 'limitationType', label: '诉讼时效类型', type: 'select',
                options: [
                    { value: 'general', label: '一般民事（3年）' },
                    { value: 'contract', label: '合同纠纷（3年）' },
                    { value: 'personal', label: '人身伤害（1年）' },
                ],
                requiredBy: { limitation: true },
            },
        ],
        fieldsByBranch: {
            addDays: ['startDate', 'days'],
            addMonths: ['startDate', 'months'],
            addYears: ['startDate', 'years'],
            workingDays: ['startDate', 'endDate'],
            legalDeadline: ['startDate', 'days', 'excludeHolidays'],
            limitation: ['startDate', 'limitationType'],
        },
    },

    query_bank_rate: {
        toolName: 'query_bank_rate',
        displayName: '银行利率查询',
        branchField: 'queryType',
        branchUiType: 'tab',
        branchOptions: [
            { value: 'lpr', label: 'LPR利率' },
            { value: 'deposit', label: '存款基准利率' },
            { value: 'loan', label: '贷款基准利率' },
            { value: 'all', label: '全部最新利率' },
        ],
        fields: [
            { name: 'date', label: '查询日期', type: 'date', placeholder: '不填返回最新' },
        ],
        fieldsByBranch: {
            lpr: ['date'],
            deposit: ['date'],
            loan: ['date'],
            all: [],
        },
    },
}

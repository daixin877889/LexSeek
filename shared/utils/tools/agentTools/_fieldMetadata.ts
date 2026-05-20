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
    /** 字段级条件可见：仅当 field 字段的当前值在 in 列表中时才渲染（用于多级依赖，如 court_fee 受理费类型→子字段） */
    showWhen?: { field: string; in: string[] }
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
            { value: 'severance', label: '经济补偿金' },
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
            // 经济补偿金 / 经济赔偿金（severance）
            {
                name: 'severanceSubType', label: '赔偿类型', type: 'select',
                options: [
                    { value: 'compensation', label: '经济补偿金 N / N+1' },
                    { value: 'damages', label: '经济赔偿金 2N（违法解除）' },
                ],
                requiredBy: { severance: true },
            },
            { name: 'monthlyWage', label: '离职前12个月平均工资', type: 'number', unit: '元', requiredBy: { severance: true } },
            { name: 'startDate', label: '入职日期', type: 'date', requiredBy: { severance: true } },
            { name: 'endDate', label: '离职日期', type: 'date', requiredBy: { severance: true } },
            { name: 'isWageExceed', label: '离职前12个月平均工资是否超过社会平均工资3倍', type: 'boolean' },
            { name: 'socialAverageWage', label: '社会平均工资', type: 'number', unit: '元', placeholder: '工资超 3 倍时必填' },
            { name: 'isArticle40', label: '是否属于第四十条情形', type: 'boolean' },
            { name: 'lastMonthWage', label: '离职前最后一个月工资', type: 'number', unit: '元', placeholder: 'N+1 时必填' },
        ],
        fieldsByBranch: {
            workInjury: ['salary', 'disabilityLevel', 'medicalExpenses', 'nursingExpenses', 'nutritionExpenses'],
            trafficAccident: ['medicalExpenses', 'disabilityCompensation', 'nursingExpenses', 'lostIncome',
                              'nutritionExpenses', 'transportationExpenses', 'accommodationExpenses', 'propertyLoss'],
            death: ['annualIncome', 'deathCompensationYears', 'funeralExpenses', 'dependentCompensation', 'emotionalDamages'],
            severance: ['severanceSubType', 'monthlyWage', 'startDate', 'endDate', 'isWageExceed',
                        'socialAverageWage', 'isArticle40', 'lastMonthWage'],
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
            { value: 'auto', label: '基准利率与LPR自动分段' },
        ],
        fields: [
            { name: 'amount', label: '本金', type: 'number', unit: '元', required: true },
            { name: 'startDate', label: '计息开始日期', type: 'date', required: true },
            { name: 'endDate', label: '计息结束日期', type: 'date', required: true },
            { name: 'annualRate', label: '年利率', type: 'number', unit: '%', requiredBy: { simple: true } },
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
                name: 'lprPeriod', label: 'LPR期限', type: 'select',
                options: [
                    { value: '1', label: '一年期' },
                    { value: '2', label: '五年期以上' },
                ],
                requiredBy: { lpr: true, auto: true },
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
                requiredBy: { pboc: true, auto: true },
            },
            {
                name: 'yearDays', label: '一年天数', type: 'select',
                options: [
                    { value: '365', label: '365 天（日历年）' },
                    { value: '360', label: '360 天（商业惯例）' },
                ],
                placeholder: '默认 365',
                requiredBy: { lpr: true, pboc: true, auto: true },
            },
        ],
        fieldsByBranch: {
            lpr: ['amount', 'startDate', 'endDate', 'lprPeriod', 'adjustmentMethod', 'adjustmentValue', 'yearDays'],
            pboc: ['amount', 'startDate', 'endDate', 'pbocPeriod', 'adjustmentMethod', 'adjustmentValue', 'yearDays'],
            simple: ['amount', 'startDate', 'endDate', 'annualRate'],
            auto: ['amount', 'startDate', 'endDate', 'lprPeriod', 'pbocPeriod', 'adjustmentMethod', 'adjustmentValue', 'yearDays'],
        },
    },

    calculate_delay_interest: {
        toolName: 'calculate_delay_interest',
        displayName: '迟延履行利息',
        fields: [
            { name: 'amount', label: '本金', type: 'number', unit: '元', required: true },
            { name: 'startDate', label: '迟延开始日期', type: 'date', required: true },
            { name: 'endDate', label: '迟延结束日期', type: 'date', required: true },
            {
                name: 'yearDays', label: '一年天数', type: 'select',
                options: [
                    { value: '365', label: '365 天' },
                    { value: '360', label: '360 天' },
                ],
                placeholder: '默认 365',
            },
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
        fields: [
            {
                name: 'caseFeeType', label: '案件类型', type: 'select',
                options: [
                    { value: 'property', label: '财产案件' },
                    { value: 'nonProperty', label: '非财产案件' },
                    { value: 'intellectualProperty', label: '知识产权案件' },
                    { value: 'labor', label: '劳动争议案件' },
                    { value: 'administrative', label: '行政案件' },
                    { value: 'jurisdiction', label: '管辖权异议' },
                ],
                requiredBy: { caseFee: true },
            },
            {
                name: 'applicationFeeType', label: '申请类型', type: 'select',
                options: [
                    { value: 'execution', label: '申请执行' },
                    { value: 'preservation', label: '申请财产保全' },
                    { value: 'paymentOrder', label: '申请支付令' },
                    { value: 'publicNotice', label: '申请公示催告' },
                    { value: 'arbitration', label: '申请撤销/认定仲裁裁决' },
                    { value: 'bankruptcy', label: '申请破产' },
                    { value: 'maritime', label: '海事案件申请' },
                ],
                requiredBy: { applicationFee: true },
            },
            { name: 'amount', label: '争议金额', type: 'number', unit: '元' },
            {
                name: 'nonPropertyType', label: '非财产案件细分', type: 'select',
                options: [
                    { value: 'divorce', label: '离婚案件' },
                    { value: 'personality', label: '人格权案件' },
                    { value: 'other', label: '其他非财产案件' },
                ],
                showWhen: { field: 'caseFeeType', in: ['nonProperty'] },
            },
            { name: 'hasProperty', label: '离婚案件是否涉及财产分割', type: 'boolean',
              showWhen: { field: 'nonPropertyType', in: ['divorce'] } },
            { name: 'hasDamages', label: '人格权案件是否涉及损害赔偿', type: 'boolean',
              showWhen: { field: 'nonPropertyType', in: ['personality'] } },
            { name: 'hasDisputeAmount', label: '知识产权案件是否有争议金额', type: 'boolean',
              showWhen: { field: 'caseFeeType', in: ['intellectualProperty'] } },
            {
                name: 'administrativeType', label: '行政案件类型', type: 'select',
                options: [
                    { value: 'general', label: '一般行政案件' },
                    { value: 'special', label: '特殊行政案件' },
                ],
                showWhen: { field: 'caseFeeType', in: ['administrative'] },
            },
            { name: 'hasExecutionAmount', label: '执行申请是否有金额', type: 'boolean',
              showWhen: { field: 'applicationFeeType', in: ['execution'] } },
            { name: 'hasPreservationProperty', label: '保全申请是否有财产价值', type: 'boolean',
              showWhen: { field: 'applicationFeeType', in: ['preservation'] } },
            {
                name: 'maritimeType', label: '海事申请类型', type: 'select',
                options: [
                    { value: 'fund', label: '设立责任限制基金' },
                    { value: 'order', label: '海事强制令' },
                    { value: 'notice', label: '船舶优先权催告' },
                    { value: 'register', label: '债权登记' },
                    { value: 'average', label: '共同海损' },
                ],
                showWhen: { field: 'applicationFeeType', in: ['maritime'] },
            },
        ],
        fieldsByBranch: {
            caseFee: ['caseFeeType', 'amount', 'nonPropertyType', 'hasProperty', 'hasDamages', 'hasDisputeAmount', 'administrativeType'],
            applicationFee: ['applicationFeeType', 'amount', 'hasExecutionAmount', 'hasPreservationProperty', 'maritimeType'],
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
                    { value: 'very-complex', label: '特别复杂' },
                ],
            },
            {
                name: 'region', label: '地区', type: 'select',
                options: [
                    { value: 'tier1', label: '一线城市' },
                    { value: 'tier2', label: '二线城市' },
                    { value: 'tier3', label: '三线及以下' },
                ],
            },
            { name: 'hasAppeal', label: '是否包含上诉阶段', type: 'boolean' },
            { name: 'hasExecution', label: '是否包含执行阶段', type: 'boolean' },
            { name: 'consultationHours', label: '咨询时长', type: 'number', unit: '小时', requiredBy: { consultation: true } },
            { name: 'caseDuration', label: '案件预计持续时间', type: 'number', unit: '月', requiredBy: { criminal: true } },
            {
                name: 'administrativeType', label: '行政案件类型', type: 'select',
                options: [
                    { value: 'basic', label: '一般行政案件' },
                    { value: 'land', label: '土地行政案件' },
                    { value: 'planning', label: '规划行政案件' },
                    { value: 'environmental', label: '环境行政案件' },
                    { value: 'licensing', label: '行政许可案件' },
                ],
            },
            {
                name: 'documentType', label: '文书类型', type: 'select',
                options: [
                    { value: 'contract', label: '合同文书' },
                    { value: 'lawsuit', label: '诉讼文书' },
                    { value: 'opinion', label: '法律意见书' },
                    { value: 'will', label: '遗嘱' },
                    { value: 'corporate', label: '公司法律文件' },
                ],
                requiredBy: { document: true },
            },
            {
                name: 'documentComplexity', label: '文书复杂程度', type: 'select',
                options: [
                    { value: 'simple', label: '简单' },
                    { value: 'medium', label: '一般' },
                    { value: 'complex', label: '复杂' },
                ],
            },
            {
                name: 'commercialType', label: '商事服务类型', type: 'select',
                options: [
                    { value: 'contract_review', label: '合同审查' },
                    { value: 'negotiation', label: '商务谈判' },
                    { value: 'due_diligence', label: '尽职调查' },
                    { value: 'ipo_advisory', label: '上市法律顾问' },
                    { value: 'compliance', label: '合规服务' },
                ],
                requiredBy: { commercial: true },
            },
        ],
        fieldsByBranch: {
            civil: ['disputeAmount', 'complexity', 'region', 'hasAppeal', 'hasExecution'],
            criminal: ['caseDuration', 'complexity', 'region', 'hasAppeal'],
            administrative: ['administrativeType', 'complexity', 'region', 'hasAppeal', 'hasExecution'],
            commercial: ['commercialType', 'disputeAmount', 'complexity', 'region', 'hasAppeal', 'hasExecution'],
            consultation: ['consultationHours'],
            document: ['documentType', 'documentComplexity', 'region'],
        },
    },

    calculate_overtime_pay: {
        toolName: 'calculate_overtime_pay',
        displayName: '加班费计算',
        fields: [
            { name: 'baseSalary', label: '月基本工资', type: 'number', unit: '元', required: true },
            { name: 'workdayOvertimeHours', label: '工作日加班时间', type: 'number', unit: '小时' },
            { name: 'weekendOvertimeHours', label: '休息日加班时间', type: 'number', unit: '小时' },
            { name: 'holidayOvertimeHours', label: '法定节假日加班时间', type: 'number', unit: '小时' },
            { name: 'workdaysPerMonth', label: '月工作日天数', type: 'number', unit: '天', placeholder: '默认 21.75 天' },
            { name: 'hoursPerDay', label: '每天工作时间', type: 'number', unit: '小时', placeholder: '默认 8 小时' },
        ],
    },

    calculate_social_insurance_backpay: {
        toolName: 'calculate_social_insurance_backpay',
        displayName: '社保追缴计算',
        fields: [
            { name: 'monthlySalary', label: '月工资', type: 'number', unit: '元', required: true },
            { name: 'months', label: '追缴月数', type: 'number', unit: '月', required: true },
            { name: 'includeEmployerPart', label: '是否包含单位部分', type: 'boolean' },
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
            { name: 'savings', label: '存款', type: 'number', unit: '元' },
            { name: 'investments', label: '投资理财', type: 'number', unit: '元' },
            { name: 'otherAssets', label: '其他财产', type: 'number', unit: '元' },
            { name: 'mortgage', label: '房贷余额', type: 'number', unit: '元' },
            { name: 'carLoan', label: '车贷余额', type: 'number', unit: '元' },
            { name: 'creditCard', label: '信用卡债务', type: 'number', unit: '元' },
            { name: 'otherDebts', label: '其他债务', type: 'number', unit: '元' },
            { name: 'husbandRatio', label: '丈夫分割比例', type: 'number', placeholder: '0~1，默认 0.5' },
            { name: 'wifeRatio', label: '妻子分割比例', type: 'number', placeholder: '0~1，默认 0.5' },
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

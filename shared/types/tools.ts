/**
 * 工具模块类型定义
 */

// ============ 仲裁费用计算 ============
export type RegionType = 'tier1' | 'tier2' | 'tier3'

export interface ArbitrationFeeResult {
    disputeAmount: number
    fee: number
    details: string[]
}

// ============ 银行利率 ============
export interface LPRRate {
    date: string
    oneYear: number
    fiveYear: number
}

export interface DepositRate {
    date: string
    demand: number
    threeMonths: number
    sixMonths: number
    oneYear: number
    twoYear: number
    threeYear: number
    fiveYear: number
}

export interface LoanRate {
    date: string
    sixMonths: number
    oneYear: number
    oneToFiveYear: number
    fiveYear: number
}

// ============ 赔偿金计算 ============
export interface WorkInjuryCompensationResult {
    disabilityCompensation: number
    medicalExpenses: number
    nursingExpenses: number
    nutritionExpenses: number
    totalCompensation: number
    details: string[]
}

export interface TrafficAccidentCompensationResult {
    medicalExpenses: number
    disabilityCompensation: number
    nursingExpenses: number
    lostIncome: number
    nutritionExpenses: number
    transportationExpenses: number
    accommodationExpenses: number
    propertyLoss: number
    totalCompensation: number
    details: string[]
}

export interface DeathCompensationResult {
    deathCompensation: number
    funeralExpenses: number
    dependentCompensation: number
    emotionalDamages: number
    totalCompensation: number
    details: string[]
}

// ============ 诉讼费用计算 ============
export type FeeTypeLevel1 = 'caseFee' | 'applicationFee'
export type CaseFeeType = 'property' | 'nonProperty' | 'intellectualProperty' | 'labor' | 'administrative' | 'jurisdiction'
export type ApplicationFeeType = 'execution' | 'preservation' | 'paymentOrder' | 'publicNotice' | 'arbitration' | 'bankruptcy' | 'maritime'
export type NonPropertyType = 'divorce' | 'personality' | 'other'
export type AdministrativeType = 'special' | 'other'
export type MaritimeType = 'fund' | 'order' | 'notice' | 'register' | 'average'

export interface CourtFeeOptions {
    nonPropertyType?: NonPropertyType
    hasProperty?: boolean
    hasDamages?: boolean
    hasDisputeAmount?: boolean
    administrativeType?: AdministrativeType
    hasExecutionAmount?: boolean
    hasPreservationProperty?: boolean
    maritimeType?: MaritimeType
}

export interface CourtFeeResult {
    totalFee: number
    details: string[]
}

// ============ 日期计算 ============
export type LimitationType = 'general' | 'contract' | 'personal'

export interface DateCalculationResult {
    startDate: string
    resultDate: string
    details: string
    days?: number
    months?: number
    years?: number
}

export interface WorkingDaysResult {
    startDate: string
    endDate: string
    workingDays: number
    details: string
}

export interface LegalDeadlineResult {
    startDate: string
    days: number
    excludeHolidays: boolean
    resultDate: string
    details: string
}

export interface LimitationPeriodResult {
    startDate: string
    type: LimitationType
    years: number
    resultDate: string
    details: string
}

// ============ 迟延履行利息 ============
export interface InterestDetail {
    startDate: string
    endDate: string
    days: number
    rate: number
    adjustedRate?: number
    interest: number
}

export interface DelayInterestResult {
    amount: number
    startDate: string
    endDate: string
    days: number
    totalInterest: number
    total: number
    details: string[]
    interestDetails: InterestDetail[]
}

// ============ 离婚财产分割 ============
export interface DivorceAssets {
    house?: number
    car?: number
    savings?: number
    investments?: number
    other?: number
}

export interface DivorceDebts {
    mortgage?: number
    carLoan?: number
    creditCard?: number
    other?: number
}

export type ChildCustody = 'husband' | 'wife' | 'shared'

export interface DivorceOptions {
    husbandRatio?: number
    wifeRatio?: number
    hasChildren?: boolean
    childCustody?: ChildCustody
}

export interface DivorcePropertyResult {
    totalAssets: number
    totalDebts: number
    netAssets: number
    husbandNetAssets: number
    wifeNetAssets: number
    childSupportAmount: number
    childSupportPayer: string
    childSupportReceiver: string
    details: string[]
}

export interface MaritalPropertyResult {
    husbandPreMaritalAssets: number
    wifePreMaritalAssets: number
    jointTotalAssets: number
    jointIncrease: number
    details: string[]
}

// ============ 图片水印 ============
export type WatermarkPosition = 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

export interface TextWatermarkOptions {
    text?: string
    font?: string
    color?: string
    position?: WatermarkPosition
    rotate?: number
}

export interface ImageWatermarkOptions {
    position?: WatermarkPosition
    opacity?: number
    scale?: number
}

// ============ 利息计算 ============
export type RateType = 1 | 2  // 1: 基准利率, 2: LPR
export type PeriodType = 1 | 2 | 3 | 4 | 5
export type AdjustmentMethod = '无' | '上浮' | '下浮' | '倍率' | '倍数' | '加点' | '减点'

export interface InterestRateData {
    sTime: string
    rate: number
    type: number
    period: number
}

export interface PeriodInterestResult {
    principal: number
    rate: number
    days: number
    yearDays: number
    interest: number
    adjustedRate: number
    process: string
}

export interface CustomRateInterestResult {
    amount: number
    customRate: number
    days: number
    totalInterest: number
    total: number
    yearDays: number
    startDate: string
    endDate: string
    process: string
    details: string[]
    interestDetails: InterestDetail[]
    error?: string
}

export interface LPRInterestResult {
    amount: number
    startDate: string
    endDate: string
    totalInterest: number
    total: number
    days: number
    interestDetails: InterestDetail[]
    details: string[]
    error?: string
    message?: string
}

export interface PBOCInterestResult {
    amount: number
    startDate?: string
    endDate?: string
    totalInterest: number
    total: number
    days: number
    interestDetails?: InterestDetail[]
    details: string[]
}

export interface SimpleInterestResult {
    principal: number
    rate: number
    days: number
    interest: number
    total: number
    details: string[]
}

export interface CompoundInterestResult {
    principal: number
    rate: number
    days: number
    interest: number
    total: number
    details: string[]
}

export interface LoanInterestResult {
    principal: number
    rate: number
    months: number
    monthlyPayment?: number
    monthlyPrincipal?: number
    firstMonthPayment?: number
    lastMonthPayment?: number
    totalPayment: number
    totalInterest: number
    details: string[]
}

// ============ 律师费用 ============
export type LawyerCaseType = 'civil' | 'criminal' | 'administrative' | 'consultation' | 'document' | 'commercial'
export type ComplexityType = 'simple' | 'medium' | 'complex' | 'very-complex'
export type LawyerAdministrativeType = 'basic' | 'land' | 'planning' | 'environmental' | 'licensing'
export type DocumentType = 'contract' | 'lawsuit' | 'opinion' | 'will' | 'corporate'
export type CommercialType = 'contract_review' | 'negotiation' | 'due_diligence' | 'ipo_advisory' | 'compliance'
export type CivilStage = 'preparation' | 'evidence' | 'court' | 'settlement'
export type CriminalStage = 'investigation' | 'prosecution' | 'trial'

export interface LawyerFeeOptions {
    disputeAmount?: number
    complexity?: ComplexityType
    administrativeType?: LawyerAdministrativeType
    consultationHours?: number
    region?: RegionType
    hasAppeal?: boolean
    hasExecution?: boolean
    stages?: (CivilStage | CriminalStage)[]
    caseDuration?: number
    documentType?: DocumentType
    documentComplexity?: ComplexityType
    commercialType?: CommercialType
}

export interface LawyerFeeResult {
    caseType: LawyerCaseType
    fee: number
    details: string[]
}

// ============ 加班费计算 ============
export interface OvertimePayResult {
    hourlyRate: string
    workdayOvertimePay: string
    weekendOvertimePay: string
    holidayOvertimePay: string
    totalOvertimePay: string
    details: string[]
}

export interface CompensatoryTimeResult {
    workdayCompensatoryHours: number
    weekendCompensatoryHours: number
    holidayCompensatoryHours: number
    totalCompensatoryHours: number
    totalCompensatoryDays: string
    details: string[]
}

// ============ 社保追缴 ============
export interface InsuranceRatePair {
    employee: number
    employer: number
}

export interface SocialInsuranceRates {
    pension?: InsuranceRatePair
    medical?: InsuranceRatePair
    unemployment?: InsuranceRatePair
    injury?: InsuranceRatePair
    maternity?: InsuranceRatePair
    housing?: InsuranceRatePair
}

export interface InsurancePart {
    pension: number
    medical: number
    unemployment: number
    injury: number
    maternity: number
    housing: number
    total: number
}

export interface SocialInsuranceBackpayResult {
    employeePart: InsurancePart
    employerPart: InsurancePart
    totalBackpay: number
    details: string[]
}

// ============ 工具函数 ============
export interface FormValidationRule {
    required?: boolean
    type?: 'number' | 'integer' | 'positive' | 'nonNegative' | 'date'
    min?: number
    max?: number
    message?: string
}

export interface FormValidationRules {
    [key: string]: FormValidationRule
}

export interface FormValidationResult {
    valid: boolean
    errors: { [key: string]: string }
}

// ============ Excel 导出 ============
export interface ExcelHeader {
    key: string
    title: string
}

export interface InterestExportResult {
    pbocResult?: {
        interestDetails?: InterestDetail[]
    }
    lprResult?: {
        interestDetails?: InterestDetail[]
    }
    interestDetails?: InterestDetail[]
    days: number
    totalInterest: number
}

export interface CompensationExportResult {
    isCompensation: boolean
    startDate: string
    endDate: string
    totalYears: number
    totalMonths: number
    totalDays: number
    calculatedYears: number
    effectiveMonthlyWage: number
    isArticle40: boolean
    lastMonthWage: number
    totalAmount: number
}

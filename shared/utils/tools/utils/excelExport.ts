// @ts-ignore - file-saver 没有类型声明
import * as XLSX from 'xlsx'
// @ts-ignore - file-saver 没有类型声明
import { saveAs } from 'file-saver'
import type { ExcelHeader, InterestDetail, InterestExportResult, CompensationExportResult } from '#shared/types/tools'

interface ExportDataRow {
    [key: string]: string | number | undefined
}

interface DetailDataRow {
    stage: string
    startDate: string
    endDate: string
    days: number
    baseRate: number | string
    adjustedRate: number | string
    interest: number
    [key: string]: string | number
}

/**
 * 通用Excel导出函数
 * @param data 要导出的数据数组
 * @param headers 列标题数组，格式为 [{key: 'fieldName', title: '显示标题'}]
 * @param filename 导出文件名
 * @param sheetName 工作表名称
 */
export function exportToExcel(
    data: ExportDataRow[],
    headers: ExcelHeader[],
    filename: string,
    sheetName: string = 'Sheet1'
): void {
    // 转换数据格式
    const exportData = data.map(item => {
        const row: Record<string, unknown> = {}
        headers.forEach(header => {
            row[header.title] = item[header.key]
        })
        return row
    })

    // 创建工作簿
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(exportData)

    // 设置列宽
    const columnWidths = headers.map(header => ({ wch: Math.max(header.title.length * 2, 10) }))
    worksheet['!cols'] = columnWidths

    // 添加工作表到工作簿
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

    // 生成Excel文件并下载
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' })
    saveAs(blob, `${filename}.xlsx`)
}


/**
 * 利息计算结果导出
 * @param result 利息计算结果
 * @param calculationType 计算类型
 */
export function exportInterestToExcel(result: InterestExportResult, calculationType: string): void {
    const filename = `利息计算结果_${new Date().toLocaleDateString()}`

    // 创建工作簿
    const workbook = XLSX.utils.book_new()

    // 准备计算明细数据
    let detailData: DetailDataRow[] = []

    // 处理分段计算的情况（跨越2019-08-20）
    if (result.pbocResult && result.lprResult) {
        // 添加分两个阶段的明细数据
        if (result.pbocResult.interestDetails) {
            detailData = detailData.concat(
                result.pbocResult.interestDetails.map((detail: InterestDetail) => ({
                    stage: '基准利率阶段',
                    startDate: detail.startDate,
                    endDate: detail.endDate,
                    days: detail.days,
                    baseRate: detail.rate,
                    adjustedRate: detail.adjustedRate || detail.rate,
                    interest: detail.interest
                }))
            )
        }

        if (result.lprResult.interestDetails) {
            detailData = detailData.concat(
                result.lprResult.interestDetails.map((detail: InterestDetail) => ({
                    stage: 'LPR利率阶段',
                    startDate: detail.startDate,
                    endDate: detail.endDate,
                    days: detail.days,
                    baseRate: detail.rate,
                    adjustedRate: detail.adjustedRate || detail.rate,
                    interest: detail.interest
                }))
            )
        }

        // 添加合计行
        detailData.push({
            stage: '合计',
            startDate: '',
            endDate: '',
            days: result.days,
            baseRate: '',
            adjustedRate: '',
            interest: result.totalInterest
        })

    } else if (result.interestDetails) {
        // 单一计算方式
        detailData = result.interestDetails.map((detail: InterestDetail) => ({
            stage: getCalculationTypeText(calculationType),
            startDate: detail.startDate,
            endDate: detail.endDate,
            days: detail.days,
            baseRate: detail.rate,
            adjustedRate: detail.adjustedRate || detail.rate,
            interest: detail.interest
        }))

        // 添加合计行
        detailData.push({
            stage: '合计',
            startDate: '',
            endDate: '',
            days: result.days,
            baseRate: '',
            adjustedRate: '',
            interest: result.totalInterest
        })
    }

    // 明细表头
    const detailHeaders: ExcelHeader[] = [
        { key: 'stage', title: '阶段' },
        { key: 'startDate', title: '开始日期' },
        { key: 'endDate', title: '结束日期' },
        { key: 'days', title: '天数' },
        { key: 'baseRate', title: '基础利率(%)' },
        { key: 'adjustedRate', title: '调整后利率(%)' },
        { key: 'interest', title: '利息(元)' }
    ]

    // 添加明细工作表
    const detailWorksheet = XLSX.utils.json_to_sheet(
        detailData.map(item => {
            const row: Record<string, string | number> = {}
            detailHeaders.forEach(header => {
                let value: string | number = item[header.key] ?? ''
                if ((header.key === 'baseRate' || header.key === 'adjustedRate') && value !== '') {
                    value = parseFloat(String(value)).toFixed(2)
                } else if (header.key === 'interest') {
                    value = parseFloat(String(value)).toFixed(2)
                }
                row[header.title] = value
            })
            return row
        })
    )

    // 设置列宽
    const columnWidths = detailHeaders.map(header => ({ wch: Math.max(header.title.length * 2, 10) }))
    detailWorksheet['!cols'] = columnWidths

    XLSX.utils.book_append_sheet(workbook, detailWorksheet, '计算明细')

    // 生成Excel文件并下载
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' })
    saveAs(blob, `${filename}.xlsx`)
}

/**
 * 赔偿金计算结果导出
 * @param result 赔偿金计算结果
 */
export function exportCompensationToExcel(result: CompensationExportResult): void {
    const filename = `赔偿金计算结果_${new Date().toLocaleDateString()}`

    // 定义数据
    const data: ExportDataRow[] = [{
        type: result.isCompensation ? '经济补偿金' : '经济赔偿金',
        startDate: result.startDate,
        endDate: result.endDate,
        workYears: `${result.totalYears}年${result.totalMonths}个月${result.totalDays}天`,
        calculatedYears: result.calculatedYears,
        monthlyWage: result.effectiveMonthlyWage,
        additionalCompensation: result.isArticle40 ? result.lastMonthWage : '无',
        totalAmount: result.totalAmount
    }]

    // 定义表头
    const headers: ExcelHeader[] = [
        { key: 'type', title: '赔偿类型' },
        { key: 'startDate', title: '入职日期' },
        { key: 'endDate', title: '离职日期' },
        { key: 'workYears', title: '工作时长' },
        { key: 'calculatedYears', title: '计算年限' },
        { key: 'monthlyWage', title: '月工资(元)' },
        { key: 'additionalCompensation', title: '额外补偿(元)' },
        { key: 'totalAmount', title: '总计金额(元)' }
    ]

    exportToExcel(data, headers, filename)
}


/**
 * 迟延履行利息计算结果导出
 * @param result 迟延履行利息计算结果
 */
export function exportDelayInterestToExcel(result: {
    interestDetails?: InterestDetail[]
    details?: string[]
    startDate: string
    endDate: string
    days: number
    totalInterest: number
}): void {
    const filename = `迟延履行利息计算结果_${new Date().toLocaleDateString()}`

    // 创建工作簿
    const workbook = XLSX.utils.book_new()

    // 准备计算明细数据
    let detailData: DetailDataRow[] = []

    // 直接使用原始利息明细数据，与页面显示保持一致
    if (result.interestDetails && result.interestDetails.length > 0) {
        // 2019年8月20日 - 政策分界点
        const policyDate = new Date('2019-08-20')

        // 处理每条明细记录
        detailData = result.interestDetails.map(detail => {
            const detailStartDate = new Date(detail.startDate)
            return {
                stage: detailStartDate < policyDate ? '基准利率阶段' : 'LPR利率阶段',
                startDate: detail.startDate,
                endDate: detail.endDate,
                days: detail.days,
                baseRate: detail.rate,
                adjustedRate: detail.adjustedRate || detail.rate,
                interest: detail.interest
            }
        })

        // 添加合计行
        detailData.push({
            stage: '合计',
            startDate: '',
            endDate: '',
            days: result.days,
            baseRate: '',
            adjustedRate: '',
            interest: result.totalInterest
        })

    } else if (result.details && result.details.length > 0) {
        // 处理旧版结果格式
        const details = result.details
        if (details.length > 5 && details[2]?.includes('跨越')) {
            // 跨越2019年8月20日的情况
            detailData = [
                {
                    stage: '基准利率阶段',
                    startDate: result.startDate,
                    endDate: '2019-08-20',
                    days: extractNumberFromString(details[3] ?? '', /(\d+)天/),
                    baseRate: extractNumberFromString(details[4] ?? '', /基准利率：(\d+\.?\d*)%/),
                    adjustedRate: extractNumberFromString(details[4] ?? '', /迟延履行利率：(\d+\.?\d*)%/),
                    interest: extractNumberFromString(details[5] ?? '', /= (\d+\.?\d*)元/)
                },
                {
                    stage: 'LPR利率阶段',
                    startDate: '2019-08-20',
                    endDate: result.endDate,
                    days: extractNumberFromString(details[6] ?? '', /(\d+)天/),
                    baseRate: extractNumberFromString(details[7] ?? '', /LPR利率：(\d+\.?\d*)%/),
                    adjustedRate: extractNumberFromString(details[7] ?? '', /迟延履行利率：(\d+\.?\d*)%/),
                    interest: extractNumberFromString(details[8] ?? '', /= (\d+\.?\d*)元/)
                },
                {
                    stage: '合计',
                    startDate: '',
                    endDate: '',
                    days: result.days,
                    baseRate: '',
                    adjustedRate: '',
                    interest: result.totalInterest
                }
            ]
        } else {
            // 单一阶段计算
            let stage: string
            let baseRate: number
            let adjustedRate: number
            const detail2 = details[2] ?? ''
            const detail3 = details[3] ?? ''
            if (detail2.includes('LPR')) {
                stage = 'LPR利率阶段'
                baseRate = extractNumberFromString(detail3, /LPR利率：(\d+\.?\d*)%/)
                adjustedRate = extractNumberFromString(detail3, /迟延履行利率：(\d+\.?\d*)%/)
            } else {
                stage = '基准利率阶段'
                baseRate = extractNumberFromString(detail3, /基准利率：(\d+\.?\d*)%/)
                adjustedRate = extractNumberFromString(detail3, /迟延履行利率：(\d+\.?\d*)%/)
            }

            detailData = [
                {
                    stage: stage,
                    startDate: result.startDate,
                    endDate: result.endDate,
                    days: result.days,
                    baseRate: baseRate,
                    adjustedRate: adjustedRate,
                    interest: result.totalInterest
                },
                {
                    stage: '合计',
                    startDate: '',
                    endDate: '',
                    days: result.days,
                    baseRate: '',
                    adjustedRate: '',
                    interest: result.totalInterest
                }
            ]
        }
    }

    // 明细表头
    const detailHeaders: ExcelHeader[] = [
        { key: 'stage', title: '阶段' },
        { key: 'startDate', title: '开始日期' },
        { key: 'endDate', title: '结束日期' },
        { key: 'days', title: '天数' },
        { key: 'baseRate', title: '基础利率(%)' },
        { key: 'adjustedRate', title: '计算利率(%)' },
        { key: 'interest', title: '利息(元)' }
    ]

    // 添加明细工作表
    const detailWorksheet = XLSX.utils.json_to_sheet(
        detailData.map(item => {
            const row: Record<string, string | number> = {}
            detailHeaders.forEach(header => {
                let value: string | number = item[header.key] ?? ''
                if ((header.key === 'baseRate' || header.key === 'adjustedRate') && value !== '') {
                    value = parseFloat(String(value)).toFixed(2)
                } else if (header.key === 'interest') {
                    value = parseFloat(String(value)).toFixed(2)
                }
                row[header.title] = value
            })
            return row
        })
    )

    // 设置列宽
    const columnWidths = detailHeaders.map(header => ({ wch: Math.max(header.title.length * 2, 10) }))
    detailWorksheet['!cols'] = columnWidths

    XLSX.utils.book_append_sheet(workbook, detailWorksheet, '计算明细')

    // 生成Excel文件并下载
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' })
    saveAs(blob, `${filename}.xlsx`)
}

// 辅助函数：从字符串中提取数字
function extractNumberFromString(str: string, regex: RegExp): number {
    const match = str.match(regex)
    return match && match[1] ? parseFloat(match[1]) : 0
}

// 辅助函数：获取计算类型文本
function getCalculationTypeText(type: string): string {
    const typeMap: Record<string, string> = {
        'custom': '自定义利率',
        'lpr': 'LPR利率',
        'pboc': '央行基准利率',
        'auto': '基准利率与LPR自动分段'
    }
    return typeMap[type] || type
}

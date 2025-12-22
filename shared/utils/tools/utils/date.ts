/**
 * 日期工具函数
 */

// 注意：logger 在 Nuxt 中会自动导入
// import logger from '@/utils/logger'

/**
 * 格式化日期为 YYYY-MM-DD 格式
 * @param date 日期对象或日期字符串
 * @returns 格式化后的日期字符串
 */
export function formatDate(date: Date | string | null | undefined): string {
    if (!date) {
        console.error('formatDate: 日期参数为空')
        return ''
    }

    let dateObj: Date
    try {
        // 如果传入的是字符串，先转换为日期对象
        dateObj = typeof date === 'string' ? new Date(date) : date

        // 检查日期是否有效
        if (isNaN(dateObj.getTime())) {
            console.error('formatDate: 无效的日期', date)
            return ''
        }

        const year = dateObj.getFullYear()
        // 月份从0开始，需要+1，并确保是两位数
        const month = String(dateObj.getMonth() + 1).padStart(2, '0')
        const day = String(dateObj.getDate()).padStart(2, '0')

        return `${year}-${month}-${day}`
    } catch (error) {
        console.error('formatDate: 日期格式化失败', error)
        return ''
    }
}

/**
 * 解析日期字符串为日期对象
 * @param dateStr 日期字符串 (YYYY-MM-DD)
 * @returns 日期对象或null
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) {
        console.error('parseDate: 日期字符串为空')
        return null
    }

    try {
        // 验证日期格式 YYYY-MM-DD
        const regex = /^(\d{4})-(\d{2})-(\d{2})$/
        const match = dateStr.match(regex)

        if (!match) {
            console.error('parseDate: 日期格式不正确，应为YYYY-MM-DD', dateStr)
            return null
        }

        const year = parseInt(match[1] ?? '0', 10)
        const month = parseInt(match[2] ?? '0', 10) - 1 // 月份从0开始
        const day = parseInt(match[3] ?? '0', 10)

        const date = new Date(year, month, day)

        // 验证日期有效性
        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month ||
            date.getDate() !== day
        ) {
            console.error('parseDate: 无效的日期', dateStr)
            return null
        }

        // 设置时间为当天的00:00:00
        date.setHours(0, 0, 0, 0)

        return date
    } catch (error) {
        console.error('parseDate: 日期解析失败', error)
        return null
    }
}

/**
 * 计算两个日期之间的天数
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @returns 天数差值
 */
export function daysBetween(startDate: string | Date, endDate: string | Date): number {
    try {
        // 确保日期是Date对象
        const start = typeof startDate === 'string' ? parseDate(startDate) : startDate
        const end = typeof endDate === 'string' ? parseDate(endDate) : endDate

        if (!start || !end) {
            console.error('daysBetween: 无效的开始日期或结束日期')
            return 0
        }

        // 重置时间为00:00:00以确保正确计算天数
        const startTime = new Date(start)
        startTime.setHours(0, 0, 0, 0)

        const endTime = new Date(end)
        endTime.setHours(0, 0, 0, 0)

        // 计算天数差 (毫秒转为天)
        const diffTime = Math.abs(endTime.getTime() - startTime.getTime())
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

        return diffDays
    } catch (error) {
        console.error('daysBetween: 计算天数失败', error)
        return 0
    }
}

/**
 * 判断是否为闰年
 * @param year 年份
 * @returns 是否为闰年
 */
export function isLeapYear(year: number): boolean {
    // 能被4整除但不能被100整除，或者能被400整除的是闰年
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
}

/**
 * 获取指定年份的天数
 * @param year 年份
 * @returns 年份天数 (365或366)
 */
export function getDaysInYear(year: number): number {
    return isLeapYear(year) ? 366 : 365
}

/**
 * 在日期上添加指定天数
 * @param date 日期
 * @param days 天数，可以为负数
 * @returns 新日期
 */
export function addDays(date: string | Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
}

/**
 * 在日期上添加指定月数
 * @param date 日期
 * @param months 月数，可以为负数
 * @returns 新日期
 */
export function addMonths(date: string | Date, months: number): Date {
    const result = new Date(date)
    result.setMonth(result.getMonth() + months)
    return result
}

/**
 * 在日期上添加指定年数
 * @param date 日期
 * @param years 年数，可以为负数
 * @returns 新日期
 */
export function addYears(date: string | Date, years: number): Date {
    const result = new Date(date)
    result.setFullYear(result.getFullYear() + years)
    return result
}

/**
 * 判断日期是否为周末（周六或周日）
 * @param date 日期
 * @returns 是否为周末
 */
export function isWeekend(date: string | Date): boolean {
    const d = new Date(date)
    const day = d.getDay()
    return day === 0 || day === 6 // 0是周日，6是周六
}

/**
 * 计算两个日期之间的工作日天数（不包括周六日）
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @returns 工作日天数
 */
export function getWorkingDays(startDate: string | Date, endDate: string | Date): number {
    let start = new Date(startDate)
    let end = new Date(endDate)

    // 确保开始日期不晚于结束日期
    if (start > end) {
        [start, end] = [end, start]
    }

    // 重置时间部分，只保留日期
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)

    let workingDays = 0
    const current = new Date(start)

    while (current <= end) {
        // 如果不是周末，工作日+1
        if (!isWeekend(current)) {
            workingDays++
        }

        // 前进一天
        current.setDate(current.getDate() + 1)
    }

    return workingDays
}

/**
 * 获取当前日期的字符串表示
 * @returns 当前日期，格式为YYYY-MM-DD
 */
export function getCurrentDate(): string {
    return formatDate(new Date())
}

/**
 * 获取指定日期的月份第一天
 * @param date 日期
 * @returns 月份第一天
 */
export function getFirstDayOfMonth(date: string | Date): Date {
    const d = new Date(date)
    d.setDate(1)
    return d
}

/**
 * 获取指定日期的月份最后一天
 * @param date 日期
 * @returns 月份最后一天
 */
export function getLastDayOfMonth(date: string | Date): Date {
    const d = new Date(date)
    d.setMonth(d.getMonth() + 1)
    d.setDate(0)
    return d
}

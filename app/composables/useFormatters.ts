/**
 * 通用格式化工具 Composable
 * 提供日期、金额等格式化方法，避免在各组件中重复定义
 */
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

// 配置 dayjs
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export const useFormatters = () => {
    /**
     * 格式化日期（标准格式）
     * @param dateString 日期字符串
     * @param format 可选的格式字符串，默认为 'YYYY-MM-DD HH:mm'
     * @returns 格式化后的日期字符串
     */
    const formatDate = (dateString: string | null | undefined, format?: string): string => {
        if (!dateString) return '—'
        const date = dayjs(dateString)
        if (!date.isValid()) return '—'
        return date.format(format ?? 'YYYY-MM-DD HH:mm')
    }

    /**
     * 格式化日期（仅日期，简短格式）
     * @param dateString 日期字符串
     * @returns 格式化后的日期字符串，格式：YY/MM/DD
     */
    const formatDateOnly = (dateString: string | null | undefined): string => {
        if (!dateString) return '—'
        const date = dayjs(dateString)
        if (!date.isValid()) return '—'
        return date.format('YY/MM/DD')
    }

    /**
     * 格式化日期（中文格式）
     * @param dateString 日期字符串
     * @returns 格式化后的日期字符串，格式：YYYY年MM月DD日 HH:mm
     */
    const formatDateChinese = (dateString: string | null | undefined): string => {
        if (!dateString) return '—'
        const date = dayjs(dateString)
        if (!date.isValid()) return '—'
        return date.format('YYYY年MM月DD日 HH:mm')
    }

    /**
     * 格式化日期（相对时间）
     * @param dateString 日期字符串
     * @returns 相对时间描述（今天、昨天、X天前）或标准日期格式
     */
    const formatDateRelative = (dateString: string | null | undefined): string => {
        if (!dateString) return '—'
        const date = dayjs(dateString)
        if (!date.isValid()) return '—'

        const now = dayjs()
        const diffDays = now.diff(date, 'day')

        if (diffDays === 0) return '今天'
        if (diffDays === 1) return '昨天'
        if (diffDays < 7) return `${diffDays} 天前`

        return date.format('YYYY-MM-DD')
    }

    /**
     * 格式化金额
     * @param amount 金额数字
     * @returns 格式化后的金额字符串，带两位小数
     */
    const formatAmount = (amount: number | null | undefined): string => {
        if (amount === null || amount === undefined || isNaN(amount)) return '0.00'
        return amount.toFixed(2)
    }

    /**
     * 格式化数字（千分位分隔符）
     * @param value 数字
     * @returns 格式化后的数字字符串，如 1,234.56
     */
    const formatNumber = (value: number | null | undefined): string => {
        if (value === null || value === undefined || isNaN(value)) return '0'
        return new Intl.NumberFormat('zh-CN').format(value)
    }

    return {
        formatDate,
        formatDateOnly,
        formatDateChinese,
        formatDateRelative,
        formatAmount,
        formatNumber,
    }
}

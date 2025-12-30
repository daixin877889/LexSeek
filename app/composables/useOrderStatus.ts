/**
 * 订单状态处理 Composable
 * 提供订单状态文本、样式和时长格式化方法
 */
import { OrderStatus, DurationUnit } from '#shared/types/payment'

export const useOrderStatus = () => {
    /**
     * 获取订单状态文本
     * @param status 订单状态枚举值
     * @returns 状态的中文文本
     */
    const getStatusText = (status: OrderStatus): string => {
        const statusMap: Record<OrderStatus, string> = {
            [OrderStatus.PENDING]: '待支付',
            [OrderStatus.PAID]: '已支付',
            [OrderStatus.CANCELLED]: '已取消',
            [OrderStatus.REFUNDED]: '已退款',
        }
        return statusMap[status] || '未知'
    }

    /**
     * 获取订单状态样式类
     * @param status 订单状态枚举值
     * @returns 对应的 CSS 类名
     */
    const getStatusClass = (status: OrderStatus): string => {
        const classMap: Record<OrderStatus, string> = {
            [OrderStatus.PENDING]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
            [OrderStatus.PAID]: 'bg-green-100 text-green-800 border-green-200',
            [OrderStatus.CANCELLED]: 'bg-gray-100 text-gray-800 border-gray-200',
            [OrderStatus.REFUNDED]: 'bg-blue-100 text-blue-800 border-blue-200',
        }
        return classMap[status] || ''
    }

    /**
     * 格式化时长
     * @param duration 时长数值
     * @param unit 时长单位
     * @returns 格式化后的中文描述
     */
    const formatDuration = (duration: number, unit: DurationUnit): string => {
        if (unit === DurationUnit.MONTH) {
            return `${duration} 个月`
        } else if (unit === DurationUnit.YEAR) {
            return `${duration} 年`
        }
        return `${duration}`
    }

    return {
        getStatusText,
        getStatusClass,
        formatDuration,
    }
}

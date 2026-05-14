import type { DepositRate } from '#shared/types/tools'

/**
 * 人民银行存款基准利率默认快照（与 prisma/seeds/seedData.sql 保持同步）
 *
 * - 测试基线兜底：测试代码不调 setDepositRates 时使用该默认值
 * - 服务端启动 plugin / 客户端 useToolsRates 加载到最新 DB 数据后会覆盖
 */
const DEFAULT_PBOC_DEPOSIT_RATES: readonly DepositRate[] = [
    { date: '2015-10-24', demand: 0.35, threeMonths: 1.10, sixMonths: 1.30, oneYear: 1.50, twoYear: 2.10, threeYear: 2.75, fiveYear: 2.75 },
    { date: '2015-08-26', demand: 0.35, threeMonths: 1.35, sixMonths: 1.55, oneYear: 1.75, twoYear: 2.35, threeYear: 3.00, fiveYear: 3.00 },
    { date: '2015-06-28', demand: 0.35, threeMonths: 1.60, sixMonths: 1.80, oneYear: 2.00, twoYear: 2.60, threeYear: 3.25, fiveYear: 3.25 },
    { date: '2015-05-11', demand: 0.35, threeMonths: 1.85, sixMonths: 2.05, oneYear: 2.25, twoYear: 2.85, threeYear: 3.50, fiveYear: 3.50 },
    { date: '2015-03-01', demand: 0.35, threeMonths: 2.10, sixMonths: 2.30, oneYear: 2.50, twoYear: 3.10, threeYear: 3.75, fiveYear: 3.75 },
    { date: '2014-11-22', demand: 0.35, threeMonths: 2.35, sixMonths: 2.55, oneYear: 2.75, twoYear: 3.35, threeYear: 4.00, fiveYear: 4.00 },
    { date: '2012-07-06', demand: 0.35, threeMonths: 2.60, sixMonths: 2.80, oneYear: 3.00, twoYear: 3.75, threeYear: 4.25, fiveYear: 4.25 },
    { date: '2012-06-08', demand: 0.40, threeMonths: 2.85, sixMonths: 3.05, oneYear: 3.25, twoYear: 4.00, threeYear: 4.50, fiveYear: 4.50 },
    { date: '2011-07-07', demand: 0.50, threeMonths: 3.10, sixMonths: 3.30, oneYear: 3.50, twoYear: 4.40, threeYear: 4.90, fiveYear: 5.00 },
    { date: '2011-04-06', demand: 0.50, threeMonths: 2.85, sixMonths: 3.05, oneYear: 3.25, twoYear: 4.15, threeYear: 4.65, fiveYear: 4.75 },
]

let runtimeCache: readonly DepositRate[] = DEFAULT_PBOC_DEPOSIT_RATES

/** 获取当前缓存的存款基准利率历史（按 date desc 排序） */
export function getDepositRates(): readonly DepositRate[] {
    return runtimeCache
}

/**
 * 注入最新存款基准利率数据（覆盖默认快照）
 *
 * - 服务端：rates-cache plugin 启动时调用 / rates.service.ts 写库后调用
 * - 客户端：useToolsRates composable 首次访问工具页时调用
 */
export function setDepositRates(rates: readonly DepositRate[]): void {
    runtimeCache = [...rates].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
}

import type { LoanRate } from '#shared/types/tools'

/**
 * 人民银行贷款基准利率默认快照（与 prisma/seeds/seedData.sql 保持同步）
 *
 * - 测试基线兜底：测试代码不调 setLoanRates 时使用该默认值
 * - 服务端启动 plugin / 客户端 useToolsRates 加载到最新 DB 数据后会覆盖
 */
const DEFAULT_PBOC_LOAN_RATES: readonly LoanRate[] = [
    { date: '2015-10-24', sixMonths: 4.35, oneYear: 4.35, oneToFiveYear: 4.75, fiveYear: 4.90 },
    { date: '2015-08-26', sixMonths: 4.60, oneYear: 4.60, oneToFiveYear: 5.00, fiveYear: 5.15 },
    { date: '2015-06-28', sixMonths: 4.85, oneYear: 4.85, oneToFiveYear: 5.25, fiveYear: 5.40 },
    { date: '2015-05-11', sixMonths: 5.10, oneYear: 5.10, oneToFiveYear: 5.50, fiveYear: 5.65 },
    { date: '2015-03-01', sixMonths: 5.35, oneYear: 5.35, oneToFiveYear: 5.75, fiveYear: 5.90 },
    { date: '2014-11-22', sixMonths: 5.60, oneYear: 5.60, oneToFiveYear: 6.00, fiveYear: 6.15 },
    { date: '2012-07-06', sixMonths: 5.85, oneYear: 6.00, oneToFiveYear: 6.15, fiveYear: 6.40 },
    { date: '2012-06-08', sixMonths: 6.10, oneYear: 6.31, oneToFiveYear: 6.40, fiveYear: 6.65 },
    { date: '2011-07-07', sixMonths: 6.56, oneYear: 6.65, oneToFiveYear: 6.90, fiveYear: 7.05 },
    { date: '2011-04-06', sixMonths: 6.31, oneYear: 6.40, oneToFiveYear: 6.65, fiveYear: 6.80 },
]

let runtimeCache: readonly LoanRate[] = DEFAULT_PBOC_LOAN_RATES

/** 获取当前缓存的贷款基准利率历史（按 date desc 排序） */
export function getLoanRates(): readonly LoanRate[] {
    return runtimeCache
}

/**
 * 注入最新贷款基准利率数据（覆盖默认快照）
 *
 * - 服务端：rates-cache plugin 启动时调用 / rates.service.ts 写库后调用
 * - 客户端：useToolsRates composable 首次访问工具页时调用
 */
export function setLoanRates(rates: readonly LoanRate[]): void {
    runtimeCache = [...rates].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
}

import type { LPRRate } from '#shared/types/tools'

/**
 * LPR 利率默认快照（与 prisma/seeds/seedData.sql 保持同步）
 *
 * - 测试基线兜底：测试代码不调 setLPRRates 时使用该默认值
 * - 服务端启动 plugin / 客户端 useToolsRates 加载到最新 DB 数据后会覆盖
 */
const DEFAULT_LPR_RATES: readonly LPRRate[] = [
    { date: '2025-07-21', oneYear: 3.00, fiveYear: 3.50 },
    { date: '2025-06-20', oneYear: 3.00, fiveYear: 3.50 },
    { date: '2025-05-20', oneYear: 3.00, fiveYear: 3.50 },
    { date: '2025-04-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2025-03-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2025-02-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2025-01-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-12-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-11-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-10-21', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-09-20', oneYear: 3.35, fiveYear: 3.85 },
    { date: '2024-08-20', oneYear: 3.35, fiveYear: 3.85 },
    { date: '2024-07-22', oneYear: 3.35, fiveYear: 3.85 },
    { date: '2024-06-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-05-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-04-22', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-03-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-02-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-01-22', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-12-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-11-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-10-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-09-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-08-21', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-07-20', oneYear: 3.55, fiveYear: 4.20 },
    { date: '2023-06-20', oneYear: 3.55, fiveYear: 4.20 },
    { date: '2023-05-22', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-04-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-03-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-02-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-01-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-12-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-11-21', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-10-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-09-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-08-22', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-07-20', oneYear: 3.70, fiveYear: 4.45 },
    { date: '2022-06-20', oneYear: 3.70, fiveYear: 4.45 },
    { date: '2022-05-20', oneYear: 3.70, fiveYear: 4.45 },
    { date: '2022-04-20', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2022-03-21', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2022-02-21', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2022-01-20', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2021-12-20', oneYear: 3.80, fiveYear: 4.65 },
    { date: '2021-11-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-10-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-09-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-08-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-07-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-06-21', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-05-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-04-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-03-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-02-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-01-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-12-21', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-11-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-10-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-09-21', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-08-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-07-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-06-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-05-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-04-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-03-20', oneYear: 4.05, fiveYear: 4.75 },
    { date: '2020-02-20', oneYear: 4.05, fiveYear: 4.75 },
    { date: '2020-01-20', oneYear: 4.15, fiveYear: 4.80 },
    { date: '2019-12-20', oneYear: 4.15, fiveYear: 4.80 },
    { date: '2019-11-20', oneYear: 4.15, fiveYear: 4.80 },
    { date: '2019-10-21', oneYear: 4.20, fiveYear: 4.85 },
    { date: '2019-09-20', oneYear: 4.20, fiveYear: 4.85 },
    { date: '2019-08-20', oneYear: 4.25, fiveYear: 4.85 },
]

let runtimeCache: readonly LPRRate[] = DEFAULT_LPR_RATES

/** 获取当前缓存的 LPR 历史（按 date desc 排序） */
export function getLPRRates(): readonly LPRRate[] {
    return runtimeCache
}

/**
 * 注入最新 LPR 数据（覆盖默认快照）
 *
 * - 服务端：rates-cache plugin 启动时调用 / rates.service.ts 写库后调用
 * - 客户端：useToolsRates composable 首次访问工具页时调用
 */
export function setLPRRates(rates: readonly LPRRate[]): void {
    runtimeCache = [...rates].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
}

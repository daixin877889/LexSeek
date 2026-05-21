/**
 * 办案工具档位常量（法规硬编码）
 *
 * 来源：
 * - 诉讼费用交纳办法（国务院 481 号令）
 * - 各省/直辖市律师服务收费办法（默认采用通用版）
 * - 中国仲裁协会推荐标准
 */

/** 法院受理费档位（财产案件）— 见诉讼费用交纳办法 */
export const COURT_ACCEPTANCE_BRACKETS = [
    { upper: 10000,    base: 50,      rate: 0,      fixed: 50 },        // ≤1 万：50 元
    { upper: 100000,   base: 50,      rate: 0.025,  start: 10000 },     // 1-10 万：2.5%
    { upper: 200000,   base: 2300,    rate: 0.02,   start: 100000 },    // 10-20 万：2%
    { upper: 500000,   base: 4300,    rate: 0.015,  start: 200000 },    // 20-50 万：1.5%
    { upper: 1000000,  base: 8800,    rate: 0.01,   start: 500000 },    // 50-100 万：1%
    { upper: 2000000,  base: 13800,   rate: 0.009,  start: 1000000 },   // 100-200 万：0.9%
    { upper: 5000000,  base: 22800,   rate: 0.008,  start: 2000000 },   // 200-500 万：0.8%
    { upper: 10000000, base: 46800,   rate: 0.007,  start: 5000000 },   // 500-1000 万：0.7%
    { upper: 20000000, base: 81800,   rate: 0.006,  start: 10000000 },  // 1000-2000 万：0.6%
    { upper: Infinity, base: 141800,  rate: 0.005,  start: 20000000 },  // >2000 万：0.5%
] as const

/** 申请执行费档位 */
export const COURT_EXECUTION_BRACKETS = [
    { upper: 10000,    base: 50,      rate: 0,      fixed: 50 },
    { upper: 500000,   base: 50,      rate: 0.015,  start: 10000 },
    { upper: 5000000,  base: 7400,    rate: 0.01,   start: 500000 },
    { upper: 10000000, base: 52400,   rate: 0.005,  start: 5000000 },
    { upper: Infinity, base: 77400,   rate: 0.001,  start: 10000000 },
] as const

/**
 * 民事案件律师费档位（与 lawyerFeeService.ts:166-178 if/else 一一对应）
 *
 * 起点说明：upper=100000 那档 fixed=5000 是定额，后续档基数累加：
 *   500000 档 base = 5000 + 400000*0.04 = 21000
 *   1000000 档 base = 21000 + 500000*0.03 = 36000
 *   5000000 档 base = 36000 + 4000000*0.02 = 116000
 *   10000000 档 base = 116000 + 5000000*0.01 = 166000
 */
export const LAWYER_CIVIL_BRACKETS = [
    { upper: 100000,   rate: 0,     base: 5000,   start: 0,        fixed: 5000 },
    { upper: 500000,   rate: 0.04,  base: 5000,   start: 100000 },
    { upper: 1000000,  rate: 0.03,  base: 21000,  start: 500000 },
    { upper: 5000000,  rate: 0.02,  base: 36000,  start: 1000000 },
    { upper: 10000000, rate: 0.01,  base: 116000, start: 5000000 },
    { upper: Infinity, rate: 0.005, base: 166000, start: 10000000 },
] as const

/**
 * 商事法律服务费率配置（与 lawyerFeeService.ts:420-450 switch/case 一一对应）
 *
 * 每个配置项：baseFee 为基础费用（元），rate 为超出 threshold 后的附加比例，
 * threshold 为触发附加收费的金额下限（0 表示始终按比例计算）
 */
export const LAWYER_COMMERCIAL_BRACKETS = [
    { type: 'contract_review', baseFee: 5000,   rate: 0.003,  threshold: 1000000  },
    { type: 'negotiation',     baseFee: 8000,   rate: 0.005,  threshold: 1000000  },
    { type: 'due_diligence',   baseFee: 20000,  rate: 0.001,  threshold: 10000000 },
    { type: 'ipo_advisory',    baseFee: 100000, rate: 0.0005, threshold: 0        },
    { type: 'compliance',      baseFee: 15000,  rate: 0,      threshold: Infinity },
    { type: 'default',         baseFee: 8000,   rate: 0,      threshold: Infinity },
] as const

/**
 * 仲裁费档位（与 arbitrationFeeService.ts:45-65 if/else 一一对应）
 *
 * 基数累加说明：
 *   50000 档  base = 100 + 40000*0.005 = 300
 *   100000 档 base = 300 + 50000*0.004 = 500
 *   200000 档 base = 500 + 100000*0.003 = 800
 *   500000 档 base = 800 + 300000*0.002 = 1400
 *   1000000 档 base = 1400 + 500000*0.001 = 1900
 */
export const ARBITRATION_BRACKETS = [
    { upper: 10000,    base: 100,  rate: 0,      start: 0,        fixed: 100 },
    { upper: 50000,    base: 100,  rate: 0.005,  start: 10000 },
    { upper: 100000,   base: 300,  rate: 0.004,  start: 50000 },
    { upper: 200000,   base: 500,  rate: 0.003,  start: 100000 },
    { upper: 500000,   base: 800,  rate: 0.002,  start: 200000 },
    { upper: 1000000,  base: 1400, rate: 0.001,  start: 500000 },
    { upper: Infinity, base: 1900, rate: 0.0005, start: 1000000 },
] as const

/**
 * 社保缴费比例常量（法定默认比例）
 *
 * 来源：
 * - 《社会保险法》及各险种条例
 * - 全国通用比例（各地可在此基础上上下浮动）
 *
 * 结构说明：
 * - employee：个人缴纳比例
 * - employer：单位缴纳比例
 */

import type { SocialInsuranceRates } from '#shared/types/tools'

/** 五险一金默认缴费比例 */
export const DEFAULT_SOCIAL_INSURANCE_RATES: Required<SocialInsuranceRates> = {
    pension:      { employee: 0.08,  employer: 0.16  },   // 养老保险：个人 8%，单位 16%
    medical:      { employee: 0.02,  employer: 0.08  },   // 医疗保险：个人 2%，单位 8%
    unemployment: { employee: 0.005, employer: 0.015 },   // 失业保险：个人 0.5%，单位 1.5%
    injury:       { employee: 0,     employer: 0.005 },   // 工伤保险：个人 0%，单位 0.5%
    maternity:    { employee: 0,     employer: 0.01  },   // 生育保险：个人 0%，单位 1%
    housing:      { employee: 0.07,  employer: 0.07  },   // 住房公积金：个人 7%，单位 7%
}

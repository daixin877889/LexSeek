/**
 * 利息计算服务
 * 提供各种类型的利息计算功能
 */

import type {
    InterestRateData,
    PeriodInterestResult,
    CustomRateInterestResult,
    LPRInterestResult,
    PBOCInterestResult,
    SimpleInterestResult,
    CompoundInterestResult,
    LoanInterestResult,
    InterestDetail,
    AdjustmentMethod
} from '#shared/types/tools'
import { daysBetween, formatDate } from './utils/date'
import { logger } from '#shared/utils/logger'


// 利率数据 (从interest.sql导入的数据)
const interestRates: InterestRateData[] = [
    // LPR利率 (type=2)
    // 1年期LPR (period=1)
    { sTime: '2019-08-20', rate: 4.25, type: 2, period: 1 },
    { sTime: '2019-09-20', rate: 4.2, type: 2, period: 1 },
    { sTime: '2019-11-20', rate: 4.15, type: 2, period: 1 },
    { sTime: '2020-02-20', rate: 4.05, type: 2, period: 1 },
    { sTime: '2020-04-20', rate: 3.85, type: 2, period: 1 },
    { sTime: '2021-12-20', rate: 3.8, type: 2, period: 1 },
    { sTime: '2022-01-20', rate: 3.7, type: 2, period: 1 },
    { sTime: '2022-08-22', rate: 3.65, type: 2, period: 1 },
    { sTime: '2023-06-20', rate: 3.55, type: 2, period: 1 },
    { sTime: '2023-08-21', rate: 3.45, type: 2, period: 1 },
    { sTime: '2023-09-20', rate: 3.45, type: 2, period: 1 },
    { sTime: '2024-07-20', rate: 3.35, type: 2, period: 1 },
    { sTime: '2024-10-21', rate: 3.10, type: 2, period: 1 },
    { sTime: '2025-05-20', rate: 3.00, type: 2, period: 1 },
    { sTime: '2025-06-20', rate: 3.00, type: 2, period: 1 },
    { sTime: '2025-07-21', rate: 3.00, type: 2, period: 1 },
    // 5年期以上LPR (period=2)
    { sTime: '2019-08-20', rate: 4.85, type: 2, period: 2 },
    { sTime: '2019-11-20', rate: 4.8, type: 2, period: 2 },
    { sTime: '2020-02-20', rate: 4.75, type: 2, period: 2 },
    { sTime: '2020-04-20', rate: 4.65, type: 2, period: 2 },
    { sTime: '2022-01-20', rate: 4.6, type: 2, period: 2 },
    { sTime: '2022-05-20', rate: 4.45, type: 2, period: 2 },
    { sTime: '2022-08-22', rate: 4.3, type: 2, period: 2 },
    { sTime: '2023-06-20', rate: 4.2, type: 2, period: 2 },
    { sTime: '2023-08-21', rate: 4.2, type: 2, period: 2 },
    { sTime: '2024-02-20', rate: 3.95, type: 2, period: 2 },
    { sTime: '2024-07-22', rate: 3.85, type: 2, period: 2 },
    { sTime: '2024-10-21', rate: 3.60, type: 2, period: 2 },
    { sTime: '2025-05-20', rate: 3.50, type: 2, period: 2 },
    { sTime: '2025-06-20', rate: 3.50, type: 2, period: 2 },
    { sTime: '2025-07-21', rate: 3.50, type: 2, period: 2 },
    // 中国人民银行基准利率 (type=1)
    // 六个月以内 (period=1)
    { sTime: '1991-04-21', rate: 8.1, type: 1, period: 1 },
    { sTime: '1993-05-15', rate: 8.82, type: 1, period: 1 },
    { sTime: '1993-07-11', rate: 9.0, type: 1, period: 1 },
    { sTime: '1995-01-01', rate: 9.0, type: 1, period: 1 },
    { sTime: '1995-07-01', rate: 10.08, type: 1, period: 1 },
    { sTime: '1996-05-01', rate: 9.72, type: 1, period: 1 },
    { sTime: '1996-08-23', rate: 9.18, type: 1, period: 1 },
    { sTime: '1997-10-23', rate: 7.65, type: 1, period: 1 },
    { sTime: '1998-03-25', rate: 7.02, type: 1, period: 1 },
    { sTime: '1998-07-01', rate: 6.57, type: 1, period: 1 },
    { sTime: '1998-12-07', rate: 6.12, type: 1, period: 1 },
    { sTime: '1999-06-10', rate: 5.58, type: 1, period: 1 },
    { sTime: '2002-02-21', rate: 5.04, type: 1, period: 1 },
    { sTime: '2004-10-29', rate: 5.22, type: 1, period: 1 },
    { sTime: '2006-04-28', rate: 5.4, type: 1, period: 1 },
    { sTime: '2006-08-19', rate: 5.58, type: 1, period: 1 },
    { sTime: '2007-03-18', rate: 5.67, type: 1, period: 1 },
    { sTime: '2007-05-19', rate: 5.85, type: 1, period: 1 },
    { sTime: '2007-07-21', rate: 6.03, type: 1, period: 1 },
    { sTime: '2007-08-22', rate: 6.21, type: 1, period: 1 },
    { sTime: '2007-09-15', rate: 6.48, type: 1, period: 1 },
    { sTime: '2007-12-21', rate: 6.57, type: 1, period: 1 },
    { sTime: '2008-09-16', rate: 6.21, type: 1, period: 1 },
    { sTime: '2008-10-09', rate: 6.12, type: 1, period: 1 },
    { sTime: '2008-10-30', rate: 6.03, type: 1, period: 1 },
    { sTime: '2008-11-27', rate: 5.04, type: 1, period: 1 },
    { sTime: '2008-12-23', rate: 4.86, type: 1, period: 1 },
    { sTime: '2010-10-20', rate: 5.1, type: 1, period: 1 },
    { sTime: '2010-12-26', rate: 5.35, type: 1, period: 1 },
    { sTime: '2011-02-09', rate: 5.6, type: 1, period: 1 },
    { sTime: '2011-04-06', rate: 5.85, type: 1, period: 1 },
    { sTime: '2011-07-07', rate: 6.1, type: 1, period: 1 },
    { sTime: '2012-06-08', rate: 5.85, type: 1, period: 1 },
    { sTime: '2012-07-06', rate: 5.6, type: 1, period: 1 },
    { sTime: '2014-11-22', rate: 5.6, type: 1, period: 1 },
    { sTime: '2015-03-01', rate: 5.35, type: 1, period: 1 },
    { sTime: '2015-05-11', rate: 5.1, type: 1, period: 1 },
    { sTime: '2015-06-28', rate: 4.85, type: 1, period: 1 },
    { sTime: '2015-08-26', rate: 4.6, type: 1, period: 1 },
    { sTime: '2015-10-24', rate: 4.35, type: 1, period: 1 },

    // 六个月至一年 (period=2)
    { sTime: '1991-04-21', rate: 8.64, type: 1, period: 2 },
    { sTime: '1993-05-15', rate: 9.36, type: 1, period: 2 },
    { sTime: '1993-07-11', rate: 10.98, type: 1, period: 2 },
    { sTime: '1995-01-01', rate: 10.98, type: 1, period: 2 },
    { sTime: '1995-07-01', rate: 12.06, type: 1, period: 2 },
    { sTime: '1996-05-01', rate: 10.98, type: 1, period: 2 },
    { sTime: '1996-08-23', rate: 10.08, type: 1, period: 2 },
    { sTime: '1997-10-23', rate: 8.64, type: 1, period: 2 },
    { sTime: '1998-03-25', rate: 7.92, type: 1, period: 2 },
    { sTime: '1998-07-01', rate: 6.93, type: 1, period: 2 },
    { sTime: '1998-12-07', rate: 6.39, type: 1, period: 2 },
    { sTime: '1999-06-10', rate: 5.85, type: 1, period: 2 },
    { sTime: '2002-02-21', rate: 5.31, type: 1, period: 2 },
    { sTime: '2004-10-29', rate: 5.58, type: 1, period: 2 },
    { sTime: '2006-04-28', rate: 5.85, type: 1, period: 2 },
    { sTime: '2006-08-19', rate: 6.12, type: 1, period: 2 },
    { sTime: '2007-03-18', rate: 6.39, type: 1, period: 2 },
    { sTime: '2007-05-19', rate: 6.57, type: 1, period: 2 },
    { sTime: '2007-07-21', rate: 6.84, type: 1, period: 2 },
    { sTime: '2007-08-22', rate: 7.02, type: 1, period: 2 },
    { sTime: '2007-09-15', rate: 7.29, type: 1, period: 2 },
    { sTime: '2007-12-21', rate: 7.47, type: 1, period: 2 },
    { sTime: '2008-09-16', rate: 7.2, type: 1, period: 2 },
    { sTime: '2008-10-09', rate: 6.93, type: 1, period: 2 },
    { sTime: '2008-10-30', rate: 6.66, type: 1, period: 2 },
    { sTime: '2008-11-27', rate: 5.58, type: 1, period: 2 },
    { sTime: '2008-12-23', rate: 5.31, type: 1, period: 2 },
    { sTime: '2010-10-20', rate: 5.56, type: 1, period: 2 },
    { sTime: '2010-12-26', rate: 5.81, type: 1, period: 2 },
    { sTime: '2011-02-09', rate: 6.06, type: 1, period: 2 },
    { sTime: '2011-04-06', rate: 6.31, type: 1, period: 2 },
    { sTime: '2011-07-07', rate: 6.56, type: 1, period: 2 },
    { sTime: '2012-06-08', rate: 6.31, type: 1, period: 2 },
    { sTime: '2012-07-06', rate: 6.0, type: 1, period: 2 },
    { sTime: '2014-11-22', rate: 5.6, type: 1, period: 2 },
    { sTime: '2015-03-01', rate: 5.35, type: 1, period: 2 },
    { sTime: '2015-05-11', rate: 5.1, type: 1, period: 2 },
    { sTime: '2015-06-28', rate: 4.85, type: 1, period: 2 },
    { sTime: '2015-08-26', rate: 4.6, type: 1, period: 2 },
    { sTime: '2015-10-24', rate: 4.35, type: 1, period: 2 },

    // 一至三年 (period=3)
    { sTime: '1991-04-21', rate: 9.0, type: 1, period: 3 },
    { sTime: '1993-05-15', rate: 10.8, type: 1, period: 3 },
    { sTime: '1993-07-11', rate: 12.24, type: 1, period: 3 },
    { sTime: '1995-01-01', rate: 12.96, type: 1, period: 3 },
    { sTime: '1995-07-01', rate: 13.5, type: 1, period: 3 },
    { sTime: '1996-05-01', rate: 13.14, type: 1, period: 3 },
    { sTime: '1996-08-23', rate: 10.98, type: 1, period: 3 },
    { sTime: '1997-10-23', rate: 9.36, type: 1, period: 3 },
    { sTime: '1998-03-25', rate: 9.0, type: 1, period: 3 },
    { sTime: '1998-07-01', rate: 7.11, type: 1, period: 3 },
    { sTime: '1998-12-07', rate: 6.66, type: 1, period: 3 },
    { sTime: '1999-06-10', rate: 5.94, type: 1, period: 3 },
    { sTime: '2002-02-21', rate: 5.49, type: 1, period: 3 },
    { sTime: '2004-10-29', rate: 5.76, type: 1, period: 3 },
    { sTime: '2006-04-28', rate: 6.03, type: 1, period: 3 },
    { sTime: '2006-08-19', rate: 6.3, type: 1, period: 3 },
    { sTime: '2007-03-18', rate: 6.57, type: 1, period: 3 },
    { sTime: '2007-05-19', rate: 6.75, type: 1, period: 3 },
    { sTime: '2007-07-21', rate: 7.02, type: 1, period: 3 },
    { sTime: '2007-08-22', rate: 7.2, type: 1, period: 3 },
    { sTime: '2007-09-15', rate: 7.47, type: 1, period: 3 },
    { sTime: '2007-12-21', rate: 7.56, type: 1, period: 3 },
    { sTime: '2008-09-16', rate: 7.29, type: 1, period: 3 },
    { sTime: '2008-10-09', rate: 7.02, type: 1, period: 3 },
    { sTime: '2008-10-30', rate: 6.75, type: 1, period: 3 },
    { sTime: '2008-11-27', rate: 5.67, type: 1, period: 3 },
    { sTime: '2008-12-23', rate: 5.4, type: 1, period: 3 },
    { sTime: '2010-10-20', rate: 5.6, type: 1, period: 3 },
    { sTime: '2010-12-26', rate: 5.85, type: 1, period: 3 },
    { sTime: '2011-02-09', rate: 6.1, type: 1, period: 3 },
    { sTime: '2011-04-06', rate: 6.4, type: 1, period: 3 },
    { sTime: '2011-07-07', rate: 6.65, type: 1, period: 3 },
    { sTime: '2012-06-08', rate: 6.4, type: 1, period: 3 },
    { sTime: '2012-07-06', rate: 6.15, type: 1, period: 3 },
    { sTime: '2014-11-22', rate: 6.0, type: 1, period: 3 },
    { sTime: '2015-03-01', rate: 5.75, type: 1, period: 3 },
    { sTime: '2015-05-11', rate: 5.5, type: 1, period: 3 },
    { sTime: '2015-06-28', rate: 5.25, type: 1, period: 3 },
    { sTime: '2015-08-26', rate: 5.0, type: 1, period: 3 },
    { sTime: '2015-10-24', rate: 4.75, type: 1, period: 3 },

    // 三至五年 (period=4)
    { sTime: '1991-04-21', rate: 9.54, type: 1, period: 4 },
    { sTime: '1993-05-15', rate: 12.06, type: 1, period: 4 },
    { sTime: '1993-07-11', rate: 13.86, type: 1, period: 4 },
    { sTime: '1995-01-01', rate: 14.58, type: 1, period: 4 },
    { sTime: '1995-07-01', rate: 15.12, type: 1, period: 4 },
    { sTime: '1996-05-01', rate: 14.94, type: 1, period: 4 },
    { sTime: '1996-08-23', rate: 11.7, type: 1, period: 4 },
    { sTime: '1997-10-23', rate: 9.9, type: 1, period: 4 },
    { sTime: '1998-03-25', rate: 9.72, type: 1, period: 4 },
    { sTime: '1998-07-01', rate: 7.65, type: 1, period: 4 },
    { sTime: '1998-12-07', rate: 7.2, type: 1, period: 4 },
    { sTime: '1999-06-10', rate: 6.03, type: 1, period: 4 },
    { sTime: '2002-02-21', rate: 5.58, type: 1, period: 4 },
    { sTime: '2004-10-29', rate: 5.85, type: 1, period: 4 },
    { sTime: '2006-04-28', rate: 6.12, type: 1, period: 4 },
    { sTime: '2006-08-19', rate: 6.48, type: 1, period: 4 },
    { sTime: '2007-03-18', rate: 6.75, type: 1, period: 4 },
    { sTime: '2007-05-19', rate: 6.93, type: 1, period: 4 },
    { sTime: '2007-07-21', rate: 7.2, type: 1, period: 4 },
    { sTime: '2007-08-22', rate: 7.38, type: 1, period: 4 },
    { sTime: '2007-09-15', rate: 7.65, type: 1, period: 4 },
    { sTime: '2007-12-21', rate: 7.74, type: 1, period: 4 },
    { sTime: '2008-09-16', rate: 7.56, type: 1, period: 4 },
    { sTime: '2008-10-09', rate: 7.29, type: 1, period: 4 },
    { sTime: '2008-10-30', rate: 7.02, type: 1, period: 4 },
    { sTime: '2008-11-27', rate: 5.94, type: 1, period: 4 },
    { sTime: '2008-12-23', rate: 5.76, type: 1, period: 4 },
    { sTime: '2010-10-20', rate: 5.96, type: 1, period: 4 },
    { sTime: '2010-12-26', rate: 6.22, type: 1, period: 4 },
    { sTime: '2011-02-09', rate: 6.45, type: 1, period: 4 },
    { sTime: '2011-04-06', rate: 6.65, type: 1, period: 4 },
    { sTime: '2011-07-07', rate: 6.9, type: 1, period: 4 },
    { sTime: '2012-06-08', rate: 6.65, type: 1, period: 4 },
    { sTime: '2012-07-06', rate: 6.4, type: 1, period: 4 },
    { sTime: '2014-11-22', rate: 6.0, type: 1, period: 4 },
    { sTime: '2015-03-01', rate: 5.75, type: 1, period: 4 },
    { sTime: '2015-05-11', rate: 5.5, type: 1, period: 4 },
    { sTime: '2015-06-28', rate: 5.25, type: 1, period: 4 },
    { sTime: '2015-08-26', rate: 5.0, type: 1, period: 4 },
    { sTime: '2015-10-24', rate: 4.75, type: 1, period: 4 },

    // 五年以上 (period=5)
    { sTime: '1991-04-21', rate: 9.72, type: 1, period: 5 },
    { sTime: '1993-05-15', rate: 12.24, type: 1, period: 5 },
    { sTime: '1993-07-11', rate: 14.04, type: 1, period: 5 },
    { sTime: '1995-01-01', rate: 14.76, type: 1, period: 5 },
    { sTime: '1995-07-01', rate: 15.3, type: 1, period: 5 },
    { sTime: '1996-05-01', rate: 15.12, type: 1, period: 5 },
    { sTime: '1996-08-23', rate: 12.42, type: 1, period: 5 },
    { sTime: '1997-10-23', rate: 10.53, type: 1, period: 5 },
    { sTime: '1998-03-25', rate: 10.35, type: 1, period: 5 },
    { sTime: '1998-07-01', rate: 8.01, type: 1, period: 5 },
    { sTime: '1998-12-07', rate: 7.56, type: 1, period: 5 },
    { sTime: '1999-06-10', rate: 6.21, type: 1, period: 5 },
    { sTime: '2002-02-21', rate: 5.76, type: 1, period: 5 },
    { sTime: '2004-10-29', rate: 6.12, type: 1, period: 5 },
    { sTime: '2006-04-28', rate: 6.39, type: 1, period: 5 },
    { sTime: '2006-08-19', rate: 6.84, type: 1, period: 5 },
    { sTime: '2007-03-18', rate: 7.11, type: 1, period: 5 },
    { sTime: '2007-05-19', rate: 7.2, type: 1, period: 5 },
    { sTime: '2007-07-21', rate: 7.38, type: 1, period: 5 },
    { sTime: '2007-08-22', rate: 7.56, type: 1, period: 5 },
    { sTime: '2007-09-15', rate: 7.83, type: 1, period: 5 },
    { sTime: '2007-12-21', rate: 7.83, type: 1, period: 5 },
    { sTime: '2008-09-16', rate: 7.74, type: 1, period: 5 },
    { sTime: '2008-10-09', rate: 7.47, type: 1, period: 5 },
    { sTime: '2008-10-30', rate: 7.2, type: 1, period: 5 },
    { sTime: '2008-11-27', rate: 6.12, type: 1, period: 5 },
    { sTime: '2008-12-23', rate: 5.94, type: 1, period: 5 },
    { sTime: '2010-10-20', rate: 6.14, type: 1, period: 5 },
    { sTime: '2010-12-26', rate: 6.4, type: 1, period: 5 },
    { sTime: '2011-02-09', rate: 6.6, type: 1, period: 5 },
    { sTime: '2011-04-06', rate: 6.8, type: 1, period: 5 },
    { sTime: '2011-07-07', rate: 7.05, type: 1, period: 5 },
    { sTime: '2012-06-08', rate: 6.8, type: 1, period: 5 },
    { sTime: '2012-07-06', rate: 6.55, type: 1, period: 5 },
    { sTime: '2014-11-22', rate: 6.15, type: 1, period: 5 },
    { sTime: '2015-03-01', rate: 5.9, type: 1, period: 5 },
    { sTime: '2015-05-11', rate: 5.65, type: 1, period: 5 },
    { sTime: '2015-06-28', rate: 5.4, type: 1, period: 5 },
    { sTime: '2015-08-26', rate: 5.15, type: 1, period: 5 },
    { sTime: '2015-10-24', rate: 4.9, type: 1, period: 5 }
]

/**
 * 获取利率数据
 * @param type 类型（1：基准利率，2：LPR）
 * @param period 期限
 * @returns 利率数据
 */
export function getInterestRates(type: number | string, period: number | string): InterestRateData[] {
    // 确保将type和period转换为数字类型
    const numType = Number(type)
    const numPeriod = Number(period)

    return interestRates.filter(rate => rate.type === numType && rate.period === numPeriod)
        .sort((a, b) => new Date(a.sTime).getTime() - new Date(b.sTime).getTime())
}

/**
 * 获取适用于指定日期的利率
 * @param type 类型（1：基准利率，2：LPR）
 * @param period 期限
 * @param date 日期
 * @returns 利率
 */
export function getRateForDate(type: number | string, period: number | string, date: string): number {
    const targetDate = new Date(date)
    let applicableRate = 0

    // 按日期排序获取所有该类型的利率
    // type和period会通过getInterestRates函数自动转为数字
    const sortedRates = getInterestRates(type, period)

    if (sortedRates.length === 0) {
        return 0 // 没有找到任何利率数据
    }

    // 如果目标日期早于第一个利率日期，使用第一个利率
    const firstRate = sortedRates[0]
    if (!firstRate) return 0
    const firstRateDate = new Date(firstRate.sTime)
    if (targetDate < firstRateDate) {
        return firstRate.rate
    }

    // 找到最后一个早于或等于目标日期的利率
    for (let i = 0; i < sortedRates.length; i++) {
        const rate = sortedRates[i]
        if (!rate) continue
        const rateDate = new Date(rate.sTime)
        if (rateDate <= targetDate) {
            applicableRate = rate.rate
        } else {
            break
        }
    }

    // 如果没有找到适用的利率（可能是未来日期），使用最新的利率
    if (applicableRate === 0 && sortedRates.length > 0) {
        const lastRate = sortedRates[sortedRates.length - 1]
        if (lastRate) {
            applicableRate = lastRate.rate
        }
    }

    return applicableRate
}


/**
 * 计算自定义利率利息
 * @param principal 本金
 * @param customRate 自定义年利率(%)
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @param yearDays 年计息天数，默认365
 * @returns 计算结果对象
 */
export function calculateCustomRateInterest(
    principal: number | string,
    customRate: number | string,
    startDate: string,
    endDate: string,
    yearDays: number = 365
): CustomRateInterestResult {
    logger.debug('【自定义利率】计算开始', { principal, customRate, startDate, endDate, yearDays })

    // 参数验证与转换
    const principalNum = parseFloat(String(principal))
    const rateNum = parseFloat(String(customRate))

    if (isNaN(principalNum) || principalNum <= 0) {
        logger.error('本金必须为正数')
        return { error: '本金必须为正数' } as CustomRateInterestResult
    }

    if (isNaN(rateNum) || rateNum < 0) {
        logger.error('利率必须为非负数')
        return { error: '利率必须为非负数' } as CustomRateInterestResult
    }

    if (!startDate || !endDate) {
        logger.error('开始日期和结束日期不能为空')
        return { error: '开始日期和结束日期不能为空' } as CustomRateInterestResult
    }

    // 计算天数
    const days = daysBetween(startDate, endDate)
    if (days <= 0) {
        logger.error('结束日期必须晚于开始日期')
        return { error: '结束日期必须晚于开始日期' } as CustomRateInterestResult
    }

    // 年计息天数验证
    const yearDaysNum = parseInt(String(yearDays)) || 365
    if (yearDaysNum !== 365 && yearDaysNum !== 366) {
        logger.warn('非标准年计息天数:', yearDaysNum, '将使用默认值365')
    }

    // 计算利息 (本金 * 年利率% / 100 * 天数 / 年天数)
    // 避免中间计算过程中的舍入误差，直到最后一步才进行四舍五入
    const annualRate = rateNum / 100
    const interestExact = principalNum * annualRate * days / yearDaysNum
    // 最后再四舍五入到分
    const interest = Math.round(interestExact * 100) / 100

    // 总额 = 本金 + 利息
    const totalAmount = Math.round((principalNum + interest) * 100) / 100

    // 计算过程描述
    const process = `本金 ${principalNum.toFixed(2)} 元 × 年利率 ${rateNum.toFixed(4)}% ÷ 100 × ${days} 天 ÷ ${yearDaysNum} 天 = 利息 ${interest.toFixed(2)} 元`

    logger.debug('【自定义利率】计算结果', {
        principal: principalNum,
        rate: rateNum,
        days,
        yearDays: yearDaysNum,
        interest,
        totalAmount,
        process
    })

    return {
        amount: principalNum,
        customRate: rateNum,
        days,
        totalInterest: interest,
        total: principalNum + interest,
        yearDays: yearDaysNum,
        startDate,
        endDate,
        process,
        details: [
            `自定义利率计算：`,
            `- 本金：${principalNum.toFixed(2)}元`,
            `- 年利率：${rateNum.toFixed(4)}%`,
            `- 计息天数：${days}天`,
            `- 年计息天数：${yearDaysNum}天`,
            `- 计算公式：本金 × 年利率 ÷ 100 × 天数 ÷ 年天数`,
            `- 计算过程：${principalNum.toFixed(2)} × ${rateNum.toFixed(4)}% ÷ 100 × ${days} ÷ ${yearDaysNum} = ${interest.toFixed(2)}`,
            `- 利息金额：${interest.toFixed(2)}元`,
            `- 本息合计：${totalAmount.toFixed(2)}元`
        ],
        interestDetails: [
            {
                startDate: startDate,
                endDate: endDate,
                days: days,
                rate: rateNum,
                interest: interest
            }
        ]
    }
}


/**
 * 计算指定期间内的利息
 * @param principal 本金
 * @param rate 利率 (%)
 * @param days 天数
 * @param yearDays 年计息天数 (默认365)
 * @param adjustmentMethod 调整方式 ('无', '上浮', '下浮', '倍率', '加点', '减点')
 * @param adjustmentValue 调整值
 * @returns 利息计算结果
 */
export function calculatePeriodInterest(
    principal: number | string,
    rate: number | string,
    days: number | string,
    yearDays: number | string = 365,
    adjustmentMethod: AdjustmentMethod = '无',
    adjustmentValue: number | string = 0
): PeriodInterestResult {
    logger.debug('计算期间利息', { principal, rate, days, yearDays, adjustmentMethod, adjustmentValue })

    // 参数验证与转换
    const principalNum = parseFloat(String(principal))
    const rateNum = parseFloat(String(rate))
    const adjustmentValueNum = parseFloat(String(adjustmentValue || 0))

    // 处理日期参数 - 如果传入的是日期字符串而不是天数，计算天数
    let daysNum = typeof days === 'number' ? days : parseInt(String(days)) || 0
    let yearDaysNum = typeof yearDays === 'number' ? yearDays : parseInt(String(yearDays)) || 365

    if (typeof days === 'string' && days.includes('-')) {
        const startDate = days
        if (typeof yearDays === 'string' && yearDays.includes('-')) {
            const endDate = yearDays
            daysNum = daysBetween(startDate, endDate)
            yearDaysNum = 365 // 重置为默认值
        } else {
            logger.error('期间利息计算: 无效的日期参数组合')
            daysNum = parseInt(String(days)) || 0
        }
    }

    if (isNaN(principalNum) || principalNum <= 0) {
        logger.error('本金必须为正数')
        return {
            principal: principalNum,
            rate: rateNum,
            days: daysNum,
            yearDays: yearDaysNum,
            interest: 0,
            adjustedRate: rateNum,
            process: '计算错误: 本金必须为正数'
        }
    }

    if (isNaN(rateNum) || isNaN(daysNum)) {
        logger.error('利率或天数无效')
        return {
            principal: principalNum,
            rate: rateNum,
            days: daysNum,
            yearDays: yearDaysNum,
            interest: 0,
            adjustedRate: rateNum,
            process: '计算错误: 利率或天数无效'
        }
    }

    if (daysNum <= 0) {
        logger.warn('天数必须为正数')
        return {
            principal: principalNum,
            rate: rateNum,
            days: daysNum,
            yearDays: yearDaysNum,
            interest: 0,
            adjustedRate: rateNum,
            process: '计算错误: 天数必须为正数'
        }
    }

    // 根据调整方式计算调整后的利率
    let adjustedRate = rateNum

    logger.debug('利率调整前:', {
        当前利率: rateNum,
        调整方式: adjustmentMethod,
        调整值: adjustmentValueNum
    })

    if (adjustmentMethod === '加点') {
        // 基点调整，1个基点 = 0.01%
        adjustedRate = rateNum + (adjustmentValueNum * 0.01)
    } else if (adjustmentMethod === '减点') {
        // 基点调整，1个基点 = 0.01%
        adjustedRate = rateNum - (adjustmentValueNum * 0.01)
    } else if (adjustmentMethod === '倍数' || adjustmentMethod === '倍率') {
        adjustedRate = rateNum * adjustmentValueNum
    } else if (adjustmentMethod === '上浮') {
        adjustedRate = rateNum * (1 + adjustmentValueNum / 100)
    } else if (adjustmentMethod === '下浮') {
        adjustedRate = rateNum * (1 - adjustmentValueNum / 100)
    }

    logger.debug('利率调整后:', {
        调整前利率: rateNum,
        调整后利率: adjustedRate,
        调整方式: adjustmentMethod
    })

    // 计算利息 (本金 * 年利率% / 100 * 天数 / 年天数)
    const annualRate = Number((adjustedRate / 100).toFixed(10))
    const interest = Math.round(principalNum * annualRate * daysNum / yearDaysNum * 100) / 100

    logger.debug('期间利息计算结果', {
        principal: principalNum,
        rate: rateNum,
        adjustedRate: adjustedRate,
        days: daysNum,
        yearDays: yearDaysNum,
        interest,
        process: `${principalNum.toFixed(2)} × ${adjustedRate.toFixed(4)}% ÷ 100 × ${daysNum} ÷ ${yearDaysNum} = ${interest.toFixed(2)}`
    })

    return {
        principal: principalNum,
        rate: rateNum,
        days: daysNum,
        yearDays: yearDaysNum,
        interest: interest,
        adjustedRate: adjustedRate,
        process: `${principalNum.toFixed(2)} × ${adjustedRate.toFixed(4)}% ÷ 100 × ${daysNum} ÷ ${yearDaysNum} = ${interest.toFixed(2)}`
    }
}


/**
 * 根据LPR利率计算利息
 * @param principal 本金
 * @param startDateParam 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @param lprPeriod LPR期限类型：1=1年期，2=5年期以上
 * @param adjustmentMethod 调整方式: '加点'|'减点'|'倍数'
 * @param adjustmentValue 调整值
 * @param yearDays 年计天数: 360或365
 * @returns 计算结果
 */
export function calculateLPRInterest(
    principal: number | string,
    startDateParam: string,
    endDate: string,
    lprPeriod: number | string,
    adjustmentMethod: AdjustmentMethod,
    adjustmentValue: number | string,
    yearDays: number | string = 360
): LPRInterestResult {
    // 参数转换为数字
    const principalNum = parseFloat(String(principal))
    const lprPeriodNum = parseInt(String(lprPeriod))
    const adjustmentValueNum = parseFloat(String(adjustmentValue || 0))
    const yearDaysNum = parseInt(String(yearDays))

    // 保存原始开始日期
    const startDateOriginal = startDateParam
    // 创建可修改的开始日期副本
    let startDate = startDateParam

    // 添加参数调试日志
    logger.debug('LPR计算入参:', {
        principal: principalNum,
        startDate,
        endDate,
        lprPeriod: lprPeriodNum,
        adjustmentMethod,
        adjustmentValue: adjustmentValueNum,
        yearDays: yearDaysNum
    })

    // 检查日期顺序
    let start = new Date(startDate)
    const end = new Date(endDate)

    if (start > end) {
        logger.error('日期顺序错误: 开始日期晚于结束日期', { startDate, endDate })
        return {
            amount: principalNum,
            startDate,
            endDate,
            totalInterest: 0,
            days: 0,
            total: principalNum,
            details: ['日期错误：开始日期不能晚于结束日期'],
            interestDetails: []
        }
    }

    // 检查日期是否在LPR政策实施日期之后
    const lprStartDate = '2019-08-20' // LPR政策开始日期
    if (new Date(startDate) < new Date(lprStartDate)) {
        // 将开始日期调整为LPR政策开始日期
        logger.debug(`开始日期(${startDate})早于LPR政策实施日期(${lprStartDate})，已自动调整为从LPR政策开始日期计算`)
        startDate = lprStartDate
        // 重新计算开始日期
        start = new Date(startDate)
    }

    // 获取相应期限的所有LPR利率
    let rates = getInterestRates(2, lprPeriodNum)

    if (!rates || rates.length === 0) {
        logger.error('未找到LPR利率数据, lprPeriod=', lprPeriodNum)
        return {
            error: "NO_LPR_RATES",
            message: "未找到LPR利率数据"
        } as LPRInterestResult
    }

    // 确保按日期排序
    rates = [...rates].sort((a, b) => new Date(a.sTime).getTime() - new Date(b.sTime).getTime())
    logger.debug('获取到LPR利率数据:', rates)

    const daysCount = daysBetween(startDate, endDate)

    const interestDetails: InterestDetail[] = []
    let totalInterest = 0

    // 找出计算周期内每个适用的利率变动期间
    let currentDate = new Date(startDate)
    let currentRateIndex = 0

    // 找出开始日期适用的利率
    while (currentRateIndex < rates.length - 1) {
        const nextRate = rates[currentRateIndex + 1]
        if (nextRate && new Date(nextRate.sTime) <= start) {
            currentRateIndex++
        } else {
            break
        }
    }

    // 如果没有找到适用的利率（可能是因为开始日期早于第一个利率发布日期）
    if (currentRateIndex < 0) {
        logger.error('没有找到适用的LPR利率, currentRateIndex=', currentRateIndex)
        return {
            error: "NO_APPLICABLE_RATE",
            message: "没有找到适用的LPR利率"
        } as LPRInterestResult
    }

    let segmentStart = new Date(startDate)

    while (segmentStart < end) {
        let segmentEnd: Date
        const currentRateData = rates[currentRateIndex]
        if (!currentRateData) break
        const currentRate = currentRateData.rate // 先获取当前索引的利率

        // 如果有下一个利率变动点，且该点在结束日期之前
        const nextRateData = rates[currentRateIndex + 1]
        if (currentRateIndex < rates.length - 1 && nextRateData &&
            new Date(nextRateData.sTime) <= end) {
            segmentEnd = new Date(nextRateData.sTime)
            currentRateIndex++ // 递增索引放在获取利率之后
        } else {
            segmentEnd = new Date(endDate)
        }

        // 根据调整方式计算调整后的利率
        let adjustedRate = currentRate

        logger.debug('利率调整前:', {
            当前利率: currentRate,
            调整方式: adjustmentMethod,
            调整值: adjustmentValueNum
        })

        if (adjustmentMethod === '加点') {
            // 基点调整，1个基点 = 0.01%
            adjustedRate = currentRate + (adjustmentValueNum * 0.01)
        } else if (adjustmentMethod === '减点') {
            // 基点调整，1个基点 = 0.01%
            adjustedRate = currentRate - (adjustmentValueNum * 0.01)
        } else if (adjustmentMethod === '倍数' || adjustmentMethod === '倍率') {
            adjustedRate = currentRate * adjustmentValueNum
        } else if (adjustmentMethod === '上浮') {
            adjustedRate = currentRate * (1 + adjustmentValueNum / 100)
        } else if (adjustmentMethod === '下浮') {
            adjustedRate = currentRate * (1 - adjustmentValueNum / 100)
        }

        logger.debug('利率调整后:', {
            调整前利率: currentRate,
            调整后利率: adjustedRate,
            调整方式: adjustmentMethod
        })

        // 计算该段时间的利息
        const segmentDays = daysBetween(formatDate(segmentStart), formatDate(segmentEnd))

        // 使用高精度计算
        const segmentInterest = principalNum * adjustedRate / 100 * segmentDays / yearDaysNum
        // 四舍五入保留两位小数
        const roundedSegmentInterest = Math.round(segmentInterest * 100) / 100

        logger.debug('分段利息计算:', {
            segmentStart: formatDate(segmentStart),
            segmentEnd: formatDate(segmentEnd),
            segmentDays,
            adjustedRate,
            segmentInterest,
            roundedSegmentInterest,
            计算式: `${principalNum.toFixed(2)} × ${adjustedRate.toFixed(4)}% × ${segmentDays} ÷ ${yearDaysNum} = ${roundedSegmentInterest.toFixed(2)}`
        })

        interestDetails.push({
            startDate: formatDate(segmentStart),
            endDate: formatDate(segmentEnd),
            days: segmentDays,
            rate: currentRate,
            adjustedRate: adjustedRate,
            interest: roundedSegmentInterest
        })

        totalInterest += roundedSegmentInterest
        segmentStart = segmentEnd
    }

    // 判断是否使用了估计利率（即结束日期超过了最新利率）
    const latestRate = rates[rates.length - 1]
    const latestRateDate = latestRate ? new Date(latestRate.sTime) : new Date()
    const usedEstimatedRate = end > latestRateDate

    // 判断是否调整了开始日期
    const dateAdjusted = startDate !== startDateOriginal

    // 四舍五入总利息，保留两位小数
    totalInterest = Math.round(totalInterest * 100) / 100

    logger.debug('LPR计算结果:', {
        totalInterest,
        daysCount,
        interestDetails
    })

    // 准备结果
    return {
        amount: principalNum,
        startDate: startDate,
        endDate: endDate,
        totalInterest: totalInterest,
        total: principalNum + totalInterest,
        days: daysCount,
        interestDetails: interestDetails,
        details: [
            `本金：${principalNum.toFixed(2)}元`,
            `计息开始日期：${startDate}${dateAdjusted ? `（注：原始日期${startDateOriginal}早于LPR政策实施日期2019-08-20，仅计算2019-08-20之后的利息）` : ''}`,
            `计息结束日期：${endDate}`,
            `计息天数：${daysCount}天`,
            `利率类型：${lprPeriodNum === 1 ? 'LPR 1年期' : 'LPR 5年期以上'}`,
            adjustmentMethod !== '无' ? `利率调整方式：${adjustmentMethod} ${adjustmentValueNum}${adjustmentMethod === '加点' || adjustmentMethod === '减点' ? 'BP' : (adjustmentMethod === '倍数' || adjustmentMethod === '倍率' ? '倍' : (adjustmentMethod === '上浮' || adjustmentMethod === '下浮' ? '%' : '%'))}` : '无利率调整',
            usedEstimatedRate ? `注意：您选择的结束日期(${endDate})晚于最新LPR公布日期(${formatDate(latestRateDate)})，此期间使用了最新的LPR利率作为估计值。` : '',
            `总利息：${totalInterest.toFixed(2)}元`,
            `本息合计：${(principalNum + totalInterest).toFixed(2)}元`
        ].filter(item => item !== '')
    }
}


/**
 * 计算基于人民银行基准利率的利息
 * @param amount 本金
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param period 期限（1-5）
 * @param adjustmentMethod 调整方式（'无'，'上浮'，'下浮'，'倍率'）
 * @param adjustmentValue 调整值
 * @param yearDays 一年天数（360或365）
 * @returns 利息计算结果
 */
export function calculatePBOCInterest(
    amount: number | string,
    startDate: string,
    endDate: string,
    period: number | string = 2,
    adjustmentMethod: AdjustmentMethod = '无',
    adjustmentValue: number | string = 0,
    yearDays: number | string = 365
): PBOCInterestResult {
    // 参数转换为数字
    const amountNum = parseFloat(String(amount))
    const periodNum = parseInt(String(period))
    const adjustmentValueNum = parseFloat(String(adjustmentValue || 0))
    const yearDaysNum = parseInt(String(yearDays))

    // 添加参数调试日志
    logger.debug('PBOC计算入参:', {
        amount: amountNum,
        startDate,
        endDate,
        period: periodNum,
        adjustmentMethod,
        adjustmentValue: adjustmentValueNum,
        yearDays: yearDaysNum
    })

    const start = new Date(startDate)
    const end = new Date(endDate)

    // 检查日期顺序
    if (start > end) {
        logger.error('日期顺序错误: 开始日期晚于结束日期', { startDate, endDate })
        return {
            amount: amountNum,
            totalInterest: 0,
            days: 0,
            total: amountNum,
            details: ['日期错误：开始日期不能晚于结束日期']
        }
    }

    // 获取所有该类型的利率并按日期排序
    const allPbocRates = getInterestRates(1, periodNum).sort((a, b) => new Date(a.sTime).getTime() - new Date(b.sTime).getTime())

    // 如果没有任何基准利率数据，返回错误信息
    if (allPbocRates.length === 0) {
        logger.error('没有找到适用的基准利率数据, period=', periodNum)
        return {
            amount: amountNum,
            totalInterest: 0,
            days: daysBetween(startDate, endDate),
            total: amountNum,
            details: ['没有找到适用的基准利率数据']
        }
    }

    logger.debug('获取到基准利率数据:', allPbocRates)

    // 获取涵盖整个计息期间的所有基准利率变动
    const pbocRates = allPbocRates.filter(rate => {
        const rateDate = new Date(rate.sTime)
        return rateDate <= end
    })

    // 如果结束日期大于最新的基准利率日期，添加最后一个利率作为延伸
    const lastRate = allPbocRates[allPbocRates.length - 1]
    if (lastRate) {
        const lastRateDate = new Date(lastRate.sTime)
        if (end > lastRateDate && !pbocRates.includes(lastRate)) {
            pbocRates.push(lastRate)
        }
    }

    logger.debug('筛选后基准利率数据:', pbocRates)

    let totalInterest = 0
    const interestDetails: InterestDetail[] = []

    // 如果筛选后没有适用的基准利率，使用最早的基准利率计算整个期间
    if (pbocRates.length === 0) {
        const earliestRate = allPbocRates[0]
        if (!earliestRate) {
            return {
                amount: amountNum,
                totalInterest: 0,
                days: daysBetween(startDate, endDate),
                total: amountNum,
                details: ['没有找到适用的基准利率数据']
            }
        }
        const periodDays = daysBetween(startDate, endDate)

        // 直接计算天数而不是传递日期字符串，并传递调整方式和值
        const periodResult = calculatePeriodInterest(
            amountNum,
            earliestRate.rate,
            periodDays,
            yearDaysNum,
            adjustmentMethod,
            adjustmentValueNum
        )

        totalInterest = periodResult.interest
        interestDetails.push({
            startDate: startDate,
            endDate: endDate,
            rate: earliestRate.rate,
            adjustedRate: periodResult.adjustedRate || earliestRate.rate,
            days: periodResult.days,
            interest: periodResult.interest
        })
    } else {
        // 遍历每个基准利率变动，计算该利率适用期间的利息
        for (let i = 0; i < pbocRates.length; i++) {
            const currentRate = pbocRates[i]
            if (!currentRate) continue
            const nextRate: InterestRateData | null = (i < pbocRates.length - 1) ? (pbocRates[i + 1] ?? null) : null

            const periodStart = new Date(Math.max(start.getTime(), new Date(currentRate.sTime).getTime()))
            const periodEnd = nextRate
                ? new Date(Math.min(end.getTime(), new Date(nextRate.sTime).getTime() - 1))
                : end

            // 如果计息期间在该利率区间内
            if (periodStart <= periodEnd) {
                const startDateStr = periodStart.toISOString().split('T')[0] ?? ''
                const endDateStr = periodEnd.toISOString().split('T')[0] ?? ''
                const periodDays = daysBetween(startDateStr, endDateStr)

                // 计算利息时传递调整方式和值
                const periodResult = calculatePeriodInterest(
                    amountNum,
                    currentRate.rate,
                    periodDays,
                    yearDaysNum,
                    adjustmentMethod,
                    adjustmentValueNum
                )

                totalInterest += periodResult.interest
                interestDetails.push({
                    startDate: startDateStr,
                    endDate: endDateStr,
                    rate: currentRate.rate,
                    adjustedRate: periodResult.adjustedRate || currentRate.rate,
                    days: periodDays,
                    interest: periodResult.interest
                })
            }
        }
    }

    // 四舍五入总利息，保留两位小数
    totalInterest = Math.round(totalInterest * 100) / 100

    // 如果计算结果为0，可能是日期问题，给出更明确的提示
    if (totalInterest === 0 && interestDetails.length === 0) {
        return {
            amount: amountNum,
            totalInterest: 0,
            days: daysBetween(startDate, endDate),
            total: amountNum,
            details: ['计算期间没有适用的基准利率，请检查日期设置']
        }
    }

    // 获取期限的文字描述
    let periodText = ''
    switch (Number(periodNum)) {
        case 1: periodText = '六个月以内'; break
        case 2: periodText = '六个月至一年'; break
        case 3: periodText = '一至三年'; break
        case 4: periodText = '三至五年'; break
        case 5: periodText = '五年以上'; break
        default: periodText = `未知期限(${periodNum})`
    }

    return {
        amount: amountNum,
        startDate,
        endDate,
        totalInterest,
        total: amountNum + totalInterest,
        interestDetails,
        days: daysBetween(startDate, endDate),
        details: [
            `本金：${amountNum.toFixed(2)}元`,
            `计息开始日期：${startDate}`,
            `计息结束日期：${endDate}`,
            `基准利率期限：${periodText}`,
            `调整方式：${adjustmentMethod}${adjustmentMethod !== '无' ? ` ${adjustmentValueNum}${adjustmentMethod === '加点' || adjustmentMethod === '减点' ? 'BP' : (adjustmentMethod === '倍率' || adjustmentMethod === '倍数' ? '倍' : (adjustmentMethod === '上浮' || adjustmentMethod === '下浮' ? '%' : '%'))}` : ''}`,
            ...interestDetails.map(detail => {
                // 安全地使用 toFixed，确保 adjustedRate 存在
                const rateDisplay = detail.adjustedRate !== undefined ? detail.adjustedRate.toFixed(4) : detail.rate.toFixed(4)
                const interestDisplay = detail.interest !== undefined ? detail.interest.toFixed(2) : '0.00'
                return `${detail.startDate}至${detail.endDate}（${detail.days}天）：利率${rateDisplay}%，利息${interestDisplay}元`
            }),
            `总利息：${totalInterest.toFixed(2)}元`,
            `本息合计：${(amountNum + totalInterest).toFixed(2)}元`
        ]
    }
}


/**
 * 计算单利
 * @param principal 本金
 * @param rate 年利率（%）
 * @param startDate 开始日期am endDate 结束日期
 * @returns 利息计算结果
 */
export function calculateSimpleInterest(
    principal: number,
    rate: number,
    startDate: string,
    endDate: string
): SimpleInterestResult {
    // 计算天数
    const days = daysBetween(startDate, endDate)

    // 计算利息 (本金 * 年利率 / 365 * 天数)
    const interest = principal * (rate / 100) * (days / 365)

    // 计算本息合计
    const total = principal + interest

    return {
        principal,
        rate,
        days,
        interest,
        total,
        details: [
            `本金：${principal}元`,
            `年利率：${rate}%`,
            `计息天数：${days}天`,
            `计算方式：单利`,
            `计算公式：${principal}元 × ${rate}% × (${days}天 ÷ 365天) = ${interest.toFixed(2)}元`
        ]
    }
}

/**
 * 计算复利
 * @param principal 本金
 * @param rate 年利率（%）
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @returns 利息计算结果
 */
export function calculateCompoundInterest(
    principal: number,
    rate: number,
    startDate: string,
    endDate: string
): CompoundInterestResult {
    // 计算天数
    const days = daysBetween(startDate, endDate)

    // 计算年数（包括小数部分）
    const years = days / 365

    // 计算复利 (本金 * (1 + 年利率)^年数 - 本金)
    const total = principal * Math.pow(1 + rate / 100, years)
    const interest = total - principal

    return {
        principal,
        rate,
        days,
        interest,
        total,
        details: [
            `本金：${principal}元`,
            `年利率：${rate}%`,
            `计息天数：${days}天`,
            `计算方式：复利`,
            `计算公式：${principal}元 × (1 + ${rate}%)^(${days}天 ÷ 365天) - ${principal}元 = ${interest.toFixed(2)}元`
        ]
    }
}

/**
 * 计算贷款利息
 * @param principal 贷款金额
 * @param rate 年利率（%）
 * @param months 贷款期限（月）
 * @param method 还款方式（'equal'等额本息，'principal'等额本金）
 * @returns 贷款利息计算结果
 */
export function calculateLoanInterest(
    principal: number,
    rate: number,
    months: number,
    method: 'equal' | 'principal' = 'equal'
): LoanInterestResult {
    // 月利率
    const monthlyRate = rate / 100 / 12

    if (method === 'equal') {
        // 等额本息
        // 月供 = 本金 × 月利率 × (1+月利率)^贷款月数 / [(1+月利率)^贷款月数 - 1]
        const monthlyPayment = principal * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1)

        // 总还款额
        const totalPayment = monthlyPayment * months

        // 总利息
        const totalInterest = totalPayment - principal

        return {
            principal,
            rate,
            months,
            monthlyPayment,
            totalPayment,
            totalInterest,
            details: [
                `贷款金额：${principal}元`,
                `年利率：${rate}%`,
                `贷款期限：${months}个月`,
                `还款方式：等额本息`,
                `月供：${monthlyPayment.toFixed(2)}元`,
                `总还款额：${totalPayment.toFixed(2)}元`,
                `总利息：${totalInterest.toFixed(2)}元`
            ]
        }
    } else {
        // 等额本金
        // 每月本金 = 本金 / 贷款月数
        const monthlyPrincipal = principal / months

        // 计算每月还款额和利息
        let totalInterest = 0
        const monthlyPayments: number[] = []

        for (let i = 0; i < months; i++) {
            // 剩余本金
            const remainingPrincipal = principal - monthlyPrincipal * i

            // 月利息
            const monthlyInterest = remainingPrincipal * monthlyRate

            // 月供 = 每月本金 + 月利息
            const payment = monthlyPrincipal + monthlyInterest

            totalInterest += monthlyInterest
            monthlyPayments.push(payment)
        }

        // 总还款额
        const totalPayment = principal + totalInterest

        return {
            principal,
            rate,
            months,
            monthlyPrincipal,
            firstMonthPayment: monthlyPayments[0] ?? 0,
            lastMonthPayment: monthlyPayments[monthlyPayments.length - 1] ?? 0,
            totalPayment,
            totalInterest,
            details: [
                `贷款金额：${principal}元`,
                `年利率：${rate}%`,
                `贷款期限：${months}个月`,
                `还款方式：等额本金`,
                `每月本金：${monthlyPrincipal.toFixed(2)}元`,
                `首月还款额：${(monthlyPayments[0] ?? 0).toFixed(2)}元`,
                `末月还款额：${(monthlyPayments[monthlyPayments.length - 1] ?? 0).toFixed(2)}元`,
                `总还款额：${totalPayment.toFixed(2)}元`,
                `总利息：${totalInterest.toFixed(2)}元`
            ]
        }
    }
}
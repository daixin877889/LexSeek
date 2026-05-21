/**
 * algorithms 层统一出口
 *
 * 四个纯函数算法，供各 service 按需导入：
 *   - applyBrackets          阶梯累进公式（诉讼费 / 律师费 / 仲裁费）
 *   - calculateSegmentedInterest  分段利息计算
 *   - findRateForDate        按日期查利率
 *   - roundToCents           四舍五入到分
 */

export { applyBrackets } from './applyBrackets'
export type { Bracket } from './applyBrackets'

export { calculateSegmentedInterest } from './calculateSegmentedInterest'
export type { SegmentInput, InterestSegment } from './calculateSegmentedInterest'

export { findRateForDate } from './findRateForDate'

export { roundToCents } from './roundToCents'

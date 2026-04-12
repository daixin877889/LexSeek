/**
 * 查询归一化模块
 *
 * 将用户输入的法条查询统一为标准化格式，
 * 并尝试正则前置匹配精确法条引用。
 */
import Nzh from 'nzh'
import type { IntentClassification } from './types'

/** 中文数字模式：匹配"第X条"和"第X款"中的中文数字 */
const CHINESE_NUM_PATTERN = /第([零〇一二两三四五六七八九十百千万]+)(条|款)/g

/** Unicode 控制字符（零宽空格、方向标记等） */
const UNICODE_CONTROL_CHARS = /[\u200B-\u200F\u2028-\u202F\uFEFF]/g

/** 冗余前缀 */
const REDUNDANT_PREFIX = '中华人民共和国'

/** 精确法条引用正则 */
const EXACT_REGEX = /^(?<legalName>.+?)第(?<articleNum>\d+)条(第(?<clauseNum>\d+)款)?$/

/**
 * 将中文数字替换为阿拉伯数字（仅作用于"第X条"和"第X款"模式）
 *
 * 转换失败时（NaN 或 <=0）保留原文
 */
function replaceChinese(match: string, numStr: string, suffix: string): string {
  const num = Nzh.cn.decodeS(numStr)
  if (Number.isNaN(num) || num <= 0) {
    return match
  }
  return `第${num}${suffix}`
}

/**
 * 全角字符转半角（0xFF01-0xFF5E 范围）
 */
function fullWidthToHalfWidth(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code >= 0xFF01 && code <= 0xFF5E) {
      result += String.fromCharCode(code - 0xFEE0)
    }
    else {
      result += str[i]
    }
  }
  return result
}

/**
 * 查询归一化：5 步管线
 *
 * 1. 去空白：trim + 合并连续空格
 * 2. 去 Unicode 控制字符
 * 3. 去冗余前缀："中华人民共和国"
 * 4. 中文数字转阿拉伯：仅"第X条"和"第X款"
 * 5. 全角转半角
 */
export function normalizeQuery(query: string): string {
  if (!query) return ''

  // 步骤 1：去空白
  let result = query.trim().replace(/\s+/g, ' ')

  // 步骤 2：去 Unicode 控制字符
  result = result.replace(UNICODE_CONTROL_CHARS, '')

  // 步骤 3：去冗余前缀
  result = result.replace(REDUNDANT_PREFIX, '')

  // 步骤 4：中文数字转阿拉伯（仅条/款模式）
  result = result.replace(CHINESE_NUM_PATTERN, replaceChinese)

  // 步骤 5：全角转半角
  result = fullWidthToHalfWidth(result)

  return result
}

/**
 * 正则前置：尝试匹配精确法条引用
 *
 * 匹配格式：{法律名称}第{数字}条(第{数字}款)?
 * - legalName 需 trim 且长度 >= 2
 * - articleRef 只保留到"条"（丢弃"款"），用 Nzh.cn.encodeS 转回中文数字
 * - 返回 IntentClassification 或 null
 */
export function tryExactRegex(normalizedQuery: string): IntentClassification | null {
  const trimmed = normalizedQuery.trim().replace(/\s+/g, '')
  const match = EXACT_REGEX.exec(trimmed)
  if (!match?.groups) return null

  const legalName = match.groups.legalName.trim()
  if (legalName.length < 2) return null

  const articleNum = Number.parseInt(match.groups.articleNum, 10)
  if (Number.isNaN(articleNum) || articleNum <= 0) return null

  // 用 nzh 将阿拉伯数字转回标准中文数字格式（与 DB l5 字段一致）
  const chineseNum = Nzh.cn.encodeS(articleNum)
  const articleRef = `第${chineseNum}条`

  return { intent: 'exact', legalName, articleRef }
}

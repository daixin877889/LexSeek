/**
 * PII 脱敏纯函数
 *
 * 顺序应用（避免误伤）：
 *   1. 身份证（带 GB 11643 校验码验证）→ ***IDCARD***
 *   2. 银行卡（16-19 位独立数字）→ ***BANKCARD***
 *   3. 手机号（1[3-9]\d{9} 独立词）→ ***PHONE***
 *   4. 邮箱 → ***EMAIL***
 *
 * 手机号核心正则 1[3-9]\d{9} 与 shared/utils/phone.ts 的 validatePhone 一致。
 *
 * v5 SDK 的 LangfuseSpanProcessor.mask 钩子接收 stringified JSON 字符串，
 * 整段 string 上跑 4 类正则即可脱敏嵌套字段内的 PII 子串（引号也是 word boundary）。
 */

// 国标 GB 11643-1999 18 位身份证校验
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

function isValidIdCard(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += Number.parseInt(id[i]!, 10) * ID_WEIGHTS[i]!
  }
  const expected = ID_CHECK_CODES[sum % 11]
  return id[17]!.toUpperCase() === expected
}

const ID_CARD_PATTERN
  = /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[012])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g
const BANKCARD_PATTERN = /(?<!\d)\d{16,19}(?!\d)/g
const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function redactPII(text: string): string {
  return text
    .replace(ID_CARD_PATTERN, m => (isValidIdCard(m) ? '***IDCARD***' : m))
    .replace(BANKCARD_PATTERN, '***BANKCARD***')
    .replace(PHONE_PATTERN, '***PHONE***')
    .replace(EMAIL_PATTERN, '***EMAIL***')
}

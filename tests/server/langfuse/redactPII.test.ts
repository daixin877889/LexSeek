import { describe, it, expect } from 'vitest'
import { redactPII } from '~~/server/lib/langfuse/redactPII'

describe('redactPII', () => {
  it.each([
    // 身份证：有效校验码 → 脱敏
    ['身份证 110101199003078515', '身份证 ***IDCARD***'],
    // 身份证：无效校验码 → 跳过 IDCARD 但落入 BANKCARD 范围（18 位）→ 过度脱敏（设计接受）
    ['编号 110101199003078500', '编号 ***BANKCARD***'],
    // 金额数字串不应被当成任何 PII（6 位 < 16 位 BANKCARD 下界）
    ['金额 110000 元', '金额 110000 元'],
    // 手机号：独立词（任意非数字分隔符）
    ['电话 13800138000', '电话 ***PHONE***'],
    ['Tel:13800138000', 'Tel:***PHONE***'],
    // 手机号被数字粘连成 17 位 → 落入 BANKCARD 范围 → 过度脱敏（设计接受：宁可错杀）
    ['合同编号 13800138000111222', '合同编号 ***BANKCARD***'],
    // 邮箱
    ['请发邮箱 abc@def.com 收件', '请发邮箱 ***EMAIL*** 收件'],
    // 银行卡：16-19 位独立数字串
    ['卡号 6225881234567890', '卡号 ***BANKCARD***'],
    ['卡号 6225881234567890123', '卡号 ***BANKCARD***'],
    // 银行卡：被数字粘连不应触发
    ['条款编号 622588123456789012345', '条款编号 622588123456789012345'],
    // 多种 PII 混合
    [
      '客户王某身份证 110101199003078515 手机 13800138000 邮箱 a@b.com',
      '客户王某身份证 ***IDCARD*** 手机 ***PHONE*** 邮箱 ***EMAIL***',
    ],
  ])('redactPII(%j) → %j', (input, expected) => {
    expect(redactPII(input)).toBe(expected)
  })

  it('stringified JSON 中嵌套字段的 PII 子串也被替换（mask 钩子真实场景）', () => {
    const json = JSON.stringify([
      { role: 'user', content: '我的身份证号是 110101199003078515' },
      { role: 'assistant', content: '电话 13800138000' },
    ])
    const masked = redactPII(json)
    const parsed = JSON.parse(masked)
    expect(parsed[0].content).toBe('我的身份证号是 ***IDCARD***')
    expect(parsed[1].content).toBe('电话 ***PHONE***')
  })
})

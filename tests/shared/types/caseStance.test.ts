import { describe, it, expect } from 'vitest'
import { CaseStance, CaseStanceText } from '#shared/types/case'

describe('CaseStance enum', () => {
  it('枚举值必须与 Prisma @default("plaintiff") 等 DB 字符串值完全一致', () => {
    expect(CaseStance.PLAINTIFF).toBe('plaintiff')
    expect(CaseStance.DEFENDANT).toBe('defendant')
    expect(CaseStance.NEUTRAL).toBe('neutral')
  })

  it('CaseStanceText 字典必须覆盖三种立场', () => {
    expect(CaseStanceText[CaseStance.PLAINTIFF]).toBe('原告')
    expect(CaseStanceText[CaseStance.DEFENDANT]).toBe('被告')
    expect(CaseStanceText[CaseStance.NEUTRAL]).toBe('中立')
  })
})

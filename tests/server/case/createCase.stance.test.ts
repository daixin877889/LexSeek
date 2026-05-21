/**
 * 创建案件 - 立场字段测试
 *
 * **Feature: 2026-05-14-case-features / Task A4**
 *
 * 验证 createCaseService 透传 stance 字段：
 * - 默认 plaintiff
 * - 显式 defendant / neutral 入库正确
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createCaseService } from '~~/server/services/case/case.service'
import { prisma } from '~~/server/utils/db'
import { CaseStance } from '#shared/types/case'

let userId: number
let caseTypeId: number

beforeAll(async () => {
  // 使用 Date.now() 后缀避免与同 worker 其他测试串行污染
  const phone = `199${Date.now().toString().slice(-8)}`
  const user = await prisma.users.create({
    data: { phone, name: 'stance-test', status: 1 },
  })
  userId = user.id
  let ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  if (!ct) {
    ct = await prisma.caseTypes.create({
      data: {
        name: `测试类型_${Date.now()}`,
        description: '立场测试',
        status: 1,
      },
    })
  }
  caseTypeId = ct.id
})

describe('createCaseService - stance', () => {
  it('默认 stance = plaintiff', async () => {
    const r = await createCaseService({
      title: '默认立场案件',
      content: '某甲诉某乙',
      userId,
      caseTypeId,
    })
    expect(r.case.stance).toBe(CaseStance.PLAINTIFF)
  })

  it('显式传 stance=defendant 入库正确', async () => {
    const r = await createCaseService({
      title: '被告立场案件',
      content: '某丙诉某丁',
      userId,
      caseTypeId,
      stance: CaseStance.DEFENDANT,
    })
    expect(r.case.stance).toBe(CaseStance.DEFENDANT)
  })

  it('显式传 stance=neutral 入库正确', async () => {
    const r = await createCaseService({
      title: '中立立场案件',
      content: '案情中立',
      userId,
      caseTypeId,
      stance: CaseStance.NEUTRAL,
    })
    expect(r.case.stance).toBe(CaseStance.NEUTRAL)
  })
})

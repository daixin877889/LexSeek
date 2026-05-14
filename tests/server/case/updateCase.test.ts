/**
 * 更新案件信息 - 全字段支持测试
 *
 * **Feature: 2026-05-14-case-features / Task B1**
 *
 * 验证 updateCaseService 接受 title / content / status / 一二审案号法官 /
 * stance / plaintiff / defendant 全字段并真实落库。
 *
 * 当前 PUT /api/v1/cases/[caseId] 实际为 NO-OP（M2 重构时把写库逻辑注释了），
 * 本测试用于确认 service 层重写后能持久化。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { updateCaseService } from '~~/server/services/case/case.service'
import { prisma } from '~~/server/utils/db'
import { CaseStance } from '#shared/types/case'

let userId: number
let caseId: number
let caseTypeId: number

beforeAll(async () => {
  let ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  if (!ct) {
    ct = await prisma.caseTypes.create({
      data: { name: `update-test-${Date.now()}`, status: 1 },
    })
  }
  caseTypeId = ct.id
  const phone = `199${Date.now().toString().slice(-8)}`
  const u = await prisma.users.create({
    data: { phone, name: 'upd-test', status: 1 },
  })
  userId = u.id
  const c = await prisma.cases.create({
    data: { title: '旧标题', userId, caseTypeId, stance: CaseStance.PLAINTIFF },
  })
  caseId = c.id
})

afterAll(async () => {
  await prisma.cases.deleteMany({ where: { id: caseId } })
  await prisma.users.deleteMany({ where: { id: userId } })
})

describe('updateCaseService - 全字段', () => {
  it('支持更新 title / courtName / 一二审案号法官 / status / stance / content', async () => {
    await updateCaseService(caseId, {
      title: '新标题',
      content: '新描述',
      status: 3,
      courtName: '北京朝阳法院',
      firstInstanceCaseNo: '(2024)京0105民初1号',
      firstInstanceJudge: '王法官',
      secondInstanceCaseNo: '(2024)京03民终99号',
      secondInstanceJudge: '李法官',
      stance: CaseStance.DEFENDANT,
    })
    const c = await prisma.cases.findUnique({ where: { id: caseId } })
    expect(c?.title).toBe('新标题')
    expect(c?.content).toBe('新描述')
    expect(c?.status).toBe(3)
    expect(c?.courtName).toBe('北京朝阳法院')
    expect(c?.firstInstanceCaseNo).toBe('(2024)京0105民初1号')
    expect(c?.secondInstanceJudge).toBe('李法官')
    expect(c?.stance).toBe(CaseStance.DEFENDANT)
  })

  it('支持更新 plaintiff / defendant 数组', async () => {
    await updateCaseService(caseId, {
      plaintiff: ['原告甲', '原告乙'] as any,
      defendant: ['被告丙'] as any,
    })
    const c = await prisma.cases.findUnique({ where: { id: caseId } })
    expect(c?.plaintiff).toEqual(['原告甲', '原告乙'])
    expect(c?.defendant).toEqual(['被告丙'])
  })
})

/**
 * moduleContextBuilder - 立场（stance）字段透传测试
 *
 * **Feature: 2026-05-14-case-features / Task A5**
 *
 * 验证：
 * 1. caseProfile JSON 含 stance 字段（字典序插入位置，cache 命中字节级稳定）
 * 2. roleAndFlow 段尾追加立场使用说明（含 stance 关键词 + 原告/被告对照）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'
import { prisma } from '~~/server/utils/db'
import { CaseStance } from '#shared/types/case'

let userId: number
let caseId: number
let caseTypeId: number

beforeAll(async () => {
  // 取/造 caseType
  let ct = await prisma.caseTypes.findFirst({ where: { status: 1 } })
  if (!ct) {
    ct = await prisma.caseTypes.create({
      data: { name: `mcb-stance-${Date.now()}`, status: 1 },
    })
  }
  caseTypeId = ct.id
  // 造 user（phone unique，加时间戳后缀）
  const phone = `199${Date.now().toString().slice(-8)}`
  const u = await prisma.users.create({
    data: { phone, name: 'mcb-stance', status: 1 },
  })
  userId = u.id
  // 造立场=defendant 的案件
  const c = await prisma.cases.create({
    data: { title: 'stance case', userId, caseTypeId, stance: CaseStance.DEFENDANT },
  })
  caseId = c.id
})

afterAll(async () => {
  // afterAll 仅清理本测试新建的数据，避免 FK 残留影响后续测试
  await prisma.cases.deleteMany({ where: { id: caseId } })
  await prisma.users.deleteMany({ where: { id: userId } })
})

describe('buildContextSegments - stance 透传', () => {
  it('caseProfile JSON 含 stance 字段', async () => {
    const segs = await buildContextSegments({
      caseId,
      agentName: 'test-agent',
      userQuery: '',
      roleAndFlowTemplate: 'ROLE_TEMPLATE',
    })
    expect(segs.caseProfile).toContain('"stance"')
    expect(segs.caseProfile).toContain('"defendant"')
  })

  it('roleAndFlow 段含立场使用说明', async () => {
    const segs = await buildContextSegments({
      caseId,
      agentName: 'test-agent',
      userQuery: '',
      roleAndFlowTemplate: 'ROLE_TEMPLATE',
    })
    expect(segs.roleAndFlow).toContain('stance')
    expect(segs.roleAndFlow).toMatch(/原告|plaintiff/)
    expect(segs.roleAndFlow).toMatch(/被告|defendant/)
  })
})

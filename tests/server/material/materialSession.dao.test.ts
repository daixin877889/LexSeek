import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
  createMaterialDao,
  findMaterialsBySessionIdDao,
  findMaterialsByCaseOrDraftIdDao,
} from '~~/server/services/material/material.dao'

describe('findMaterialsBySessionIdDao', () => {
  it('只返回该 sessionId 下未删除的材料', async () => {
    const sid = `sess-${Date.now()}`
    const a = await createMaterialDao({ sessionId: sid, name: 'A', type: 3 })
    await createMaterialDao({ sessionId: 'other-sess', name: 'B', type: 3 })

    const rows = await findMaterialsBySessionIdDao(sid)
    expect(rows.map(r => r.id)).toEqual([a.id])

    await prisma.caseMaterials.update({ where: { id: a.id }, data: { deletedAt: new Date() } })
    expect(await findMaterialsBySessionIdDao(sid)).toEqual([])
  })
})

describe('findMaterialsByCaseOrDraftIdDao（含 sessionId 分支）', () => {
  it('按 sessionId OR 合并', async () => {
    const sid = `sess-or-${Date.now()}`
    const m = await createMaterialDao({ sessionId: sid, name: 'C', type: 3 })
    const rows = await findMaterialsByCaseOrDraftIdDao({ caseId: null, draftId: null, sessionId: sid })
    expect(rows.map(r => r.id)).toEqual([m.id])
  })
})

import { describe, it, expect } from 'vitest'
import { createMaterialDao } from '~~/server/services/material/material.dao'
import {
  getMaterialsBySessionIdService,
  getMaterialsByCaseOrDraftIdService,
} from '~~/server/services/material/material.service'

describe('getMaterialsBySessionIdService', () => {
  it('返回会话材料并附加 OSS 文件信息字段', async () => {
    const sid = `sess-svc-${Date.now()}`
    await createMaterialDao({ sessionId: sid, name: 'A', type: 3 })
    const rows = await getMaterialsBySessionIdService(sid)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveProperty('fileName')
  })
})

describe('getMaterialsByCaseOrDraftIdService（含 sessionId）', () => {
  it('按 sessionId 取材料', async () => {
    const sid = `sess-svc-or-${Date.now()}`
    const m = await createMaterialDao({ sessionId: sid, name: 'B', type: 3 })
    const rows = await getMaterialsByCaseOrDraftIdService({ caseId: null, draftId: null, sessionId: sid })
    expect(rows.map(r => r.id)).toEqual([m.id])
  })
})

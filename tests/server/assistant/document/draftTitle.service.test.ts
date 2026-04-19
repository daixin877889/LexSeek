import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock 外部依赖（必须在 import 被测模块之前） ====================

vi.mock('~~/server/services/assistant/document/documentDraft.dao', () => ({
  getDocumentDraftDAO: vi.fn(),
  updateDraftTitleDAO: vi.fn(),
  updateDraftTitleIfNotOverriddenDAO: vi.fn(),
}))

// ==================== 导入被测模块（在 mock 之后） ====================

import {
  updateDraftTitleService,
  applyAITitleIfAllowedService,
} from '~~/server/services/assistant/document/documentDraft.service'
import {
  getDocumentDraftDAO,
  updateDraftTitleDAO,
  updateDraftTitleIfNotOverriddenDAO,
} from '~~/server/services/assistant/document/documentDraft.dao'

// ==================== 类型转换（方便使用 mockResolvedValue） ====================

const mockGetDocumentDraftDAO = getDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockUpdateDraftTitleDAO = updateDraftTitleDAO as ReturnType<typeof vi.fn>
const mockUpdateDraftTitleIfNotOverriddenDAO = updateDraftTitleIfNotOverriddenDAO as ReturnType<typeof vi.fn>

describe('updateDraftTitleService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('owner 可更新标题并置 titleOverridden=true', async () => {
    mockGetDocumentDraftDAO.mockResolvedValue({ id: 1, userId: 10, deletedAt: null })
    mockUpdateDraftTitleDAO.mockResolvedValue({ id: 1, title: 'X', titleOverridden: true })
    const r = await updateDraftTitleService(10, 1, 'X')
    expect('draft' in r && r.draft.title).toBe('X')
    expect(mockUpdateDraftTitleDAO).toHaveBeenCalledWith(1, 'X')
  })

  it('非 owner 返 403', async () => {
    mockGetDocumentDraftDAO.mockResolvedValue({ id: 1, userId: 99, deletedAt: null })
    const r = await updateDraftTitleService(10, 1, 'X')
    expect('error' in r && r.code).toBe(403)
  })

  it('不存在返 404', async () => {
    mockGetDocumentDraftDAO.mockResolvedValue(null)
    const r = await updateDraftTitleService(10, 1, 'X')
    expect('error' in r && r.code).toBe(404)
  })
})

describe('applyAITitleIfAllowedService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('titleOverridden=false 时正常写入', async () => {
    mockUpdateDraftTitleIfNotOverriddenDAO.mockResolvedValue({ id: 1, title: 'AI', titleOverridden: false })
    const ok = await applyAITitleIfAllowedService(1, 'AI')
    expect(ok).toBe(true)
    expect(mockUpdateDraftTitleIfNotOverriddenDAO).toHaveBeenCalledWith(1, 'AI')
  })

  it('原子 update 未命中（用户已改）时返 false', async () => {
    mockUpdateDraftTitleIfNotOverriddenDAO.mockResolvedValue(null)
    const ok = await applyAITitleIfAllowedService(1, 'AI')
    expect(ok).toBe(false)
  })

  it('空字符串直接跳过', async () => {
    const ok = await applyAITitleIfAllowedService(1, '')
    expect(ok).toBe(false)
    expect(mockUpdateDraftTitleIfNotOverriddenDAO).not.toHaveBeenCalled()
  })

  it('仅空白字符直接跳过', async () => {
    const ok = await applyAITitleIfAllowedService(1, '   ')
    expect(ok).toBe(false)
    expect(mockUpdateDraftTitleIfNotOverriddenDAO).not.toHaveBeenCalled()
  })
})

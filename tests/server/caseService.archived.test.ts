import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindCaseByIdDao = vi.fn()
const mockUpdateCaseDao = vi.fn()
vi.mock('~~/server/services/case/case.dao', () => ({
  findCaseByIdDao: (...args: any[]) => mockFindCaseByIdDao(...args),
  updateCaseDao: (...args: any[]) => mockUpdateCaseDao(...args),
  createCaseDao: vi.fn(),
  createSessionDao: vi.fn(),
  findCaseBySessionIdDao: vi.fn(),
  findSessionByIdDao: vi.fn(),
  findManyCasesDao: vi.fn(),
  updateSessionStatusDao: vi.fn(),
  softDeleteCaseDao: vi.fn(),
  findLatestSessionByCaseIdDao: vi.fn(),
  checkCaseOwnershipDao: vi.fn(),
}))

describe('ARCHIVED 状态只读守卫', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updateCaseService 对 ARCHIVED 案件抛出业务错误', async () => {
    const { updateCaseService } = await import('~~/server/services/case/case.service')
    mockFindCaseByIdDao.mockResolvedValue({ id: 1, status: 999, deletedAt: null })
    await expect(
      updateCaseService(1, { title: '新标题' } as any),
    ).rejects.toThrow(/归档|只读/i)
    expect(mockUpdateCaseDao).not.toHaveBeenCalled()
  })

  it('updateCaseService 对非 ARCHIVED 正常通过', async () => {
    const { updateCaseService } = await import('~~/server/services/case/case.service')
    mockFindCaseByIdDao.mockResolvedValue({ id: 1, status: 1, deletedAt: null })
    mockUpdateCaseDao.mockResolvedValue({ id: 1, title: '新' })
    await expect(
      updateCaseService(1, { title: '新' } as any),
    ).resolves.toBeDefined()
  })
})

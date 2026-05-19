import { describe, expect, it } from 'vitest'
import type { LOssFile } from '../../src/legacyTypes'
import { transformOssFile } from '../../src/transforms/file'

describe('transformOssFile', () => {
  it('新增 encrypted=false、originalMimeType=null；非案件材料文件保留原 source', () => {
    const o = {
      id: 1, userId: 1, bucketName: 'b', fileName: 'f', filePath: 'p',
      fileSize: 100, fileType: 'image/png', fileMd5: null, source: 'doc', status: 0,
      createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LOssFile
    const r = transformOssFile(o, new Set())
    expect(r.encrypted).toBe(false)
    expect(r.originalMimeType).toBeNull()
    expect(r.source).toBe('doc')
  })
  it('被 case_materials 引用的文件 source 改为 caseAnalysis', () => {
    const o = {
      id: 42, userId: 1, bucketName: 'b', fileName: 'f', filePath: 'p',
      fileSize: 100, fileType: 'application/pdf', fileMd5: null, source: 'doc', status: 1,
      createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LOssFile
    const r = transformOssFile(o, new Set([42]))
    expect(r.source).toBe('caseAnalysis')
  })
})

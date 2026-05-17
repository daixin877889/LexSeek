import { describe, expect, it } from 'vitest'
import type { LOssFile } from '../../src/legacyTypes'
import { transformOssFile } from '../../src/transforms/file'

describe('transformOssFile', () => {
  it('新增 encrypted=false、originalMimeType=null', () => {
    const o = {
      id: 1, userId: 1, bucketName: 'b', fileName: 'f', filePath: 'p',
      fileSize: 100, fileType: 'image/png', fileMd5: null, source: null, status: 0,
      createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LOssFile
    const r = transformOssFile(o)
    expect(r.encrypted).toBe(false)
    expect(r.originalMimeType).toBeNull()
  })
})

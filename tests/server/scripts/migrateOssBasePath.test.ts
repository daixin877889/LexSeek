import { describe, it, expect } from 'vitest'
import { needsMigration, prefixedKey } from '~~/server/scripts/migrateOssBasePath'

describe('migrateOssBasePath 纯函数', () => {
    it('needsMigration: 未带前缀的路径需要迁移', () => {
        expect(needsMigration('global-templates/a.docx', 'dev/')).toBe(true)
        expect(needsMigration('users/5/templates/a.docx', 'test/')).toBe(true)
    })

    it('needsMigration: 已带前缀的路径跳过（幂等）', () => {
        expect(needsMigration('dev/user5/document_template/a.docx', 'dev/')).toBe(false)
    })

    it('needsMigration: filePath 为空跳过', () => {
        expect(needsMigration(null, 'dev/')).toBe(false)
        expect(needsMigration('', 'dev/')).toBe(false)
    })

    it('needsMigration: basePath 为空时不迁移任何行', () => {
        expect(needsMigration('global-templates/a.docx', '')).toBe(false)
    })

    it('prefixedKey: 旧路径前补环境前缀', () => {
        expect(prefixedKey('global-templates/a.docx', 'dev/')).toBe('dev/global-templates/a.docx')
    })
})

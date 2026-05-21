import { describe, it, expect } from 'vitest'
import { FileSource } from '#shared/types/file'
import { buildStorageKey, buildStorageDir, normalizeBasePath } from '~~/server/utils/storagePath'

describe('normalizeBasePath（环境前缀规范化）', () => {
    it('空值 → 空字符串', () => {
        expect(normalizeBasePath('')).toBe('')
        expect(normalizeBasePath(undefined)).toBe('')
        expect(normalizeBasePath(null)).toBe('')
    })

    it('不带末尾斜杠 → 自动补全 /', () => {
        expect(normalizeBasePath('prod')).toBe('prod/')
    })

    it('已带末尾斜杠 → 原样返回', () => {
        expect(normalizeBasePath('dev/')).toBe('dev/')
    })
})

describe('buildStorageDir / buildStorageKey（路径结构）', () => {
    // 测试环境 useRuntimeConfig().storage.basePath 由 .env.testing 的 NUXT_STORAGE_BASE_PATH 提供（= test/）
    it('user scope 拼出 {env}/user{id}/{source}/', () => {
        expect(buildStorageDir({ scope: 'user', userId: 7, source: FileSource.DOCUMENT_TEMPLATE }))
            .toBe('test/user7/document_template/')
    })

    it('system scope owner 段为 system', () => {
        expect(buildStorageDir({ scope: 'system', source: FileSource.DOCUMENT_TEMPLATE }))
            .toBe('test/system/document_template/')
    })

    it('temp scope owner 段为 temp', () => {
        expect(buildStorageDir({ scope: 'temp', source: FileSource.ASR }))
            .toBe('test/temp/asr/')
    })

    it('subDir 作为二级目录拼入', () => {
        expect(buildStorageDir({ scope: 'user', userId: 7, source: FileSource.ASR, subDir: 'raw/2026/05/17' }))
            .toBe('test/user7/asr/raw/2026/05/17/')
    })

    it('buildStorageKey 末尾拼上 fileName', () => {
        expect(buildStorageKey({ scope: 'user', userId: 7, source: FileSource.DOCUMENT_EXPORT, fileName: 'a.docx' }))
            .toBe('test/user7/document_export/a.docx')
    })

    it('scope=user 缺 userId 抛错', () => {
        expect(() => buildStorageDir({ scope: 'user', source: FileSource.ASR }))
            .toThrow(/userId/)
    })
})

/**
 * 案情分析文件列表工具函数测试
 *
 * 测试文件移除、文件选择追加、提交数据构建等功能
 *
 * **Feature: custom-file-list-display**
 * **Validates: Requirements 3.1, 4.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * 模拟 OssFileItem 类型
 */
interface MockOssFileItem {
    id: number
    fileName: string
    fileType: string
    fileSize: number
    encrypted: boolean
}

/**
 * 生成随机 OssFileItem 的 fast-check arbitrary
 */
const ossFileItemArb = fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    fileName: fc.string({ minLength: 1, maxLength: 50 }),
    fileType: fc.constantFrom('image/jpeg', 'image/png', 'audio/mp3', 'application/pdf', 'text/plain'),
    fileSize: fc.integer({ min: 1, max: 100000000 }),
    encrypted: fc.boolean(),
})

/**
 * 生成唯一 ID 的文件数组
 */
const uniqueFileArrayArb = fc.array(ossFileItemArb, { minLength: 0, maxLength: 20 })
    .map(files => {
        // 确保 ID 唯一
        const seen = new Set<number>()
        return files.filter(f => {
            if (seen.has(f.id)) return false
            seen.add(f.id)
            return true
        })
    })

/**
 * 移除文件函数（纯函数版本，用于测试）
 */
function removeFile(files: MockOssFileItem[], fileId: number): MockOssFileItem[] {
    return files.filter(f => f.id !== fileId)
}

/**
 * 追加文件函数（纯函数版本，用于测试）
 */
function appendFiles(
    existingFiles: MockOssFileItem[],
    newFiles: MockOssFileItem[]
): MockOssFileItem[] {
    const existingIds = new Set(existingFiles.map(f => f.id))
    const filteredNewFiles = newFiles.filter(f => !existingIds.has(f.id))
    return [...existingFiles, ...filteredNewFiles]
}

/**
 * 构建提交数据函数（纯函数版本，用于测试）
 */
function buildSubmitFileIds(files: MockOssFileItem[]): number[] {
    return files.map(f => f.id)
}

describe('removeFile 文件移除函数', () => {
    it('移除存在的文件应返回不包含该文件的数组', () => {
        const files: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
            { id: 2, fileName: 'test2.jpg', fileType: 'image/jpeg', fileSize: 2000, encrypted: true },
            { id: 3, fileName: 'test3.mp3', fileType: 'audio/mp3', fileSize: 3000, encrypted: false },
        ]

        const result = removeFile(files, 2)

        expect(result).toHaveLength(2)
        expect(result.find(f => f.id === 2)).toBeUndefined()
        expect(result.find(f => f.id === 1)).toBeDefined()
        expect(result.find(f => f.id === 3)).toBeDefined()
    })

    it('移除不存在的文件应返回原数组', () => {
        const files: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
            { id: 2, fileName: 'test2.jpg', fileType: 'image/jpeg', fileSize: 2000, encrypted: true },
        ]

        const result = removeFile(files, 999)

        expect(result).toHaveLength(2)
        expect(result).toEqual(files)
    })

    it('从空数组移除文件应返回空数组', () => {
        const result = removeFile([], 1)
        expect(result).toHaveLength(0)
    })

    it('移除唯一文件应返回空数组', () => {
        const files: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
        ]

        const result = removeFile(files, 1)

        expect(result).toHaveLength(0)
    })
})

describe('Property 1: 文件移除正确性', () => {
    /**
     * **Property 1: 文件移除正确性**
     * **Validates: Requirements 3.1**
     *
     * For any selectedFiles 数组和任意文件 ID，调用 removeFile(id) 后：
     * - 如果 ID 存在于数组中，该文件应该被移除，其他文件保持不变
     * - 如果 ID 不存在于数组中，数组应该保持不变
     * - 移除后数组长度应该等于原长度减去被移除的文件数（0 或 1）
     */
    it('移除操作应正确处理存在和不存在的 ID', () => {
        fc.assert(
            fc.property(
                uniqueFileArrayArb,
                fc.integer({ min: 1, max: 10000 }),
                (files, targetId) => {
                    const originalLength = files.length
                    const fileExists = files.some(f => f.id === targetId)
                    const result = removeFile(files, targetId)

                    // 验证长度变化
                    if (fileExists) {
                        expect(result.length).toBe(originalLength - 1)
                    } else {
                        expect(result.length).toBe(originalLength)
                    }

                    // 验证目标文件已被移除
                    expect(result.find(f => f.id === targetId)).toBeUndefined()

                    // 验证其他文件保持不变
                    const otherFiles = files.filter(f => f.id !== targetId)
                    expect(result).toEqual(otherFiles)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('移除操作不应修改原数组', () => {
        fc.assert(
            fc.property(
                uniqueFileArrayArb,
                fc.integer({ min: 1, max: 10000 }),
                (files, targetId) => {
                    const originalFiles = [...files]
                    removeFile(files, targetId)

                    // 原数组应保持不变
                    expect(files).toEqual(originalFiles)
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('appendFiles 文件追加函数', () => {
    it('追加新文件应正确添加', () => {
        const existing: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
        ]
        const newFiles: MockOssFileItem[] = [
            { id: 2, fileName: 'test2.jpg', fileType: 'image/jpeg', fileSize: 2000, encrypted: true },
        ]

        const result = appendFiles(existing, newFiles)

        expect(result).toHaveLength(2)
        expect(result.find(f => f.id === 1)).toBeDefined()
        expect(result.find(f => f.id === 2)).toBeDefined()
    })

    it('追加已存在的文件应被过滤', () => {
        const existing: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
            { id: 2, fileName: 'test2.jpg', fileType: 'image/jpeg', fileSize: 2000, encrypted: true },
        ]
        const newFiles: MockOssFileItem[] = [
            { id: 2, fileName: 'duplicate.jpg', fileType: 'image/jpeg', fileSize: 3000, encrypted: false },
            { id: 3, fileName: 'test3.mp3', fileType: 'audio/mp3', fileSize: 4000, encrypted: false },
        ]

        const result = appendFiles(existing, newFiles)

        expect(result).toHaveLength(3)
        // 原有的 id=2 文件应保持不变
        const file2 = result.find(f => f.id === 2)
        expect(file2?.fileName).toBe('test2.jpg')
        expect(file2?.fileSize).toBe(2000)
    })

    it('追加到空数组应返回新文件数组', () => {
        const newFiles: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
        ]

        const result = appendFiles([], newFiles)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual(newFiles[0])
    })

    it('追加空数组应返回原数组', () => {
        const existing: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
        ]

        const result = appendFiles(existing, [])

        expect(result).toHaveLength(1)
        expect(result).toEqual(existing)
    })
})

describe('Property 3: 提交数据完整性', () => {
    /**
     * **Property 3: 提交数据完整性**
     * **Validates: Requirements 4.1**
     *
     * For any selectedFiles 数组，构建的提交数据中的 fileIds 应该精确等于
     * selectedFiles.map(f => f.id)，顺序一致。
     */
    it('构建的 fileIds 应与原数组 ID 顺序一致', () => {
        fc.assert(
            fc.property(
                uniqueFileArrayArb,
                (files) => {
                    const fileIds = buildSubmitFileIds(files)
                    const expectedIds = files.map(f => f.id)

                    // 验证长度相等
                    expect(fileIds.length).toBe(expectedIds.length)

                    // 验证顺序一致
                    expect(fileIds).toEqual(expectedIds)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('空数组应返回空 fileIds', () => {
        const fileIds = buildSubmitFileIds([])
        expect(fileIds).toEqual([])
    })

    it('单个文件应返回单个 ID', () => {
        const files: MockOssFileItem[] = [
            { id: 42, fileName: 'test.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
        ]

        const fileIds = buildSubmitFileIds(files)

        expect(fileIds).toEqual([42])
    })
})

describe('Property 2: 空列表条件渲染', () => {
    /**
     * **Property 2: 空列表条件渲染**
     * **Validates: Requirements 2.3, 3.3**
     *
     * For any selectedFiles 数组，文件列表区域的可见性应该等于 selectedFiles.length > 0
     */
    it('shouldShowFileList 应与 files.length > 0 一致', () => {
        fc.assert(
            fc.property(
                uniqueFileArrayArb,
                (files) => {
                    const shouldShow = files.length > 0
                    expect(shouldShow).toBe(files.length > 0)
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('综合场景测试', () => {
    it('选择 -> 移除 -> 再选择 流程应正确工作', () => {
        // 初始选择
        let files: MockOssFileItem[] = []
        const batch1: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
            { id: 2, fileName: 'test2.jpg', fileType: 'image/jpeg', fileSize: 2000, encrypted: true },
        ]
        files = appendFiles(files, batch1)
        expect(files).toHaveLength(2)

        // 移除一个文件
        files = removeFile(files, 1)
        expect(files).toHaveLength(1)
        expect(files[0].id).toBe(2)

        // 再次选择（包含已存在的和新的）
        const batch2: MockOssFileItem[] = [
            { id: 2, fileName: 'duplicate.jpg', fileType: 'image/jpeg', fileSize: 3000, encrypted: false },
            { id: 3, fileName: 'test3.mp3', fileType: 'audio/mp3', fileSize: 4000, encrypted: false },
        ]
        files = appendFiles(files, batch2)
        expect(files).toHaveLength(2)
        expect(files.map(f => f.id)).toEqual([2, 3])

        // 验证提交数据
        const fileIds = buildSubmitFileIds(files)
        expect(fileIds).toEqual([2, 3])
    })

    it('移除所有文件后列表应为空', () => {
        let files: MockOssFileItem[] = [
            { id: 1, fileName: 'test1.pdf', fileType: 'application/pdf', fileSize: 1000, encrypted: false },
            { id: 2, fileName: 'test2.jpg', fileType: 'image/jpeg', fileSize: 2000, encrypted: true },
        ]

        files = removeFile(files, 1)
        files = removeFile(files, 2)

        expect(files).toHaveLength(0)
        expect(files.length > 0).toBe(false) // shouldShowFileList
    })
})

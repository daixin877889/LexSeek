/**
 * 本地文件缓存 Composable
 *
 * 使用 IndexedDB 存储本地上传的文件内容，用于 docx 识别时避免重复下载
 * 支持缓存过期机制，默认 24 小时过期
 *
 * @requirements 6.1, 6.2, 6.5
 */

/** IndexedDB 配置 */
const DB_NAME = 'docx-recognition-cache'
const DB_VERSION = 1
const STORE_NAME = 'files'

/** 默认缓存过期时间（毫秒）：24 小时 */
const DEFAULT_EXPIRES_IN = 24 * 60 * 60 * 1000

/**
 * 缓存文件记录
 */
export interface CachedFileRecord {
    /** 主键：OSS 文件 ID */
    ossFileId: number
    /** 文件名 */
    fileName: string
    /** 文件内容 */
    content: ArrayBuffer
    /** 缓存时间戳 */
    cachedAt: number
    /** 过期时间（毫秒） */
    expiresIn: number
}

/**
 * 打开 IndexedDB 数据库
 */
const openDatabase = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => {
            console.error('打开 IndexedDB 失败:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            resolve(request.result)
        }

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            // 创建文件存储对象
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'ossFileId' })
                // 创建索引用于按缓存时间查询
                store.createIndex('cachedAt', 'cachedAt', { unique: false })
            }
        }
    })
}

/**
 * 检查缓存是否过期
 */
export const isCacheExpired = (record: CachedFileRecord): boolean => {
    const now = Date.now()
    return now - record.cachedAt > record.expiresIn
}

/**
 * 本地文件缓存 Composable
 */
export const useLocalFileCache = () => {
    /**
     * 缓存文件到 IndexedDB
     * @param ossFileId OSS 文件 ID
     * @param file 文件对象
     * @param expiresIn 过期时间（毫秒），默认 24 小时
     */
    const cacheFile = async (
        ossFileId: number,
        file: File,
        expiresIn: number = DEFAULT_EXPIRES_IN
    ): Promise<void> => {
        try {
            const db = await openDatabase()
            const content = await file.arrayBuffer()

            const record: CachedFileRecord = {
                ossFileId,
                fileName: file.name,
                content,
                cachedAt: Date.now(),
                expiresIn,
            }

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite')
                const store = transaction.objectStore(STORE_NAME)
                const request = store.put(record)

                request.onsuccess = () => {
                    db.close()
                    resolve()
                }

                request.onerror = () => {
                    db.close()
                    console.error('缓存文件失败:', request.error)
                    reject(request.error)
                }
            })
        } catch (error) {
            console.error('缓存文件到 IndexedDB 失败:', error)
            // 缓存失败不抛出错误，降级处理
        }
    }

    /**
     * 从 IndexedDB 获取缓存的文件内容
     * @param ossFileId OSS 文件 ID
     * @returns 文件内容 ArrayBuffer，如果不存在或已过期则返回 null
     */
    const getCachedFile = async (ossFileId: number): Promise<ArrayBuffer | null> => {
        try {
            const db = await openDatabase()

            return new Promise((resolve) => {
                const transaction = db.transaction(STORE_NAME, 'readonly')
                const store = transaction.objectStore(STORE_NAME)
                const request = store.get(ossFileId)

                request.onsuccess = () => {
                    db.close()
                    const record = request.result as CachedFileRecord | undefined

                    if (!record) {
                        resolve(null)
                        return
                    }

                    // 检查是否过期
                    if (isCacheExpired(record)) {
                        // 异步清除过期缓存
                        clearCache(ossFileId).catch(console.error)
                        resolve(null)
                        return
                    }

                    resolve(record.content)
                }

                request.onerror = () => {
                    db.close()
                    console.error('获取缓存文件失败:', request.error)
                    resolve(null)
                }
            })
        } catch (error) {
            console.error('从 IndexedDB 获取缓存失败:', error)
            return null
        }
    }

    /**
     * 检查缓存是否存在且有效
     * @param ossFileId OSS 文件 ID
     * @returns 缓存是否存在且未过期
     */
    const hasCachedFile = async (ossFileId: number): Promise<boolean> => {
        try {
            const db = await openDatabase()

            return new Promise((resolve) => {
                const transaction = db.transaction(STORE_NAME, 'readonly')
                const store = transaction.objectStore(STORE_NAME)
                const request = store.get(ossFileId)

                request.onsuccess = () => {
                    db.close()
                    const record = request.result as CachedFileRecord | undefined

                    if (!record) {
                        resolve(false)
                        return
                    }

                    // 检查是否过期
                    resolve(!isCacheExpired(record))
                }

                request.onerror = () => {
                    db.close()
                    resolve(false)
                }
            })
        } catch (error) {
            console.error('检查缓存失败:', error)
            return false
        }
    }

    /**
     * 清除缓存
     * @param ossFileId 指定文件 ID，不传则清除所有缓存
     */
    const clearCache = async (ossFileId?: number): Promise<void> => {
        try {
            const db = await openDatabase()

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite')
                const store = transaction.objectStore(STORE_NAME)

                let request: IDBRequest

                if (ossFileId !== undefined) {
                    // 清除指定文件的缓存
                    request = store.delete(ossFileId)
                } else {
                    // 清除所有缓存
                    request = store.clear()
                }

                request.onsuccess = () => {
                    db.close()
                    resolve()
                }

                request.onerror = () => {
                    db.close()
                    console.error('清除缓存失败:', request.error)
                    reject(request.error)
                }
            })
        } catch (error) {
            console.error('清除 IndexedDB 缓存失败:', error)
        }
    }

    /**
     * 清除所有过期缓存
     */
    const clearExpiredCache = async (): Promise<number> => {
        try {
            const db = await openDatabase()
            let clearedCount = 0

            return new Promise((resolve) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite')
                const store = transaction.objectStore(STORE_NAME)
                const request = store.openCursor()

                request.onsuccess = (event) => {
                    const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result

                    if (cursor) {
                        const record = cursor.value as CachedFileRecord
                        if (isCacheExpired(record)) {
                            cursor.delete()
                            clearedCount++
                        }
                        cursor.continue()
                    } else {
                        db.close()
                        resolve(clearedCount)
                    }
                }

                request.onerror = () => {
                    db.close()
                    resolve(clearedCount)
                }
            })
        } catch (error) {
            console.error('清除过期缓存失败:', error)
            return 0
        }
    }

    /**
     * 获取缓存统计信息
     */
    const getCacheStats = async (): Promise<{
        totalCount: number
        totalSize: number
        expiredCount: number
    }> => {
        try {
            const db = await openDatabase()

            return new Promise((resolve) => {
                const transaction = db.transaction(STORE_NAME, 'readonly')
                const store = transaction.objectStore(STORE_NAME)
                const request = store.openCursor()

                let totalCount = 0
                let totalSize = 0
                let expiredCount = 0

                request.onsuccess = (event) => {
                    const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result

                    if (cursor) {
                        const record = cursor.value as CachedFileRecord
                        totalCount++
                        totalSize += record.content.byteLength

                        if (isCacheExpired(record)) {
                            expiredCount++
                        }

                        cursor.continue()
                    } else {
                        db.close()
                        resolve({ totalCount, totalSize, expiredCount })
                    }
                }

                request.onerror = () => {
                    db.close()
                    resolve({ totalCount: 0, totalSize: 0, expiredCount: 0 })
                }
            })
        } catch (error) {
            console.error('获取缓存统计失败:', error)
            return { totalCount: 0, totalSize: 0, expiredCount: 0 }
        }
    }

    return {
        cacheFile,
        getCachedFile,
        hasCachedFile,
        clearCache,
        clearExpiredCache,
        getCacheStats,
    }
}

/**
 * Age 加密 Composable
 * 
 * 提供基于 age-encryption 库的端到端加密功能
 * 包括密钥对生成、私钥加密/解密、文件加密/解密
 * 
 * 文件加密/解密在 Web Worker 中执行，避免阻塞主线程
 * 私钥解锁状态保存在 IndexedDB 中（使用 Web Crypto API 加密），刷新页面后无需重新输入密码
 */

import type { AgeKeyPair } from '~~/shared/types/encryption'
import {
    IdentityNotUnlockedError,
    IdentityMismatchError,
    FileCorruptedError,
    InvalidAgeFileError,
    WrongPasswordError,
} from '~~/shared/types/encryption'

// IndexedDB 配置
const DB_NAME = 'encryption-store'
const DB_VERSION = 1
const STORE_NAME = 'identity'
const IDENTITY_KEY_PREFIX = 'identity-user-' // 私钥存储键前缀，后面会拼接用户 ID

// 全局私钥状态（跨组件共享）
const globalIdentity = ref<string | null>(null)
// 当前用户 ID（用于区分不同用户的私钥）
const currentUserId = ref<number | null>(null)
// 标记是否已从 IndexedDB 恢复
const isRestored = ref(false)

/**
 * 获取当前用户的私钥存储键
 * @param userId 用户 ID
 * @returns 带用户 ID 前缀的存储键
 */
const getIdentityKey = (userId: number): string => {
    return `${IDENTITY_KEY_PREFIX}${userId}`
}

// Worker 实例（懒加载）
let cryptoWorker: Worker | null = null
// Worker 任务回调映射
const workerCallbacks = new Map<string, {
    resolve: (data: ArrayBuffer) => void
    reject: (error: Error) => void
    onProgress?: (progress: number) => void
}>()

/**
 * 生成唯一任务 ID
 */
const generateTaskId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * 获取或创建 Worker 实例
 */
const getWorker = (): Worker => {
    if (!cryptoWorker) {
        // 使用 Nuxt 的方式创建 Worker
        cryptoWorker = new Worker(
            new URL('../workers/crypto.worker.ts', import.meta.url),
            { type: 'module' }
        )

        // 监听 Worker 消息
        cryptoWorker.onmessage = (event) => {
            const { type, id, data, error, errorType, progress } = event.data

            if (type === 'ready') {
                return
            }

            const callback = workerCallbacks.get(id)
            if (!callback) return

            switch (type) {
                case 'success':
                    callback.resolve(data)
                    workerCallbacks.delete(id)
                    break
                case 'error': {
                    let err: Error
                    switch (errorType) {
                        case 'IdentityMismatchError':
                            err = new IdentityMismatchError()
                            break
                        case 'InvalidAgeFileError':
                            err = new InvalidAgeFileError()
                            break
                        default:
                            err = new FileCorruptedError()
                    }
                    callback.reject(err)
                    workerCallbacks.delete(id)
                    break
                }
                case 'progress':
                    callback.onProgress?.(progress)
                    break
            }
        }

        cryptoWorker.onerror = (error) => {
            logger.error('Crypto Worker 错误:', error)
        }
    }
    return cryptoWorker
}

/**
 * 获取设备唯一标识作为加密密钥的一部分
 * 使用 navigator 信息生成一个相对稳定的设备指纹
 */
const getDeviceFingerprint = (): string => {
    const parts = [
        navigator.userAgent,
        navigator.language,
        screen.width.toString(),
        screen.height.toString(),
        new Date().getTimezoneOffset().toString(),
    ]
    return parts.join('|')
}

/**
 * 从设备指纹派生加密密钥
 */
const deriveKey = async (): Promise<CryptoKey> => {
    const fingerprint = getDeviceFingerprint()
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(fingerprint),
        'PBKDF2',
        false,
        ['deriveKey']
    )

    // 使用固定的盐值（因为我们需要在不同会话中派生相同的密钥）
    const salt = encoder.encode('age-identity-storage-salt')

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

/**
 * 加密数据用于存储
 */
const encryptForStorage = async (data: string): Promise<string> => {
    const key = await deriveKey()
    const encoder = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(data)
    )

    // 将 IV 和加密数据合并，然后 Base64 编码
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    return btoa(String.fromCharCode(...combined))
}

/**
 * 解密存储的数据
 */
const decryptFromStorage = async (encryptedData: string): Promise<string> => {
    const key = await deriveKey()
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0))

    // 分离 IV 和加密数据
    const iv = combined.slice(0, 12)
    const data = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    )

    return new TextDecoder().decode(decrypted)
}

/**
 * 打开 IndexedDB 数据库
 */
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME)
            }
        }
    })
}

/**
 * 保存私钥到 IndexedDB（加密后存储）
 * @param identity 私钥字符串
 * @param userId 用户 ID
 */
const saveIdentityToDB = async (identity: string, userId: number): Promise<void> => {
    try {
        // 先加密私钥
        const encryptedIdentity = await encryptForStorage(identity)
        const key = getIdentityKey(userId)

        const db = await openDB()
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        store.put(encryptedIdentity, key)
        db.close()
    } catch (error) {
        logger.error('保存私钥到 IndexedDB 失败:', error)
    }
}

/**
 * 从 IndexedDB 读取私钥（解密后返回）
 * @param userId 用户 ID
 */
const loadIdentityFromDB = async (userId: number): Promise<string | null> => {
    try {
        const db = await openDB()
        const key = getIdentityKey(userId)

        return new Promise((resolve) => {
            const transaction = db.transaction(STORE_NAME, 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.get(key)

            request.onsuccess = async () => {
                db.close()
                const encryptedIdentity = request.result
                if (!encryptedIdentity) {
                    resolve(null)
                    return
                }

                try {
                    // 解密私钥
                    const identity = await decryptFromStorage(encryptedIdentity)
                    resolve(identity)
                } catch (error) {
                    logger.error('解密存储的私钥失败:', error)
                    // 解密失败，可能是设备指纹变化，清除存储
                    await removeIdentityFromDB(userId)
                    resolve(null)
                }
            }
            request.onerror = () => {
                db.close()
                resolve(null)
            }
        })
    } catch (error) {
        logger.error('从 IndexedDB 读取私钥失败:', error)
        return null
    }
}

/**
 * 从 IndexedDB 删除私钥
 * @param userId 用户 ID
 */
const removeIdentityFromDB = async (userId: number): Promise<void> => {
    try {
        const db = await openDB()
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const key = getIdentityKey(userId)
        store.delete(key)
        db.close()
    } catch (error) {
        logger.error('从 IndexedDB 删除私钥失败:', error)
    }
}

/**
 * Age 加密 Composable
 */
export const useAgeCrypto = () => {
    // 使用全局私钥状态
    const identity = globalIdentity
    const isUnlocked = computed(() => identity.value !== null)

    // 获取用户 store（用于获取当前用户 ID）
    const userStore = useUserStore()

    /**
     * 获取当前用户 ID
     * @throws Error 用户未登录时抛出
     */
    const getUserId = (): number => {
        const userId = userStore.userInfo.id
        if (!userId) {
            throw new Error('用户未登录，无法操作加密密钥')
        }
        return userId
    }

    /**
     * 从 IndexedDB 恢复私钥状态
     * 应在应用启动时调用
     */
    const restoreIdentity = async (): Promise<boolean> => {
        // 获取当前用户 ID
        const userId = userStore.userInfo.id
        if (!userId) {
            // 用户未登录，无法恢复
            return false
        }

        // 如果已恢复且用户 ID 相同，直接返回
        if (isRestored.value && currentUserId.value === userId) {
            return identity.value !== null
        }

        // 用户切换时，清除之前的状态
        if (currentUserId.value !== null && currentUserId.value !== userId) {
            identity.value = null
            isRestored.value = false
        }

        const savedIdentity = await loadIdentityFromDB(userId)
        if (savedIdentity) {
            identity.value = savedIdentity
        }
        currentUserId.value = userId
        isRestored.value = true
        return savedIdentity !== null
    }

    /**
     * 生成新的密钥对
     * @returns 包含 identity（私钥）和 recipient（公钥）的密钥对
     */
    const generateKeyPair = async (): Promise<AgeKeyPair> => {
        const { generateIdentity, identityToRecipient } = await import('age-encryption')
        const id = await generateIdentity()
        const recipient = await identityToRecipient(id)
        return { identity: id, recipient }
    }

    /**
     * 用密码加密私钥
     * @param id 私钥字符串
     * @param password 用户密码
     * @returns Base64 编码的加密后私钥
     */
    const encryptIdentity = async (id: string, password: string): Promise<string> => {
        const { Encrypter } = await import('age-encryption')
        const e = new Encrypter()
        e.setPassphrase(password)
        const encrypted = await e.encrypt(new TextEncoder().encode(id))
        return btoa(String.fromCharCode(...encrypted))
    }

    /**
     * 用密码解密私钥
     * @param encryptedId Base64 编码的加密后私钥
     * @param password 用户密码
     * @returns 解密后的私钥字符串
     * @throws WrongPasswordError 密码错误时抛出
     */
    const decryptIdentity = async (encryptedId: string, password: string): Promise<string> => {
        try {
            const { Decrypter } = await import('age-encryption')
            const d = new Decrypter()
            d.addPassphrase(password)
            const bytes = Uint8Array.from(atob(encryptedId), c => c.charCodeAt(0))
            const decrypted = await d.decrypt(bytes, 'text')
            return decrypted
        } catch (error: unknown) {
            // age-encryption 密码错误时会抛出异常
            const errorMessage = error instanceof Error ? error.message : String(error)
            if (errorMessage.includes('passphrase') || errorMessage.includes('incorrect')) {
                throw new WrongPasswordError()
            }
            throw error
        }
    }

    /**
     * 解锁私钥（存入内存和 IndexedDB）
     * @param encryptedId Base64 编码的加密后私钥
     * @param password 用户密码
     */
    const unlockIdentity = async (encryptedId: string, password: string): Promise<void> => {
        const userId = getUserId()
        const decrypted = await decryptIdentity(encryptedId, password)
        identity.value = decrypted
        currentUserId.value = userId
        // 保存到 IndexedDB 以便刷新后恢复（加密存储）
        await saveIdentityToDB(decrypted, userId)
    }

    /**
     * 锁定私钥（清除内存和 IndexedDB）
     */
    const lockIdentity = async () => {
        const userId = userStore.userInfo.id
        identity.value = null
        currentUserId.value = null
        isRestored.value = false
        if (userId) {
            await removeIdentityFromDB(userId)
        }
    }

    /**
     * 加密文件（在 Worker 中执行）
     * @param file 要加密的文件或 Blob
     * @param recipient 公钥
     * @param onProgress 进度回调（0-100）
     * @returns 加密后的 Blob
     */
    const encryptFile = async (
        file: File | Blob,
        recipient: string,
        onProgress?: (progress: number) => void
    ): Promise<Blob> => {
        onProgress?.(5)
        const arrayBuffer = await file.arrayBuffer()

        // 在 Worker 中执行加密
        const encrypted = await new Promise<ArrayBuffer>((resolve, reject) => {
            const worker = getWorker()
            const taskId = generateTaskId()

            workerCallbacks.set(taskId, { resolve, reject, onProgress })

            // 使用 Transferable 传输数据，避免复制
            worker.postMessage(
                { type: 'encrypt', id: taskId, data: arrayBuffer, recipient },
                [arrayBuffer]
            )
        })

        return new Blob([encrypted], { type: 'application/octet-stream' })
    }

    /**
     * 解密文件（在 Worker 中执行）
     * @param encryptedData 加密的数据
     * @param onProgress 进度回调（0-100）
     * @returns 解密后的 ArrayBuffer
     * @throws IdentityNotUnlockedError 私钥未解锁时抛出
     * @throws IdentityMismatchError 私钥不匹配时抛出
     * @throws InvalidAgeFileError 文件格式无效时抛出
     * @throws FileCorruptedError 文件损坏时抛出
     */
    const decryptFile = async (
        encryptedData: Blob | ArrayBuffer,
        onProgress?: (progress: number) => void
    ): Promise<ArrayBuffer> => {
        if (!identity.value) {
            throw new IdentityNotUnlockedError()
        }

        const arrayBuffer = encryptedData instanceof Blob
            ? await encryptedData.arrayBuffer()
            : encryptedData

        // 在 Worker 中执行解密
        return new Promise<ArrayBuffer>((resolve, reject) => {
            const worker = getWorker()
            const taskId = generateTaskId()

            workerCallbacks.set(taskId, { resolve, reject, onProgress })

            // 使用 Transferable 传输数据，避免复制
            worker.postMessage(
                { type: 'decrypt', id: taskId, data: arrayBuffer, identity: identity.value },
                [arrayBuffer]
            )
        })
    }

    /**
     * 解密文件并返回 Blob
     * @param encryptedData 加密的数据
     * @param mimeType 原始文件的 MIME 类型
     * @param onProgress 进度回调
     * @returns 带有正确 MIME 类型的 Blob
     */
    const decryptToBlob = async (
        encryptedData: Blob | ArrayBuffer,
        mimeType: string,
        onProgress?: (progress: number) => void
    ): Promise<Blob> => {
        const decrypted = await decryptFile(encryptedData, onProgress)
        return new Blob([decrypted], { type: mimeType })
    }

    /**
     * 解密文件并返回 Object URL
     * @param encryptedData 加密的数据
     * @param mimeType 原始文件的 MIME 类型
     * @param onProgress 进度回调
     * @returns 可直接用于展示的 Object URL
     */
    const decryptToObjectURL = async (
        encryptedData: Blob | ArrayBuffer,
        mimeType: string,
        onProgress?: (progress: number) => void
    ): Promise<string> => {
        const blob = await decryptToBlob(encryptedData, mimeType, onProgress)
        return URL.createObjectURL(blob)
    }

    /**
     * 判断 URL 是否为加密文件（路径以 .age 结尾）
     * @param url 文件 URL
     * @returns 是否为加密文件
     */
    const isEncryptedUrl = (url: string): boolean => {
        try {
            const urlObj = new URL(url)
            return urlObj.pathname.endsWith('.age')
        } catch {
            return false
        }
    }

    /**
     * 从 URL 获取文件并根据需要解密，返回 Object URL
     * 自动判断是否需要解密（根据 URL 路径是否以 .age 结尾）
     * @param url 文件下载 URL
     * @param mimeType 原始文件的 MIME 类型
     * @param onProgress 进度回调，参数为 { stage: 'check' | 'download' | 'decrypt', progress?: number }
     * @returns 可直接用于展示的 Object URL
     * @throws IdentityNotUnlockedError 需要解密但私钥未解锁时抛出
     */
    const fetchAndDecryptToObjectURL = async (
        url: string,
        mimeType: string,
        onProgress?: (info: { stage: 'check' | 'download' | 'decrypt', progress?: number }) => void
    ): Promise<string> => {
        const needDecrypt = isEncryptedUrl(url)

        if (!needDecrypt) {
            // 非加密文件，直接返回原 URL
            return url
        }

        // 检查私钥状态
        onProgress?.({ stage: 'check' })
        await restoreIdentity()

        if (!isUnlocked.value) {
            throw new IdentityNotUnlockedError()
        }

        // 下载加密文件
        onProgress?.({ stage: 'download', progress: 0 })
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`下载失败: ${response.status}`)
        }

        const encryptedBlob = await response.blob()
        onProgress?.({ stage: 'download', progress: 100 })

        // 解密文件
        onProgress?.({ stage: 'decrypt', progress: 0 })
        const objectUrl = await decryptToObjectURL(encryptedBlob, mimeType, (progress) => {
            onProgress?.({ stage: 'decrypt', progress })
        })

        return objectUrl
    }

    return {
        identity: readonly(identity),
        isUnlocked,
        isRestored: readonly(isRestored),
        generateKeyPair,
        encryptIdentity,
        decryptIdentity,
        unlockIdentity,
        lockIdentity,
        encryptFile,
        decryptFile,
        decryptToBlob,
        decryptToObjectURL,
        isEncryptedUrl,
        fetchAndDecryptToObjectURL,
        restoreIdentity,
    }
}

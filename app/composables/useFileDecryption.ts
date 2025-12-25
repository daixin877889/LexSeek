/**
 * 文件解密 Composable
 * 
 * 提供响应式的文件解密功能，用于 Vue 组件中
 */

import type { DecryptionStatus } from '~~/shared/types/encryption'
import { IdentityNotUnlockedError } from '~~/shared/types/encryption'

/**
 * 文件解密 Composable
 */
export const useFileDecryption = () => {
    const { decryptFile, isUnlocked } = useAgeCrypto()

    // 响应式状态
    const status = ref<DecryptionStatus>('idle')
    const progress = ref(0)
    const error = ref<Error | null>(null)
    const objectUrl = ref<string | null>(null)

    /**
     * 解密文件并返回 Object URL
     * @param encryptedData 加密的数据
     * @param mimeType 原始文件的 MIME 类型
     * @returns Object URL
     */
    const decrypt = async (
        encryptedData: Blob | ArrayBuffer,
        mimeType: string
    ): Promise<string> => {
        // 检查私钥是否已解锁
        if (!isUnlocked.value) {
            status.value = 'locked'
            throw new IdentityNotUnlockedError()
        }

        status.value = 'decrypting'
        progress.value = 0
        error.value = null

        try {
            const decrypted = await decryptFile(encryptedData, (p) => {
                progress.value = p
            })

            // 创建 Blob 和 Object URL
            const blob = new Blob([decrypted], { type: mimeType })
            objectUrl.value = URL.createObjectURL(blob)
            status.value = 'success'
            return objectUrl.value
        } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e))
            status.value = 'error'
            throw e
        }
    }

    /**
     * 释放 Object URL
     */
    const revokeUrl = () => {
        if (objectUrl.value) {
            URL.revokeObjectURL(objectUrl.value)
            objectUrl.value = null
        }
    }

    /**
     * 重置状态
     */
    const reset = () => {
        revokeUrl()
        status.value = 'idle'
        progress.value = 0
        error.value = null
    }

    // 组件卸载时自动释放 URL
    onUnmounted(() => {
        revokeUrl()
    })

    return {
        status: readonly(status),
        progress: readonly(progress),
        error: readonly(error),
        objectUrl: readonly(objectUrl),
        isUnlocked,
        decrypt,
        revokeUrl,
        reset,
    }
}

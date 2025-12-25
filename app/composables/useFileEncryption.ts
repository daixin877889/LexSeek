/**
 * 文件加密 Composable
 * 
 * 提供响应式的文件加密功能，用于 Vue 组件中
 */

import type { EncryptionStatus } from '~~/shared/types/encryption'

/**
 * 文件加密 Composable
 */
export const useFileEncryption = () => {
    const { encryptFile } = useAgeCrypto()

    // 响应式状态
    const status = ref<EncryptionStatus>('idle')
    const progress = ref(0)
    const error = ref<Error | null>(null)
    const encryptedBlob = ref<Blob | null>(null)

    /**
     * 加密文件
     * @param file 要加密的文件
     * @param recipient 公钥
     * @returns 加密后的 Blob
     */
    const encrypt = async (file: File, recipient: string): Promise<Blob> => {
        status.value = 'encrypting'
        progress.value = 0
        error.value = null
        encryptedBlob.value = null

        try {
            const result = await encryptFile(file, recipient, (p) => {
                progress.value = p
            })
            encryptedBlob.value = result
            status.value = 'success'
            return result
        } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e))
            status.value = 'error'
            throw e
        }
    }

    /**
     * 重置状态
     */
    const reset = () => {
        status.value = 'idle'
        progress.value = 0
        error.value = null
        encryptedBlob.value = null
    }

    return {
        status: readonly(status),
        progress: readonly(progress),
        error: readonly(error),
        encryptedBlob: readonly(encryptedBlob),
        encrypt,
        reset,
    }
}

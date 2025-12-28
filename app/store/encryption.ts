/**
 * 加密配置状态管理 Store
 * 
 * 负责用户加密配置的获取、保存和私钥解锁状态管理
 * 私钥解锁状态通过 useAgeCrypto 保存在 IndexedDB 中
 */

import type { UserEncryptionConfig } from '~~/shared/types/encryption'

export const useEncryptionStore = defineStore('encryption', () => {
    /**
     * 状态
     */
    const loading = ref(false)
    const error = ref<string | null>(null)

    // 用户加密配置
    const config = ref<UserEncryptionConfig | null>(null)

    // 获取 useAgeCrypto 的解锁状态
    const { isUnlocked: cryptoIsUnlocked, restoreIdentity, lockIdentity: cryptoLockIdentity } = useAgeCrypto()

    // 私钥是否已解锁（从 useAgeCrypto 获取）
    const isUnlocked = computed(() => cryptoIsUnlocked.value)

    /**
     * 计算属性：是否已配置加密
     */
    const hasEncryption = computed(() => !!config.value?.recipient)

    /**
     * 计算属性：是否有恢复密钥
     */
    const hasRecoveryKey = computed(() => !!config.value?.hasRecoveryKey)

    /**
     * 获取用户加密配置并恢复解锁状态
     * @returns 加密配置或 null
     */
    const fetchConfig = async (): Promise<UserEncryptionConfig | null> => {
        loading.value = true
        error.value = null

        try {
            const data = await useApiFetch<UserEncryptionConfig | null>(
                '/api/v1/encryption/config',
                {
                    method: 'GET',
                    showError: false,
                }
            )
            loading.value = false
            config.value = data
            logger.debug('encryptionStore.fetchConfig: 获取到配置', data)
            logger.debug('encryptionStore.fetchConfig: hasEncryption =', !!data?.recipient)

            // 尝试从 IndexedDB 恢复私钥解锁状态
            if (data?.recipient) {
                await restoreIdentity()
            }

            return data
        } catch (err: unknown) {
            loading.value = false
            const errorMessage = err instanceof Error ? err.message : '获取加密配置失败'
            error.value = errorMessage
            logger.error('获取加密配置失败:', err)
            return null
        }
    }

    /**
     * 保存用户加密配置（首次设置）
     * @param recipient 公钥
     * @param encryptedIdentity 加密后的私钥
     * @param encryptedRecoveryKey 恢复密钥加密的私钥（可选）
     * @returns 是否成功
     */
    const saveConfig = async (
        recipient: string,
        encryptedIdentity: string,
        encryptedRecoveryKey?: string
    ): Promise<boolean> => {
        loading.value = true
        error.value = null

        try {
            const result = await useApiFetch<{ success: boolean }>(
                '/api/v1/encryption/config',
                {
                    method: 'POST',
                    body: {
                        recipient,
                        encryptedIdentity,
                        encryptedRecoveryKey,
                    },
                    showError: false,
                }
            )
            loading.value = false

            // 检查返回值，只有成功才更新本地配置
            if (result) {
                config.value = {
                    recipient,
                    encryptedIdentity,
                    hasRecoveryKey: !!encryptedRecoveryKey,
                }
                return true
            }
            return false
        } catch (err: unknown) {
            loading.value = false
            const errorMessage = err instanceof Error ? err.message : '保存加密配置失败'
            error.value = errorMessage
            logger.error('保存加密配置失败:', err)
            return false
        }
    }

    /**
     * 更新加密配置（修改密码）
     * @param encryptedIdentity 新的加密后的私钥
     * @param encryptedRecoveryKey 新的恢复密钥加密的私钥（可选）
     * @returns 是否成功
     */
    const updateConfig = async (
        encryptedIdentity: string,
        encryptedRecoveryKey?: string
    ): Promise<boolean> => {
        loading.value = true
        error.value = null

        try {
            const result = await useApiFetch<{ success: boolean }>(
                '/api/v1/encryption/config',
                {
                    method: 'PUT',
                    body: {
                        encryptedIdentity,
                        encryptedRecoveryKey,
                    },
                    showError: false,
                }
            )
            loading.value = false

            // 检查返回值，只有成功才更新本地配置
            if (result) {
                if (config.value) {
                    config.value.encryptedIdentity = encryptedIdentity
                    config.value.hasRecoveryKey = !!encryptedRecoveryKey
                }
                return true
            }
            return false
        } catch (err: unknown) {
            loading.value = false
            const errorMessage = err instanceof Error ? err.message : '更新加密配置失败'
            error.value = errorMessage
            logger.error('更新加密配置失败:', err)
            return false
        }
    }

    /**
     * 使用恢复密钥重置密码
     * @param newEncryptedIdentity 新的加密后的私钥
     * @param newEncryptedRecoveryKey 新的恢复密钥加密的私钥（可选）
     * @returns 是否成功
     */
    const resetWithRecoveryKey = async (
        newEncryptedIdentity: string,
        newEncryptedRecoveryKey?: string
    ): Promise<boolean> => {
        loading.value = true
        error.value = null

        try {
            const result = await useApiFetch<{ success: boolean }>(
                '/api/v1/encryption/recovery',
                {
                    method: 'POST',
                    body: {
                        newEncryptedIdentity,
                        newEncryptedRecoveryKey,
                    },
                    showError: false,
                }
            )
            loading.value = false

            // 检查返回值，只有成功才更新本地配置
            if (result) {
                if (config.value) {
                    config.value.encryptedIdentity = newEncryptedIdentity
                    config.value.hasRecoveryKey = !!newEncryptedRecoveryKey
                }
                return true
            }
            return false
        } catch (err: unknown) {
            loading.value = false
            const errorMessage = err instanceof Error ? err.message : '密码重置失败'
            error.value = errorMessage
            logger.error('密码重置失败:', err)
            return false
        }
    }

    /**
     * 设置私钥解锁状态
     * @param unlocked 是否已解锁
     * @deprecated 解锁状态现在由 useAgeCrypto 自动管理
     */
    const setUnlocked = (_unlocked: boolean) => {
        // 解锁状态现在由 useAgeCrypto 管理，此方法保留以兼容旧代码
        // 实际的解锁/锁定操作应通过 useAgeCrypto 的 unlockIdentity/lockIdentity 方法
    }

    /**
     * 清除加密配置（登出时调用）
     */
    const clearConfig = async () => {
        config.value = null
        error.value = null
        // 同时清除 IndexedDB 中的私钥
        await cryptoLockIdentity()
    }

    return {
        // 状态
        loading,
        error,
        config,
        isUnlocked,

        // 计算属性
        hasEncryption,
        hasRecoveryKey,

        // 方法
        fetchConfig,
        saveConfig,
        updateConfig,
        resetWithRecoveryKey,
        setUnlocked,
        clearConfig,
    }
})

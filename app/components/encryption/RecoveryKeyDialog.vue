<template>
    <Dialog v-model:open="isOpen">
        <DialogContent class="sm:max-w-lg">
            <DialogHeader>
                <DialogTitle>{{ mode === 'generate' ? '生成恢复密钥' : '使用恢复密钥' }}</DialogTitle>
                <DialogDescription>
                    {{ mode === 'generate'
                        ? '恢复密钥可以在忘记密码时用于重置加密密码。请妥善保管。'
                        : '输入恢复密钥来重置您的加密密码。'
                    }}
                </DialogDescription>
            </DialogHeader>

            <!-- 生成恢复密钥模式 -->
            <div v-if="mode === 'generate'" class="space-y-4">
                <!-- 需要先输入当前密码 -->
                <div v-if="!recoveryKey" class="space-y-4">
                    <div class="space-y-2">
                        <Label for="currentPassword">当前加密密码</Label>
                        <Input id="currentPassword" v-model="currentPassword" type="password" placeholder="请输入当前加密密码"
                            :disabled="loading" />
                    </div>

                    <div v-if="error" class="text-sm text-destructive">
                        {{ error }}
                    </div>

                    <Button @click="generateRecoveryKey" :disabled="!currentPassword || loading" :loading="loading"
                        class="w-full">
                        生成恢复密钥
                    </Button>
                </div>

                <!-- 显示生成的恢复密钥 -->
                <div v-else class="space-y-4">
                    <div class="bg-amber-50 border border-amber-200 rounded-md p-4">
                        <p class="text-sm font-medium text-amber-800 mb-2">请妥善保存以下恢复密钥：</p>
                        <div class="bg-white border rounded p-3 font-mono text-sm break-all select-all">
                            {{ recoveryKey }}
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <Button variant="outline" @click="copyRecoveryKey" class="flex-1">
                            <CopyIcon class="h-4 w-4 mr-2" />
                            复制
                        </Button>
                        <Button variant="outline" @click="downloadRecoveryKey" class="flex-1">
                            <DownloadIcon class="h-4 w-4 mr-2" />
                            下载
                        </Button>
                    </div>

                    <div class="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                        <p class="font-medium mb-1">重要提示：</p>
                        <ul class="list-disc list-inside space-y-1">
                            <li>恢复密钥只显示一次，请立即保存</li>
                            <li>将恢复密钥存储在安全的地方</li>
                            <li>不要与他人分享恢复密钥</li>
                        </ul>
                    </div>

                    <Button @click="confirmSaved" class="w-full">
                        我已保存恢复密钥
                    </Button>
                </div>
            </div>

            <!-- 使用恢复密钥模式 -->
            <form v-else @submit.prevent="handleRecover" class="space-y-4">
                <div class="space-y-2">
                    <Label for="recoveryKeyInput">恢复密钥</Label>
                    <Textarea id="recoveryKeyInput" v-model="recoveryKeyInput" placeholder="请输入恢复密钥" :disabled="loading"
                        rows="3" class="font-mono text-sm" />
                </div>

                <div class="space-y-2">
                    <Label for="newPassword">新密码</Label>
                    <Input id="newPassword" v-model="newPassword" type="password" placeholder="请输入新密码（至少8位）"
                        :disabled="loading" />
                </div>

                <div class="space-y-2">
                    <Label for="confirmNewPassword">确认新密码</Label>
                    <Input id="confirmNewPassword" v-model="confirmNewPassword" type="password" placeholder="请再次输入新密码"
                        :disabled="loading" />
                </div>

                <div v-if="error" class="text-sm text-destructive">
                    {{ error }}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" @click="handleCancel" :disabled="loading">
                        取消
                    </Button>
                    <Button type="submit" :disabled="!canRecover" :loading="loading">
                        重置密码
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
/**
 * 恢复密钥对话框组件
 * 
 * 支持两种模式：
 * 1. generate - 生成恢复密钥
 * 2. recover - 使用恢复密钥重置密码
 */

import { CopyIcon, DownloadIcon } from 'lucide-vue-next'

const props = defineProps<{
    /** 是否显示对话框 */
    open?: boolean
    /** 模式：generate 生成恢复密钥，recover 使用恢复密钥 */
    mode?: 'generate' | 'recover'
}>()

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void
    (e: 'success'): void
    (e: 'cancel'): void
}>()

const { decryptIdentity, encryptIdentity } = useAgeCrypto()
const encryptionStore = useEncryptionStore()

// 状态
const isOpen = computed({
    get: () => props.open ?? false,
    set: (value) => emit('update:open', value)
})

// 生成模式状态
const currentPassword = ref('')
const recoveryKey = ref('')

// 恢复模式状态
const recoveryKeyInput = ref('')
const newPassword = ref('')
const confirmNewPassword = ref('')

// 通用状态
const loading = ref(false)
const error = ref('')

// 计算属性：是否可以恢复
const canRecover = computed(() => {
    return recoveryKeyInput.value.length > 0 &&
        newPassword.value.length >= 8 &&
        newPassword.value === confirmNewPassword.value &&
        !loading.value
})

/**
 * 生成恢复密钥
 */
const generateRecoveryKey = async () => {
    if (!currentPassword.value) {
        error.value = '请输入当前密码'
        return
    }

    if (!encryptionStore.config?.encryptedIdentity) {
        error.value = '未找到加密配置'
        return
    }

    loading.value = true
    error.value = ''

    try {
        // 用当前密码解密私钥
        const identity = await decryptIdentity(
            encryptionStore.config.encryptedIdentity,
            currentPassword.value
        )

        // 生成随机恢复密钥（32字节，Base64编码）
        const randomBytes = new Uint8Array(32)
        crypto.getRandomValues(randomBytes)
        const generatedRecoveryKey = btoa(String.fromCharCode(...randomBytes))

        // 用恢复密钥加密私钥
        const encryptedRecoveryKey = await encryptIdentity(identity, generatedRecoveryKey)

        // 保存到服务器
        const success = await encryptionStore.updateConfig(
            encryptionStore.config.encryptedIdentity,
            encryptedRecoveryKey
        )

        if (!success) {
            throw new Error(encryptionStore.error || '保存恢复密钥失败')
        }

        recoveryKey.value = generatedRecoveryKey
        toast.success('恢复密钥生成成功')
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        if (errorMessage.includes('密码错误') || errorMessage.includes('passphrase') || errorMessage.includes('incorrect')) {
            error.value = '密码错误，请重试'
        } else {
            error.value = errorMessage || '生成失败，请重试'
        }
        logger.error('生成恢复密钥失败:', err)
    } finally {
        loading.value = false
    }
}

/**
 * 复制恢复密钥
 */
const copyRecoveryKey = async () => {
    try {
        await navigator.clipboard.writeText(recoveryKey.value)
        toast.success('已复制到剪贴板')
    } catch {
        toast.error('复制失败，请手动复制')
    }
}

/**
 * 下载恢复密钥
 */
const downloadRecoveryKey = () => {
    const blob = new Blob([recoveryKey.value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'encryption-recovery-key.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('恢复密钥已下载')
}

/**
 * 确认已保存恢复密钥
 */
const confirmSaved = () => {
    emit('success')
    isOpen.value = false
    resetForm()
}

/**
 * 使用恢复密钥重置密码
 */
const handleRecover = async () => {
    if (!recoveryKeyInput.value) {
        error.value = '请输入恢复密钥'
        return
    }

    if (newPassword.value.length < 8) {
        error.value = '新密码至少需要 8 个字符'
        return
    }

    if (newPassword.value !== confirmNewPassword.value) {
        error.value = '两次输入的密码不一致'
        return
    }

    if (!encryptionStore.config?.hasRecoveryKey) {
        error.value = '未设置恢复密钥'
        return
    }

    loading.value = true
    error.value = ''

    try {
        // 获取完整的加密配置（包含恢复密钥加密的私钥）
        await encryptionStore.fetchConfig()

        if (!encryptionStore.config?.encryptedIdentity) {
            throw new Error('未找到加密配置')
        }

        // 尝试用恢复密钥解密私钥
        // 注意：这里需要服务端返回 encryptedRecoveryKey，但当前 API 只返回 hasRecoveryKey
        // 实际实现中需要调整 API 或使用专门的恢复接口

        // 用恢复密钥解密私钥（假设服务端有专门的接口）
        const identity = await decryptIdentity(
            encryptionStore.config.encryptedIdentity,
            recoveryKeyInput.value
        )

        // 用新密码重新加密私钥
        const newEncryptedIdentity = await encryptIdentity(identity, newPassword.value)

        // 生成新的恢复密钥
        const randomBytes = new Uint8Array(32)
        crypto.getRandomValues(randomBytes)
        const newRecoveryKey = btoa(String.fromCharCode(...randomBytes))
        const newEncryptedRecoveryKey = await encryptIdentity(identity, newRecoveryKey)

        // 保存到服务器
        const success = await encryptionStore.resetWithRecoveryKey(
            newEncryptedIdentity,
            newEncryptedRecoveryKey
        )

        if (!success) {
            throw new Error(encryptionStore.error || '重置密码失败')
        }

        toast.success('密码重置成功')
        emit('success')
        isOpen.value = false
        resetForm()
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        if (errorMessage.includes('密码错误') || errorMessage.includes('passphrase') || errorMessage.includes('incorrect')) {
            error.value = '恢复密钥无效，请检查后重试'
        } else {
            error.value = errorMessage || '重置失败，请重试'
        }
        logger.error('使用恢复密钥重置密码失败:', err)
    } finally {
        loading.value = false
    }
}

/**
 * 处理取消
 */
const handleCancel = () => {
    emit('cancel')
    isOpen.value = false
    resetForm()
}

/**
 * 重置表单
 */
const resetForm = () => {
    currentPassword.value = ''
    recoveryKey.value = ''
    recoveryKeyInput.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
    error.value = ''
}

// 监听对话框关闭时重置表单
watch(isOpen, (value) => {
    if (!value) {
        resetForm()
    }
})
</script>

<template>
    <Dialog v-model:open="isOpen">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>设置加密密码</DialogTitle>
                <DialogDescription>
                    设置一个密码来保护您的加密密钥。此密码用于加密您的私钥，请妥善保管。
                </DialogDescription>
            </DialogHeader>

            <form @submit.prevent="handleSubmit" class="space-y-4">
                <!-- 密码输入 -->
                <div class="space-y-2">
                    <Label for="password">加密密码</Label>
                    <Input id="password" v-model="password" type="password" placeholder="请输入加密密码" :disabled="loading" />
                </div>

                <!-- 确认密码 -->
                <div class="space-y-2">
                    <Label for="confirmPassword">确认密码</Label>
                    <Input id="confirmPassword" v-model="confirmPassword" type="password" placeholder="请再次输入密码"
                        :disabled="loading" />
                </div>

                <!-- 错误提示 -->
                <div v-if="error" class="text-sm text-destructive">
                    {{ error }}
                </div>

                <!-- 提示信息 -->
                <div class="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                    <p class="font-medium mb-1">注意事项：</p>
                    <ul class="list-disc list-inside space-y-1">
                        <li>密码至少需要 8 个字符</li>
                        <li>忘记密码将无法解密已加密的文件</li>
                        <li>建议使用强密码并妥善保管</li>
                    </ul>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" @click="handleCancel" :disabled="loading">
                        取消
                    </Button>
                    <Button type="submit" :disabled="!canSubmit" :loading="loading">
                        确认设置
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
/**
 * 加密设置对话框组件
 * 
 * 用于首次设置加密密码，生成密钥对并用密码加密私钥
 */

const props = defineProps<{
    /** 是否显示对话框 */
    open?: boolean
}>()

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void
    (e: 'success'): void
    (e: 'cancel'): void
}>()

const { generateKeyPair, encryptIdentity } = useAgeCrypto()
const encryptionStore = useEncryptionStore()

// 状态
const isOpen = computed({
    get: () => props.open ?? false,
    set: (value) => emit('update:open', value)
})
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')

// 计算属性：是否可以提交
const canSubmit = computed(() => {
    return password.value.length >= 8 &&
        password.value === confirmPassword.value &&
        !loading.value
})

/**
 * 处理表单提交
 */
const handleSubmit = async () => {
    // 验证密码
    if (password.value.length < 8) {
        error.value = '密码至少需要 8 个字符'
        return
    }

    if (password.value !== confirmPassword.value) {
        error.value = '两次输入的密码不一致'
        return
    }

    loading.value = true
    error.value = ''

    try {
        // 生成密钥对
        const keyPair = await generateKeyPair()

        // 用密码加密私钥
        const encryptedIdentity = await encryptIdentity(keyPair.identity, password.value)

        // 保存到服务器
        const success = await encryptionStore.saveConfig(
            keyPair.recipient,
            encryptedIdentity
        )

        if (!success) {
            throw new Error(encryptionStore.error || '保存加密配置失败')
        }

        toast.success('加密密码设置成功')
        emit('success')
        isOpen.value = false
        resetForm()
    } catch (err) {
        error.value = err instanceof Error ? err.message : '设置失败，请重试'
        logger.error('设置加密密码失败:', err)
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
    password.value = ''
    confirmPassword.value = ''
    error.value = ''
}

// 监听对话框关闭时重置表单
watch(isOpen, (value) => {
    if (!value) {
        resetForm()
    }
})
</script>

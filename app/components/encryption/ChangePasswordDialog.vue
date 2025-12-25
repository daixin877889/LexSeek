<template>
    <Dialog v-model:open="isOpen">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>修改加密密码</DialogTitle>
                <DialogDescription>
                    输入旧密码验证身份，然后设置新的加密密码。
                </DialogDescription>
            </DialogHeader>

            <form @submit.prevent="handleSubmit" class="space-y-4">
                <!-- 隐藏的用户名字段（用于可访问性） -->
                <input type="text" name="username" autocomplete="username" class="sr-only" tabindex="-1"
                    aria-hidden="true" />

                <!-- 旧密码 -->
                <div class="space-y-2">
                    <Label for="oldPassword">当前密码</Label>
                    <Input id="oldPassword" v-model="oldPassword" type="password" placeholder="请输入当前密码"
                        :disabled="loading" autocomplete="current-password" />
                </div>

                <!-- 新密码 -->
                <div class="space-y-2">
                    <Label for="newPassword">新密码</Label>
                    <Input id="newPassword" v-model="newPassword" type="password" placeholder="请输入新密码"
                        :disabled="loading" autocomplete="new-password" />
                </div>

                <!-- 确认新密码 -->
                <div class="space-y-2">
                    <Label for="confirmPassword">确认新密码</Label>
                    <Input id="confirmPassword" v-model="confirmPassword" type="password" placeholder="请再次输入新密码"
                        :disabled="loading" autocomplete="new-password" />
                </div>

                <!-- 错误提示 -->
                <div v-if="error" class="text-sm text-destructive">
                    {{ error }}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" @click="handleCancel" :disabled="loading">
                        取消
                    </Button>
                    <Button type="submit" :disabled="!canSubmit || loading" :loading="loading">
                        {{ loading ? "修改中..." : "确认修改" }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
/**
 * 修改密码对话框组件
 * 
 * 用于修改加密密码，需要先验证旧密码
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

const { decryptIdentity, encryptIdentity } = useAgeCrypto()
const encryptionStore = useEncryptionStore()

// 状态
const isOpen = computed({
    get: () => props.open ?? false,
    set: (value) => emit('update:open', value)
})
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')

// 计算属性：是否可以提交
const canSubmit = computed(() => {
    return oldPassword.value.length > 0 &&
        newPassword.value.length >= 8 &&
        newPassword.value === confirmPassword.value &&
        !loading.value
})

/**
 * 处理表单提交
 */
const handleSubmit = async () => {
    // 验证输入
    if (!oldPassword.value) {
        error.value = '请输入当前密码'
        return
    }

    if (newPassword.value.length < 8) {
        error.value = '新密码至少需要 8 个字符'
        return
    }

    if (newPassword.value !== confirmPassword.value) {
        error.value = '两次输入的新密码不一致'
        return
    }

    if (!encryptionStore.config?.encryptedIdentity) {
        error.value = '未找到加密配置'
        return
    }

    loading.value = true
    error.value = ''

    try {
        // 用旧密码解密私钥
        const identity = await decryptIdentity(
            encryptionStore.config.encryptedIdentity,
            oldPassword.value
        )

        // 用新密码重新加密私钥
        const newEncryptedIdentity = await encryptIdentity(identity, newPassword.value)

        // 更新到服务器
        const success = await encryptionStore.updateConfig(newEncryptedIdentity)

        if (!success) {
            throw new Error(encryptionStore.error || '更新加密配置失败')
        }

        toast.success('加密密码修改成功')
        emit('success')
        isOpen.value = false
        resetForm()
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        if (errorMessage.includes('密码错误') || errorMessage.includes('passphrase') || errorMessage.includes('incorrect')) {
            error.value = '当前密码错误，请重试'
        } else {
            error.value = errorMessage || '修改失败，请重试'
        }
        logger.error('修改加密密码失败:', err)
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
    oldPassword.value = ''
    newPassword.value = ''
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

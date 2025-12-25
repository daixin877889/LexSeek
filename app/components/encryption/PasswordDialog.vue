<template>
    <Dialog v-model:open="isOpen">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>输入加密密码</DialogTitle>
                <DialogDescription>
                    请输入您的加密密码来解锁私钥，以便解密文件。
                </DialogDescription>
            </DialogHeader>

            <form @submit.prevent="handleSubmit" class="space-y-4">
                <!-- 隐藏的用户名字段（用于可访问性） -->
                <input type="text" name="username" autocomplete="username" class="sr-only" tabindex="-1"
                    aria-hidden="true" />

                <!-- 密码输入 -->
                <div class="space-y-2">
                    <Label for="password">加密密码</Label>
                    <Input id="password" v-model="password" type="password" placeholder="请输入加密密码" :disabled="loading"
                        autocomplete="current-password" />
                </div>

                <!-- 错误提示 -->
                <div v-if="error" class="text-sm text-destructive">
                    {{ error }}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" @click="handleCancel" :disabled="loading">
                        取消
                    </Button>
                    <Button type="submit" :disabled="!password || loading" :loading="loading">
                        {{ loading ? "解锁中..." : "解锁" }}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
/**
 * 密码输入对话框组件
 * 
 * 用于解密时输入密码解锁私钥
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

const { unlockIdentity } = useAgeCrypto()
const encryptionStore = useEncryptionStore()

// 状态
const isOpen = computed({
    get: () => props.open ?? false,
    set: (value) => emit('update:open', value)
})
const password = ref('')
const loading = ref(false)
const error = ref('')

/**
 * 处理表单提交
 */
const handleSubmit = async () => {
    if (!password.value) {
        error.value = '请输入密码'
        return
    }

    if (!encryptionStore.config?.encryptedIdentity) {
        error.value = '未找到加密配置'
        return
    }

    loading.value = true
    error.value = ''

    try {
        // 解锁私钥（会自动保存到 IndexedDB）
        await unlockIdentity(encryptionStore.config.encryptedIdentity, password.value)

        toast.success('私钥解锁成功')
        emit('success')
        isOpen.value = false
        resetForm()
    } catch (err) {
        // 检查是否是密码错误
        const errorMessage = err instanceof Error ? err.message : String(err)
        if (errorMessage.includes('密码错误') || errorMessage.includes('passphrase') || errorMessage.includes('incorrect')) {
            error.value = '密码错误，请重试'
        } else {
            error.value = '解锁失败，请重试'
        }
        logger.error('解锁私钥失败:', err)
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
    error.value = ''
}

// 监听对话框关闭时重置表单
watch(isOpen, (value) => {
    if (!value) {
        resetForm()
    }
})
</script>

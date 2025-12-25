<template>
    <div class="bg-card rounded-lg border p-6">
        <h2 class="text-xl font-semibold mb-2">文件加密设置</h2>
        <p class="text-sm text-muted-foreground mb-6">启用端到端加密保护您的文件，只有您能查看文件内容。</p>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex items-center justify-center py-12">
            <Loader2Icon class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>

        <!-- 未设置加密 -->
        <div v-else-if="!encryptionStore.hasEncryption" class="space-y-6">
            <div class="bg-muted/50 rounded-lg p-6 text-center">
                <div class="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                    <ShieldIcon class="h-6 w-6 text-primary" />
                </div>
                <h3 class="text-lg font-medium mb-2">尚未开启文件加密</h3>
                <p class="text-sm text-muted-foreground mb-4">
                    设置一个加密密码，即可对上传的文件进行端到端加密保护。<br />
                    加密后的文件只有您能查看，即使服务器也无法读取。
                </p>
                <Button @click="showSetupDialog = true">
                    <LockIcon class="h-4 w-4 mr-2" />
                    开启文件加密
                </Button>
            </div>

            <!-- 功能说明 -->
            <div class="grid gap-4 md:grid-cols-3">
                <div class="p-4 border rounded-lg">
                    <div class="flex items-center gap-2 mb-2">
                        <KeyIcon class="h-5 w-5 text-primary" />
                        <span class="font-medium">本地加密</span>
                    </div>
                    <p class="text-sm text-muted-foreground">文件在您的设备上加密后再上传，服务器无法查看内容。</p>
                </div>
                <div class="p-4 border rounded-lg">
                    <div class="flex items-center gap-2 mb-2">
                        <ShieldCheckIcon class="h-5 w-5 text-primary" />
                        <span class="font-medium">端到端保护</span>
                    </div>
                    <p class="text-sm text-muted-foreground">采用先进的加密技术，确保只有您能解密查看文件。</p>
                </div>
                <div class="p-4 border rounded-lg">
                    <div class="flex items-center gap-2 mb-2">
                        <FileKeyIcon class="h-5 w-5 text-primary" />
                        <span class="font-medium">灵活选择</span>
                    </div>
                    <p class="text-sm text-muted-foreground">上传文件时可自由选择是否加密，按需保护重要文件。</p>
                </div>
            </div>
        </div>

        <!-- 已设置加密 -->
        <div v-else class="space-y-6">
            <!-- 加密状态卡片 -->
            <div class="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-4">
                <div class="flex items-center gap-3">
                    <div
                        class="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center">
                        <ShieldCheckIcon class="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                        <h3 class="font-medium text-green-800 dark:text-green-200">文件加密已开启</h3>
                        <p class="text-sm text-green-600 dark:text-green-400">您可以在上传文件时选择加密保护</p>
                    </div>
                </div>
            </div>

            <!-- 验证状态 -->
            <div class="p-4 border rounded-lg">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <div
                            :class="['w-10 h-10 rounded-full flex items-center justify-center shrink-0', encryptionStore.isUnlocked ? 'bg-green-100 dark:bg-green-900/50' : 'bg-amber-100 dark:bg-amber-900/50']">
                            <UnlockIcon v-if="encryptionStore.isUnlocked"
                                class="h-5 w-5 text-green-600 dark:text-green-400" />
                            <LockIcon v-else class="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p class="font-medium">
                                {{ encryptionStore.isUnlocked ? "已验证密码" : "需要验证密码" }}
                            </p>
                            <p class="text-sm text-muted-foreground">
                                {{ encryptionStore.isUnlocked ? "可以正常查看加密文件" : "输入加密密码后才能查看加密文件" }}
                            </p>
                        </div>
                    </div>
                    <div class="flex justify-end">
                        <Button v-if="encryptionStore.isUnlocked" variant="outline" @click="lockIdentity">
                            <LockIcon class="h-4 w-4 mr-2" />
                            解除验证
                        </Button>
                        <Button v-else variant="outline" @click="showPasswordDialog = true">
                            <UnlockIcon class="h-4 w-4 mr-2" />
                            验证密码
                        </Button>
                    </div>
                </div>
            </div>

            <!-- 修改密码 -->
            <div class="p-4 border rounded-lg">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center bg-muted shrink-0">
                            <KeyRoundIcon class="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                            <p class="font-medium">加密密码</p>
                            <p class="text-sm text-muted-foreground">用于加密和查看您的文件</p>
                        </div>
                    </div>
                    <div class="flex justify-end">
                        <Button variant="outline" size="sm" @click="showChangePasswordDialog = true"> 修改密码 </Button>
                    </div>
                </div>
            </div>

            <!-- 恢复密钥 -->
            <div class="p-4 border rounded-lg">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <div
                            :class="['w-10 h-10 rounded-full flex items-center justify-center shrink-0', encryptionStore.hasRecoveryKey ? 'bg-green-100 dark:bg-green-900/50' : 'bg-muted']">
                            <HelpCircleIcon
                                :class="['h-5 w-5', encryptionStore.hasRecoveryKey ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground']" />
                        </div>
                        <div>
                            <p class="font-medium">恢复密钥</p>
                            <p class="text-sm text-muted-foreground">
                                {{ encryptionStore.hasRecoveryKey ? "忘记密码时可使用恢复密钥重置" : "忘记密码时重置密码的唯一凭证，建议生成！" }}
                            </p>
                        </div>
                    </div>
                    <div class="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" @click="handleRecoveryKey">
                            {{ encryptionStore.hasRecoveryKey ? "重置恢复密钥" : "生成恢复密钥" }}
                        </Button>
                        <Button v-if="encryptionStore.hasRecoveryKey" variant="outline" size="sm"
                            @click="showRecoverDialog = true"> 忘记密码 </Button>
                    </div>
                </div>
            </div>

            <!-- 注意事项 -->
            <div class="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
                <div class="flex gap-3">
                    <AlertTriangleIcon class="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div class="text-sm">
                        <p class="font-medium text-amber-800 dark:text-amber-200 mb-1">请牢记您的密码</p>
                        <ul class="text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                            <li>加密密码无法找回，请妥善保管</li>
                            <li>可恢复密钥是唯一能重置密码的凭证，建议生成，以防忘记密码</li>
                            <li>如果忘记密码且未生成恢复密钥，将无法查看已加密的文件</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <!-- 对话框组件 -->
        <EncryptionSetupDialog v-model:open="showSetupDialog" @success="handleSetupSuccess" />

        <EncryptionPasswordDialog v-model:open="showPasswordDialog" @success="handleUnlockSuccess" />

        <EncryptionChangePasswordDialog v-model:open="showChangePasswordDialog"
            @success="handleChangePasswordSuccess" />

        <EncryptionRecoveryKeyDialog v-model:open="showRecoveryKeyDialog" :mode="recoveryKeyMode"
            @success="handleRecoveryKeySuccess" />
    </div>
</template>

<script lang="ts" setup>
/**
 * 文件加密设置页面
 *
 * 提供以下功能：
 * 1. 首次设置加密密码
 * 2. 查看加密状态
 * 3. 验证/退出验证密码
 * 4. 修改加密密码
 * 5. 生成/使用恢复密钥
 */

import { Loader2Icon, ShieldIcon, ShieldCheckIcon, LockIcon, UnlockIcon, KeyIcon, KeyRoundIcon, FileKeyIcon, AlertTriangleIcon, HelpCircleIcon } from "lucide-vue-next";

definePageMeta({
    title: "文件加密设置",
    layout: "dashboard-layout",
});

const encryptionStore = useEncryptionStore();
const { lockIdentity: lockIdentityFn } = useAgeCrypto();

// 加载状态
const loading = ref(true);

// 对话框状态
const showSetupDialog = ref(false);
const showPasswordDialog = ref(false);
const showChangePasswordDialog = ref(false);
const showRecoveryKeyDialog = ref(false);
const showRecoverDialog = ref(false);

// 找回方式对话框模式
const recoveryKeyMode = ref<"generate" | "recover">("generate");

/**
 * 初始化：获取加密配置
 */
onMounted(async () => {
    await encryptionStore.fetchConfig();
    loading.value = false;
});

/**
 * 退出验证（锁定）
 */
const lockIdentity = async () => {
    await lockIdentityFn();
    toast.success("已退出验证");
};

/**
 * 处理生成恢复密钥按钮点击
 */
const handleRecoveryKey = () => {
    recoveryKeyMode.value = "generate";
    showRecoveryKeyDialog.value = true;
};

/**
 * 设置成功回调
 */
const handleSetupSuccess = () => {
    toast.success("加密设置完成");
};

/**
 * 验证成功回调
 */
const handleUnlockSuccess = () => {
    // 验证状态已由 useAgeCrypto 自动保存
};

/**
 * 修改密码成功回调
 */
const handleChangePasswordSuccess = async () => {
    // 修改密码后需要重新验证
    await lockIdentityFn();
};

/**
 * 恢复密钥操作成功回调
 */
const handleRecoveryKeySuccess = () => {
    // 刷新配置
    encryptionStore.fetchConfig();
};

// 监听使用恢复密钥对话框
watch(showRecoverDialog, (value) => {
    if (value) {
        recoveryKeyMode.value = "recover";
        showRecoveryKeyDialog.value = true;
        showRecoverDialog.value = false;
    }
});
</script>

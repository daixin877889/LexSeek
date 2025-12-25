<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>开启文件加密</DialogTitle>
        <DialogDescription>设置端到端加密保护您的文件</DialogDescription>
      </DialogHeader>

      <!-- 步骤指示器 -->
      <Stepper v-model="currentStep" class="flex w-full items-start gap-2">
        <StepperItem v-for="step in steps" :key="step.step" :step="step.step"
          class="relative flex w-full flex-col items-center justify-center">
          <StepperSeparator v-if="step.step !== 3"
            class="absolute left-[calc(50%+20px)] right-[calc(-50%+10px)] top-5 block h-0.5 shrink-0 rounded-full bg-muted group-data-[state=completed]:bg-primary" />
          <StepperTrigger as-child>
            <Button :variant="currentStep === step.step ? 'default' : 'outline'" size="icon"
              class="z-10 shrink-0 rounded-full"
              :class="[currentStep === step.step && 'ring-2 ring-ring ring-offset-2 ring-offset-background']"
              :disabled="currentStep < step.step">
              <CheckIcon v-if="currentStep > step.step" class="size-4" />
              <component v-else :is="step.icon" class="size-4" />
            </Button>
          </StepperTrigger>
          <div class="mt-2 flex flex-col items-center text-center">
            <StepperTitle :class="[currentStep === step.step && 'text-primary']" class="text-xs font-medium">
              {{ step.title }}
            </StepperTitle>
          </div>
        </StepperItem>
      </Stepper>

      <!-- 步骤内容 -->
      <div class="mt-4">
        <!-- 步骤1：加密说明 -->
        <div v-if="currentStep === 1" class="space-y-4">
          <div class="bg-muted/50 rounded-lg p-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <ShieldIcon class="h-5 w-5 text-primary" />
              </div>
              <h3 class="font-medium">什么是文件加密？</h3>
            </div>
            <p class="text-sm text-muted-foreground mb-4">
              文件加密使用端到端加密技术，在您的设备上对文件进行加密后再上传到服务器。只有您持有解密密钥，即使服务器也无法查看文件内容。
            </p>
          </div>

          <div class="grid gap-3">
            <div class="flex items-start gap-3 p-3 border rounded-lg">
              <KeyIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p class="font-medium text-sm">本地加密</p>
                <p class="text-xs text-muted-foreground">文件在您的设备上加密后再上传</p>
              </div>
            </div>
            <div class="flex items-start gap-3 p-3 border rounded-lg">
              <ShieldCheckIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p class="font-medium text-sm">端到端保护</p>
                <p class="text-xs text-muted-foreground">只有您能解密查看文件内容</p>
              </div>
            </div>
            <div class="flex items-start gap-3 p-3 border rounded-lg">
              <FileKeyIcon class="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p class="font-medium text-sm">灵活选择</p>
                <p class="text-xs text-muted-foreground">上传时可自由选择是否加密</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <Button variant="outline" @click="handleCancel">取消</Button>
            <Button @click="currentStep = 2">下一步</Button>
          </div>
        </div>

        <!-- 步骤2：设置密码 -->
        <form v-else-if="currentStep === 2" @submit.prevent="handleSetPassword" class="space-y-4">
          <!-- 隐藏的用户名字段（用于可访问性） -->
          <input type="text" name="username" autocomplete="username" class="sr-only" tabindex="-1" aria-hidden="true" />

          <div class="space-y-2">
            <Label for="password">加密密码</Label>
            <Input id="password" v-model="password" type="password" placeholder="请输入加密密码（至少8位）" :disabled="loading"
              autocomplete="new-password" />
          </div>

          <div class="space-y-2">
            <Label for="confirmPassword">确认密码</Label>
            <Input id="confirmPassword" v-model="confirmPassword" type="password" placeholder="请再次输入密码"
              :disabled="loading" autocomplete="new-password" />
          </div>

          <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

          <div class="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
            <p class="font-medium mb-1">注意事项：</p>
            <ul class="list-disc list-inside space-y-1">
              <li>密码至少需要 8 个字符</li>
              <li>忘记密码将无法解密已加密的文件</li>
              <li>建议使用强密码并妥善保管</li>
            </ul>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" @click="currentStep = 1" :disabled="loading">上一步</Button>
            <Button type="submit" :disabled="!canSetPassword || loading" :loading="loading">
              {{ loading ? "设置中..." : "下一步" }}
            </Button>
          </div>
        </form>

        <!-- 步骤3：设置恢复密钥（可选） -->
        <div v-else-if="currentStep === 3" class="space-y-4">
          <!-- 未生成恢复密钥 -->
          <template v-if="!recoveryKey">
            <div
              class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 flex items-start gap-2">
              <AlertTriangleIcon class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p class="text-sm text-amber-800 dark:text-amber-200">
                恢复密钥是忘记密码时重置密码的唯一凭证，强烈建议生成！
              </p>
            </div>

            <div class="text-sm text-muted-foreground">
              <p>恢复密钥可以在您忘记密码时帮助您重置密码。如果您不生成恢复密钥，忘记密码后将无法查看已加密的文件。</p>
            </div>

            <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

            <div class="flex justify-end gap-2 pt-2">
              <Button variant="outline" @click="handleSkipRecoveryKey" :disabled="loading">跳过</Button>
              <Button @click="generateRecoveryKey" :disabled="loading" :loading="loading">
                {{ loading ? "生成中..." : "生成恢复密钥" }}
              </Button>
            </div>
          </template>

          <!-- 已生成恢复密钥 -->
          <template v-else>
            <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-4">
              <p class="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">请妥善保存以下恢复密钥：</p>
              <div class="bg-white dark:bg-gray-900 border rounded p-3 font-mono text-sm break-all select-all">
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

            <div
              class="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-md">
              <div class="flex items-start gap-2">
                <AlertTriangleIcon class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div class="text-amber-800 dark:text-amber-200">
                  <p class="font-medium mb-1">重要提示：</p>
                  <ul class="list-disc list-inside space-y-1">
                    <li>恢复密钥仅显示一次，请立即保存</li>
                    <li>恢复密钥仅能使用一次，使用后自动失效</li>
                    <li>请存储在安全的地方，不要分享给他人</li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="flex justify-end pt-2">
              <Button @click="handleComplete">完成设置</Button>
            </div>
          </template>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * 加密设置对话框组件
 *
 * 三步流程：
 * 1. 文件加密简要说明
 * 2. 设置加密密码
 * 3. 设置恢复密钥（可选）
 */

import { CheckIcon, ShieldIcon, ShieldCheckIcon, KeyIcon, FileKeyIcon, AlertTriangleIcon, CopyIcon, DownloadIcon, LockIcon, KeyRoundIcon } from "lucide-vue-next";

const props = defineProps<{
  /** 是否显示对话框 */
  open?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "success"): void;
  (e: "cancel"): void;
}>();

const { generateKeyPair, encryptIdentity } = useAgeCrypto();
const encryptionStore = useEncryptionStore();

// 步骤定义
const steps = [
  { step: 1, title: "了解加密", icon: ShieldIcon },
  { step: 2, title: "设置密码", icon: LockIcon },
  { step: 3, title: "恢复密钥", icon: KeyRoundIcon },
];

// 状态
const isOpen = computed({
  get: () => props.open ?? false,
  set: (value) => emit("update:open", value),
});

const currentStep = ref(1);
const password = ref("");
const confirmPassword = ref("");
const loading = ref(false);
const error = ref("");

// 生成的密钥对（步骤2完成后保存）
const generatedKeyPair = ref<{ recipient: string; identity: string } | null>(null);
const encryptedIdentityValue = ref("");
const recoveryKey = ref("");

// 计算属性：是否可以设置密码
const canSetPassword = computed(() => {
  return password.value.length >= 8 && password.value === confirmPassword.value && !loading.value;
});

/**
 * 步骤2：设置密码
 */
const handleSetPassword = async () => {
  if (password.value.length < 8) {
    error.value = "密码至少需要 8 个字符";
    return;
  }

  if (password.value !== confirmPassword.value) {
    error.value = "两次输入的密码不一致";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // 生成密钥对
    const keyPair = await generateKeyPair();
    generatedKeyPair.value = keyPair;

    // 用密码加密私钥
    encryptedIdentityValue.value = await encryptIdentity(keyPair.identity, password.value);

    // 进入步骤3
    currentStep.value = 3;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "设置失败，请重试";
    logger.error("设置加密密码失败:", err);
  } finally {
    loading.value = false;
  }
};

/**
 * 步骤3：生成恢复密钥
 */
const generateRecoveryKey = async () => {
  if (!generatedKeyPair.value) {
    error.value = "请先设置密码";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // 生成随机恢复密钥（32字节，Base64编码）
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const generatedRecoveryKey = btoa(String.fromCharCode(...randomBytes));

    // 用恢复密钥加密私钥
    const encryptedRecoveryKey = await encryptIdentity(generatedKeyPair.value.identity, generatedRecoveryKey);

    // 保存到服务器
    const success = await encryptionStore.saveConfig(
      generatedKeyPair.value.recipient,
      encryptedIdentityValue.value,
      encryptedRecoveryKey
    );

    if (!success) {
      throw new Error(encryptionStore.error || "保存加密配置失败");
    }

    recoveryKey.value = generatedRecoveryKey;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "生成恢复密钥失败";
    logger.error("生成恢复密钥失败:", err);
  } finally {
    loading.value = false;
  }
};

/**
 * 跳过恢复密钥设置
 */
const handleSkipRecoveryKey = async () => {
  if (!generatedKeyPair.value) {
    error.value = "请先设置密码";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // 保存到服务器（不设置恢复密钥）
    const success = await encryptionStore.saveConfig(
      generatedKeyPair.value.recipient,
      encryptedIdentityValue.value
    );

    if (!success) {
      throw new Error(encryptionStore.error || "保存加密配置失败");
    }

    toast.success("加密设置完成");
    emit("success");
    isOpen.value = false;
    resetForm();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "保存失败，请重试";
    logger.error("保存加密配置失败:", err);
  } finally {
    loading.value = false;
  }
};

/**
 * 复制恢复密钥
 */
const copyRecoveryKey = async () => {
  try {
    await navigator.clipboard.writeText(recoveryKey.value);
    toast.success("已复制到剪贴板");
  } catch {
    toast.error("复制失败，请手动复制");
  }
};

/**
 * 下载恢复密钥
 */
const downloadRecoveryKey = () => {
  const blob = new Blob([recoveryKey.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "encryption-recovery-key.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success("恢复密钥已下载");
};

/**
 * 完成设置
 */
const handleComplete = () => {
  toast.success("加密设置完成");
  emit("success");
  isOpen.value = false;
  resetForm();
};

/**
 * 处理取消
 */
const handleCancel = () => {
  emit("cancel");
  isOpen.value = false;
  resetForm();
};

/**
 * 重置表单
 */
const resetForm = () => {
  currentStep.value = 1;
  password.value = "";
  confirmPassword.value = "";
  error.value = "";
  generatedKeyPair.value = null;
  encryptedIdentityValue.value = "";
  recoveryKey.value = "";
};

// 监听对话框关闭时重置表单
watch(isOpen, (value) => {
  if (!value) {
    resetForm();
  }
});
</script>

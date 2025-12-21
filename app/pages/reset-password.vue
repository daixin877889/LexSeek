<template>
  <div class="min-h-screen bg-background flex">
    <!-- 左侧背景图 -->
    <general-auth-sidebar />

    <!-- 右侧重置密码区域 -->
    <div class="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 lg:flex-none lg:w-1/2">
      <div class="mx-auto w-full max-w-sm lg:w-96">
        <div class="text-center mb-8">
          <div class="flex justify-center items-center gap-2 mb-2">
            <scale-icon class="h-8 w-8 text-primary" />
            <h1 class="text-2xl font-bold">LexSeek</h1>
          </div>
          <h2 class="text-xl font-semibold">重置密码</h2>
        </div>

        <div class="bg-card border rounded-lg p-6 shadow-sm">
          <form @submit.prevent="handleResetPassword" class="space-y-5">
            <div>
              <label for="phone" class="block text-sm font-medium mb-1"> <span class="text-red-500 ml-0.5">*</span>手机号</label>
              <div class="relative w-full">
                <Input id="phone" v-model="formData.phone" type="tel" autocomplete="tel" required @input="phoneMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请输入您的手机号" />
                <Button type="button" @click="getVerificationCode" :disabled="isGettingCode || countdown > 0 || !validatePhone(formData.phone)" class="absolute right-0 top-0 h-10 px-3 py-2 bg-primary text-primary-foreground rounded-r-md rounded-l-none hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                  {{ countdown > 0 ? `${countdown}秒后重试` : "获取验证码" }}
                </Button>
              </div>
              <span v-show="errMsg.phone" class="text-red-500 ml-0.5 text-xs">{{ errMsg.phone }}</span>
            </div>

            <div>
              <label for="verificationCode" class="block text-sm font-medium mb-1"> <span class="text-red-500 ml-0.5">*</span>验证码</label>
              <Input id="verificationCode" v-model="formData.verificationCode" type="text" required @input="verificationCodeMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请输入短信验证码" />
              <span v-show="errMsg.verificationCode" class="text-red-500 ml-0.5 text-xs">{{ errMsg.verificationCode }}</span>
            </div>

            <div>
              <label for="password" class="block text-sm font-medium mb-1"> <span class="text-red-500 ml-0.5">*</span>密码</label>
              <div class="relative">
                <Input id="password" v-model="formData.password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" required @input="passwordMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请设置新密码" />
                <button type="button" @click="showPassword = !showPassword" class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  <eye-icon v-if="!showPassword" class="h-4 w-4" />
                  <eye-off-icon v-else class="h-4 w-4" />
                </button>
              </div>
              <span v-show="errMsg.password" class="text-red-500 ml-0.5 text-xs">{{ errMsg.password }}</span>
            </div>

            <div>
              <label for="confirmPassword" class="block text-sm font-medium mb-1"> <span class="text-red-500 ml-0.5">*</span>确认密码</label>
              <div class="relative">
                <Input id="confirmPassword" v-model="formData.confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" autocomplete="new-password" required @input="confirmPasswordMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请再次输入新密码" />
                <button type="button" @click="showConfirmPassword = !showConfirmPassword" class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  <eye-icon v-if="!showConfirmPassword" class="h-4 w-4" />
                  <eye-off-icon v-else class="h-4 w-4" />
                </button>
              </div>
              <span v-show="errMsg.confirmPassword" class="text-red-500 ml-0.5 text-xs">{{ errMsg.confirmPassword }}</span>
            </div>

            <div>
              <Button type="submit" :disabled="authStore.loading || !isFormValid" class="w-full flex h-10 justify-center items-center py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium">
                <loader-2 v-if="authStore.loading" class="w-4 h-4 mr-2 animate-spin" />
                {{ authStore.loading ? "重置中..." : "重置密码" }}
              </Button>
            </div>

            <!-- 错误信息显示 -->
            <div v-if="authStore.error" class="mt-2 text-center">
              <p class="text-sm text-red-500">{{ authStore.error }}</p>
            </div>
          </form>

          <div class="mt-6 text-center">
            <p class="text-sm text-muted-foreground">
              想起密码了?
              <NuxtLink to="/login" class="text-primary hover:underline font-medium"> 返回登录 </NuxtLink>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ScaleIcon, EyeIcon, EyeOffIcon, Loader2 } from "lucide-vue-next";

const router = useRouter();
const authStore = useAuthStore();

// 表单数据
const formData = reactive({
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
});

const errMsg = reactive({
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
});

// 统一表单验证函数
const validateField = (field) => {
  switch (field) {
    case "phone":
      errMsg.phone = !validatePhone(formData.phone) ? "请输入正确的手机号" : "";
      break;
    case "verificationCode":
      errMsg.verificationCode = !formData.verificationCode ? "请输入验证码" : "";
      break;
    case "password":
      errMsg.password = formData.password.length < 8 ? "请输入至少8位密码" : "";
      // 密码变更时同时校验确认密码
      if (formData.confirmPassword) {
        validateField("confirmPassword");
      }
      break;
    case "confirmPassword":
      errMsg.confirmPassword = formData.password !== formData.confirmPassword ? "输入的两次密码不一致" : "";
      break;
    default:
      // 验证所有字段
      validateField("phone");
      validateField("verificationCode");
      validateField("password");
      validateField("confirmPassword");
  }
};

const phoneMsg = () => validateField("phone");
const verificationCodeMsg = () => validateField("verificationCode");
const passwordMsg = () => validateField("password");
const confirmPasswordMsg = () => validateField("confirmPassword");

const showPassword = ref(false);
const showConfirmPassword = ref(false);

// 验证码相关
const isGettingCode = ref(false);
const countdown = ref(0);
let countdownTimer = null;

// 表单验证
const isFormValid = computed(() => {
  return formData.verificationCode && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && formData.password.length >= 8 && validatePhone(formData.phone);
});

// 获取验证码
const getVerificationCode = async () => {
  if (!validatePhone(formData.phone)) {
    authStore.error = "请输入正确的手机号格式";
    return;
  }

  isGettingCode.value = true;

  const isSuccess = await authStore.sendSmsCode({
    phone: formData.phone,
    type: "resetPassword",
  });

  if (isSuccess) {
    toast.success("验证码已发送");
    // 启动倒计时
    countdown.value = 60;
    countdownTimer = setInterval(() => {
      if (countdown.value > 0) {
        countdown.value--;
      } else {
        clearInterval(countdownTimer);
      }
    }, 1000);
  }

  isGettingCode.value = false;
};

// 重置密码处理
const handleResetPassword = async () => {
  // 清除之前的错误信息
  authStore.error = null;

  // 提交前验证所有字段
  validateField();

  // 表单验证
  if (!isFormValid.value) {
    // 找到第一个错误信息显示
    for (const key in errMsg) {
      if (errMsg[key]) {
        authStore.error = errMsg[key];
        return;
      }
    }
    authStore.error = "请完成所有必填项";
    return;
  }

  const isSuccess = await authStore.resetPassword({
    phone: formData.phone,
    code: formData.verificationCode,
    newPassword: formData.password,
  });

  if (isSuccess) {
    toast.success("密码重置成功，请登录");
    // 重置密码成功，跳转到登录页
    router.replace({
      path: "/login",
      query: { phone: formData.phone },
    });
  }
};

// 组件卸载时清除计时器
onBeforeUnmount(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
});
</script>

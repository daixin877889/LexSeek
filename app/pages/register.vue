<template>
  <div class="min-h-screen bg-background flex">
    <!-- 左侧背景图 -->
    <general-auth-sidebar />

    <!-- 右侧注册区域 -->
    <div class="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 lg:flex-none lg:w-1/2">
      <div class="mx-auto w-full max-w-sm lg:w-96">
        <div class="text-center mb-8">
          <div class="flex justify-center items-center gap-2 mb-2">
            <scale-icon class="h-8 w-8 text-primary" />
            <h1 class="text-2xl font-bold">LexSeek | <span class="text-xl">法索 AI </span></h1>
          </div>
          <h2 class="text-xl font-semibold">创建新账号</h2>
          <p class="text-muted-foreground mt-2">开始使用LexSeek进行AI辅助法律分析</p>
        </div>

        <div class="bg-card border rounded-lg p-6 shadow-sm">
          <!-- Tab导航 -->
          <Tabs v-model="activeTab" class="w-full">
            <TabsList class="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="miniprogram">小程序注册</TabsTrigger>
              <TabsTrigger value="website">网站注册</TabsTrigger>
            </TabsList>

            <!-- 小程序注册Tab -->
            <TabsContent value="miniprogram" class="mt-6">
              <div class="text-center space-y-4">
                <h3 class="text-lg font-medium mb-4">微信扫码注册</h3>
                <div class="flex justify-center">
                  <img src="/images/lsRegister.png" alt="小程序注册码" class="w-64 h-64 rounded-lg" />
                </div>
                <p class="text-sm text-muted-foreground">使用微信扫描上方二维码，进入小程序完成注册</p>
              </div>
              <div class="mt-6 text-center">
                <p class="text-sm text-muted-foreground">
                  已完成注册?
                  <NuxtLink to="#" @click="toLogin" class="text-primary hover:underline font-medium"> 立即登录 </NuxtLink>
                </p>
              </div>
            </TabsContent>

            <!-- 网站注册Tab -->
            <TabsContent value="website">
              <form @submit.prevent="handleRegister" class="space-y-5">
                <div>
                  <label for="name" class="block text-sm font-medium mb-1"> <span class="text-red-500 ml-0.5">*</span>姓名</label>
                  <Input id="name" v-model="formData.name" type="text" autocomplete="name" required @input="nameMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请输入您的姓名" />
                  <span v-show="errMsg.name" class="text-red-500 ml-0.5 text-xs">{{ errMsg.name }}</span>
                </div>

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
                  <div class="relative w-full">
                    <Input id="verificationCode" v-model="formData.verificationCode" type="text" required @input="verificationCodeMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请输入短信验证码" />
                    <!-- <Button type="button" @click="getVerificationCode" :disabled="isGettingCode || countdown > 0 || !validatePhone(formData.phone)" class="absolute right-0 top-0 h-10 px-3 py-2 bg-primary text-primary-foreground rounded-r-md rounded-l-none hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                      {{ countdown > 0 ? `${countdown}秒后重试` : "获取验证码" }}
                    </Button> -->
                  </div>
                  <span v-show="errMsg.verificationCode" class="text-red-500 ml-0.5 text-xs">{{ errMsg.verificationCode }}</span>
                  <!-- <div class="text-sm text-muted-foreground mt-2">尝试多次无法接收验证码？请点击 <a href="#" class="text-primary font-semibold underline" @click="wxSupportStore.showQrCode('/images/loginWx.jpg')">联系客服</a> 开通账号。</div> -->
                  <div class="text-sm text-muted-foreground mt-2">尝试多次无法接收验证码？请使用 <a class="text-primary font-semibold underline" href="#" @click.prevent="activeTab = 'miniprogram'">小程序注册</a>。</div>
                </div>

                <div>
                  <label for="password" class="block text-sm font-medium mb-1"> <span class="text-red-500 ml-0.5">*</span>密码</label>
                  <div class="relative">
                    <Input id="password" v-model="formData.password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" required @input="passwordMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请设置密码" />
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
                    <Input id="confirmPassword" v-model="formData.confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" autocomplete="new-password" required @input="confirmPasswordMsg" class="h-10 w-full px-3 py-2 border rounded-md text-base" placeholder="请再次输入密码" />
                    <button type="button" @click="showConfirmPassword = !showConfirmPassword" class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                      <eye-icon v-if="!showConfirmPassword" class="h-4 w-4" />
                      <eye-off-icon v-else class="h-4 w-4" />
                    </button>
                  </div>
                  <span v-show="errMsg.confirmPassword" class="text-red-500 ml-0.5 text-xs">{{ errMsg.confirmPassword }}</span>
                </div>

                <div class="flex items-center">
                  <div class="flex items-center space-x-2">
                    <Checkbox id="remember-me" v-model="formData.agreeTerms" />
                    <label for="remember-me" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      我已阅读并同意 <a target="_blank" href="/terms-of-use" class="text-primary hover:underline">服务条款</a>
                      和
                      <a target="_blank" href="/privacy-agreement" class="text-primary hover:underline">隐私政策</a>
                    </label>
                  </div>
                </div>

                <div>
                  <Button type="submit" :disabled="authStore.loading || !isFormValid" class="w-full flex h-10 justify-center items-center py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium">
                    <loader-2 v-if="authStore.loading" class="w-4 h-4 mr-2 animate-spin" />
                    {{ authStore.loading ? "注册中..." : "注册" }}
                  </Button>
                </div>

                <!-- 错误信息显示 -->
                <div v-if="errorMessage" class="mt-2 text-center">
                  <p class="text-sm text-red-500">{{ errorMessage }}</p>
                </div>
              </form>
              <div class="mt-6 text-center">
                <p class="text-sm text-muted-foreground">
                  已有账号?
                  <NuxtLink to="#" @click="toLogin" class="text-primary hover:underline font-medium"> 立即登录 </NuxtLink>
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ScaleIcon, EyeIcon, EyeOffIcon, Loader2 } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();

// Tab 相关状态
const activeTab = ref("miniprogram");

// 表单数据
const formData = reactive({
  name: "",
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
  agreeTerms: false,
});

const errMsg = reactive({
  name: "",
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
});

// 正确计算Unicode字符串长度的辅助函数
const getStringLength = (str) => {
  return [...(str || "")].length;
};

// 统一表单验证函数
const validateField = (field) => {
  switch (field) {
    case "name":
      errMsg.name = getStringLength(formData.name.trim()) < 2 ? "姓名最少2个字符" : "";
      break;
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
      validateField("name");
      validateField("phone");
      validateField("verificationCode");
      validateField("password");
      validateField("confirmPassword");
  }
};

// 添加延时处理，确保输入法完成输入后再验证
const nameMsg = () => {
  setTimeout(() => validateField("name"), 0);
};
const phoneMsg = () => validateField("phone");
const verificationCodeMsg = () => validateField("verificationCode");
const passwordMsg = () => validateField("password");
const confirmPasswordMsg = () => validateField("confirmPassword");

// 状态管理
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const errorMessage = ref("");
const authStore = useAuthStore();

// 验证码相关
const isGettingCode = ref(false);
const countdown = ref(0);
let countdownTimer = null;

// 获取URL中的邀请码
const invitedBy = computed(() => {
  return route.query.invitedBy || localStorage.getItem("invitedBy") || "";
});

onMounted(() => {
  // 缓存邀请码
  if (route.query.invitedBy) {
    localStorage.setItem("invitedBy", route.query.invitedBy);
  }
});

// 表单验证
const isFormValid = computed(() => {
  return getStringLength(formData.name.trim()) >= 2 && formData.verificationCode && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && formData.password.length >= 8 && formData.agreeTerms && validatePhone(formData.phone);
});

// 获取验证码
const getVerificationCode = async () => {
  if (!validatePhone(formData.phone)) {
    errorMessage.value = "请输入正确的手机号格式";
    return;
  }
  isGettingCode.value = true;
  errorMessage.value = "";

  const isSuccess = await authStore.sendSmsCode({
    phone: formData.phone,
    type: SmsType.REGISTER,
  });

  if (isSuccess) {
    toast.success("获取验证码成功");
    // 发送成功，启动倒计时
    countdown.value = 60;
    countdownTimer = setInterval(() => {
      if (countdown.value > 0) {
        countdown.value--;
      } else {
        clearInterval(countdownTimer);
      }
    }, 1000);
  } else {
    errorMessage.value = authStore.error || "获取验证码失败，请稍后再试";
  }

  isGettingCode.value = false;
};

// 注册处理
const handleRegister = async () => {
  // 清除之前的错误信息
  errorMessage.value = "";
  // 提交前验证所有字段
  validateField();
  // 表单验证
  if (!isFormValid.value) {
    // 找到第一个错误信息显示
    for (const key in errMsg) {
      if (errMsg[key]) {
        errorMessage.value = errMsg[key];
        return;
      }
    }
    // 如果没有具体错误信息但表单无效，显示通用错误
    if (!errorMessage.value) {
      if (!formData.agreeTerms) {
        errorMessage.value = "请阅读并同意服务条款和隐私政策";
      } else {
        errorMessage.value = "请完成所有必填项";
      }
    }
    return;
  }

  const isSuccess = await authStore.register({
    phone: formData.phone,
    code: formData.verificationCode,
    name: formData.name,
    password: formData.password,
    invitedBy: invitedBy.value || undefined,
  });

  if (isSuccess) {
    toast.success("注册成功");
    // 注册成功后重定向
    if (route.query.redirect) {
      router.replace(route.query.redirect);
    } else {
      router.replace("/dashboard");
    }
  } else {
    errorMessage.value = authStore.error || "注册失败，请稍后再试";
  }
};

// 跳转登录页面
const toLogin = () => {
  if (route.query.redirect) {
    router.replace(`/login?redirect=${route.query.redirect}`);
  } else {
    router.replace("/login");
  }
};

// 组件卸载时清除计时器
onBeforeUnmount(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
});
</script>

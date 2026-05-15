<template>
  <div class="theme-brand grid min-h-screen bg-background lg:grid-cols-2">
    <GeneralAuthSidebar />

    <div class="relative flex items-center justify-center bg-[image:var(--wash-page)] px-6 py-12">
      <div class="absolute right-4 top-4">
        <ClientOnly>
          <GeneralThemeToggle />
        </ClientOnly>
      </div>
      <ClientOnly>
        <AuthAliyunCaptchaHost scene="registerSms" />
      </ClientOnly>

      <div class="w-full max-w-[420px]">
        <div class="mb-6 flex items-center gap-2.5 lg:hidden">
          <img src="/logo.svg" alt="" class="size-9">
          <span translate="no" class="text-[18px] font-bold">
            LexSeek<span class="font-normal text-muted-foreground mx-1">｜</span><span class="font-semibold">法索 AI</span>
          </span>
        </div>

        <h3 class="mb-2 text-[28px] font-bold leading-[1.2]">创建新账号</h3>
        <p class="mb-7 text-[14.5px] leading-[1.5] text-muted-foreground">开始使用 LexSeek 进行 AI 辅助法律分析</p>

        <form class="flex flex-col gap-4" @submit.prevent="handleRegister">
          <div>
            <label for="name" class="mb-1.5 block text-[13.5px] font-medium">
              <span class="mr-0.5 text-red-500">*</span>姓名
            </label>
            <Input id="name" v-model="formData.name" type="text" autocomplete="name" placeholder="请输入您的姓名" @input="nameMsg" />
            <p v-show="errMsg.name" class="mt-1 text-[12px] text-red-500">{{ errMsg.name }}</p>
          </div>

          <div>
            <label for="phone" class="mb-1.5 block text-[13.5px] font-medium">
              <span class="mr-0.5 text-red-500">*</span>手机号
            </label>
            <Input id="phone" v-model="formData.phone" type="tel" autocomplete="tel" placeholder="请输入您的手机号" @input="phoneMsg" />
            <p v-show="errMsg.phone" class="mt-1 text-[12px] text-red-500">{{ errMsg.phone }}</p>
          </div>

          <div>
            <label for="verificationCode" class="mb-1.5 block text-[13.5px] font-medium">
              <span class="mr-0.5 text-red-500">*</span>验证码
            </label>
            <div class="flex gap-2.5">
              <Input
                id="verificationCode"
                v-model="formData.verificationCode"
                type="text"
                autocomplete="one-time-code"
                placeholder="请输入短信验证码"
                class="flex-1"
                @input="verificationCodeMsg"
              />
              <button
                type="button"
                :disabled="isGettingCode || isCoolingDown || !validatePhone(formData.phone)"
                class="shrink-0 whitespace-nowrap rounded-md border border-primary/40 px-3.5 text-[13px] font-semibold text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                @click="getVerificationCode"
              >{{ countdown > 0 ? `${countdown}秒后重试` : "获取验证码" }}</button>
            </div>
            <p v-show="errMsg.verificationCode" class="mt-1 text-[12px] text-red-500">{{ errMsg.verificationCode }}</p>
          </div>

          <div>
            <label for="password" class="mb-1.5 block text-[13.5px] font-medium">
              <span class="mr-0.5 text-red-500">*</span>密码
            </label>
            <div class="relative">
              <Input
                id="password"
                v-model="formData.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="请设置至少 8 位密码"
                class="pr-10"
                @input="passwordMsg"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="切换密码可见"
                @click="showPassword = !showPassword"
              >
                <EyeOffIcon v-if="showPassword" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-show="errMsg.password" class="mt-1 text-[12px] text-red-500">{{ errMsg.password }}</p>
          </div>

          <div>
            <label for="confirmPassword" class="mb-1.5 block text-[13.5px] font-medium">
              <span class="mr-0.5 text-red-500">*</span>确认密码
            </label>
            <div class="relative">
              <Input
                id="confirmPassword"
                v-model="formData.confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="请再次输入密码"
                class="pr-10"
                @input="confirmPasswordMsg"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="切换密码可见"
                @click="showConfirmPassword = !showConfirmPassword"
              >
                <EyeOffIcon v-if="showConfirmPassword" class="size-4" />
                <EyeIcon v-else class="size-4" />
              </button>
            </div>
            <p v-show="errMsg.confirmPassword" class="mt-1 text-[12px] text-red-500">{{ errMsg.confirmPassword }}</p>
          </div>

          <label class="flex cursor-pointer items-start gap-2 text-[13px] leading-[1.6] text-muted-foreground">
            <Checkbox id="agree-terms" v-model="formData.agreeTerms" class="mt-0.5" />
            <span>
              我已阅读并同意
              <a target="_blank" href="/terms-of-use" class="font-medium text-primary hover:underline">服务条款</a>
              和
              <a target="_blank" href="/privacy-agreement" class="font-medium text-primary hover:underline">隐私政策</a>
            </span>
          </label>

          <button
            type="submit"
            :disabled="authStore.loading || !isFormValid"
            class="mt-1 flex h-12 items-center justify-center gap-2 rounded-lg bg-linear-to-br from-[#1E9EED] to-[#090380] text-[15px] font-semibold text-white shadow-[0_14px_28px_-10px_rgba(9,3,128,0.4)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Loader2 v-if="authStore.loading" class="size-4 animate-spin" />
            {{ authStore.loading ? "注册中..." : "注册" }}
          </button>

          <p v-if="errorMessage" class="text-center text-[13px] text-red-500">{{ errorMessage }}</p>
        </form>

        <p class="mt-6 text-center text-[13px] text-muted-foreground">
          已有账号？
          <NuxtLink to="#" class="font-medium text-primary hover:underline" @click="toLogin">立即登录</NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { EyeIcon, EyeOffIcon, Loader2 } from "lucide-vue-next"
import { SmsType } from "#shared/types/sms"
import { validatePhone } from "#shared/utils/phone"
import toast from "#shared/utils/toast"
import AuthAliyunCaptchaHost from "~/components/auth/AliyunCaptchaHost.vue"
import GeneralThemeToggle from "~/components/general/ThemeToggle.vue"
import GeneralAuthSidebar from "~/components/general/authSidebar.vue"
import { useAliyunCaptcha } from "~/composables/useAliyunCaptcha"
import { useSmsCooldown } from "~/composables/useSmsCooldown"
import { useAuthStore } from "~/store/auth"
import { useSiteSeo } from "~/composables/useSiteSeo"

definePageMeta({
  layout: false,
  title: "注册",
})

useSiteSeo({
  title: "注册",
  description: "注册 LexSeek 法索 AI 账号，立即体验律师专属 AI 工作台。",
  path: "/register",
  noindex: true,
})

const route = useRoute()
const router = useRouter()

// 表单数据
const formData = reactive({
  name: "",
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
  agreeTerms: false,
})

const errMsg = reactive({
  name: "",
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
})

// 正确计算 Unicode 字符串长度的辅助函数
const getStringLength = (str) => {
  return [...(str || "")].length
}

// 统一表单验证函数
const validateField = (field) => {
  switch (field) {
    case "name":
      errMsg.name = getStringLength(formData.name.trim()) < 2 ? "姓名最少2个字符" : ""
      break
    case "phone":
      errMsg.phone = !validatePhone(formData.phone) ? "请输入正确的手机号" : ""
      break
    case "verificationCode":
      errMsg.verificationCode = !formData.verificationCode ? "请输入验证码" : ""
      break
    case "password":
      errMsg.password = formData.password.length < 8 ? "请输入至少8位密码" : ""
      if (formData.confirmPassword) {
        validateField("confirmPassword")
      }
      break
    case "confirmPassword":
      errMsg.confirmPassword = formData.password !== formData.confirmPassword ? "输入的两次密码不一致" : ""
      break
    default:
      validateField("name")
      validateField("phone")
      validateField("verificationCode")
      validateField("password")
      validateField("confirmPassword")
  }
}

// 添加延时处理，确保输入法完成输入后再验证
const nameMsg = () => {
  setTimeout(() => validateField("name"), 0)
}
const phoneMsg = () => validateField("phone")
const verificationCodeMsg = () => validateField("verificationCode")
const passwordMsg = () => validateField("password")
const confirmPasswordMsg = () => validateField("confirmPassword")

// 状态管理
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const errorMessage = ref("")
const authStore = useAuthStore()
const registerSmsCaptcha = useAliyunCaptcha("registerSms")

// 验证码相关
const isGettingCode = ref(false)
const { countdown, isCoolingDown, applyCooldown, getCooldownMessage } = useSmsCooldown(
  () => formData.phone,
  SmsType.REGISTER,
)

// 获取 URL 中的邀请码
const invitedBy = computed(() => {
  return route.query.invitedBy || localStorage.getItem("invitedBy") || ""
})

onMounted(() => {
  if (route.query.invitedBy) {
    localStorage.setItem("invitedBy", route.query.invitedBy)
  }
  registerSmsCaptcha.preload()
})

// 表单验证
const isFormValid = computed(() => {
  return getStringLength(formData.name.trim()) >= 2 && formData.verificationCode && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && formData.password.length >= 8 && formData.agreeTerms && validatePhone(formData.phone)
})

// 获取验证码
const getVerificationCode = async () => {
  if (!validatePhone(formData.phone)) {
    errorMessage.value = "请输入正确的手机号格式"
    return
  }

  if (isCoolingDown.value) {
    errorMessage.value = getCooldownMessage()
    return
  }

  isGettingCode.value = true
  errorMessage.value = ""

  try {
    const captchaVerifyParam = await registerSmsCaptcha.verify()
    const result = await authStore.sendSmsCode({
      phone: formData.phone,
      type: SmsType.REGISTER,
      captchaVerifyParam: captchaVerifyParam || undefined,
    })

    if (result.success) {
      if (result.retryAfterSec) {
        applyCooldown(result.retryAfterSec)
      }
      toast.success("获取验证码成功")
    } else {
      if (result.retryAfterSec) {
        applyCooldown(result.retryAfterSec)
      }
      errorMessage.value = result.retryAfterSec
        ? getCooldownMessage(result.message || "验证码获取频率过高，请稍后再试")
        : result.message || authStore.error || "获取验证码失败，请稍后再试"
    }
  } catch (captchaError) {
    errorMessage.value = captchaError?.message || "安全验证失败，请稍后再试"
  } finally {
    isGettingCode.value = false
  }
}

// 注册处理
const handleRegister = async () => {
  errorMessage.value = ""
  validateField()

  if (!isFormValid.value) {
    for (const key in errMsg) {
      if (errMsg[key]) {
        errorMessage.value = errMsg[key]
        return
      }
    }
    if (!errorMessage.value) {
      if (!formData.agreeTerms) {
        errorMessage.value = "请阅读并同意服务条款和隐私政策"
      } else {
        errorMessage.value = "请完成所有必填项"
      }
    }
    return
  }

  const isSuccess = await authStore.register({
    phone: formData.phone,
    code: formData.verificationCode,
    name: formData.name,
    password: formData.password,
    invitedBy: invitedBy.value || undefined,
  })

  if (isSuccess) {
    toast.success("注册成功")
    if (route.query.redirect) {
      router.replace(route.query.redirect)
    } else {
      router.replace("/dashboard")
    }
  } else {
    errorMessage.value = authStore.error || "注册失败，请稍后再试"
  }
}

// 跳转登录页面
const toLogin = () => {
  if (route.query.redirect) {
    router.replace({ path: "/login", query: { redirect: route.query.redirect } })
  } else {
    router.replace("/login")
  }
}
</script>

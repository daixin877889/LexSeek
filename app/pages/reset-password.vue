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
        <AuthAliyunCaptchaHost scene="resetPasswordSms" />
      </ClientOnly>

      <div class="w-full max-w-[420px]">
        <div class="mb-6 flex items-center gap-2.5 lg:hidden">
          <img src="/logo.svg" alt="" class="size-9">
          <span translate="no" class="text-[18px] font-bold">
            LexSeek<span class="font-normal text-muted-foreground mx-1">｜</span><span class="font-semibold">法索 AI</span>
          </span>
        </div>

        <NuxtLink
          to="/login"
          class="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ChevronLeft class="size-3.5" />
          返回登录
        </NuxtLink>

        <h3 class="mb-2 text-[28px] font-bold leading-[1.2]">重置密码</h3>
        <p class="mb-7 text-[14.5px] leading-[1.5] text-muted-foreground">通过手机号验证身份，即可设置新的登录密码</p>

        <form class="flex flex-col gap-4" @submit.prevent="handleResetPassword">
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
              <span class="mr-0.5 text-red-500">*</span>新密码
            </label>
            <div class="relative">
              <Input
                id="password"
                v-model="formData.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="请设置至少 8 位新密码"
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
                placeholder="请再次输入新密码"
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

          <button
            type="submit"
            :disabled="authStore.loading || !isFormValid"
            class="mt-1 flex h-12 items-center justify-center gap-2 rounded-lg bg-linear-to-br from-[#1E9EED] to-[#090380] text-[15px] font-semibold text-white shadow-[0_14px_28px_-10px_rgba(9,3,128,0.4)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Loader2 v-if="authStore.loading" class="size-4 animate-spin" />
            {{ authStore.loading ? "重置中..." : "重置密码" }}
          </button>

          <p v-if="authStore.error" class="text-center text-[13px] text-red-500">{{ authStore.error }}</p>
        </form>

        <p class="mt-7 text-center text-[13px] text-muted-foreground">
          想起密码了？
          <NuxtLink to="/login" class="font-medium text-primary hover:underline">返回登录</NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ChevronLeft, EyeIcon, EyeOffIcon, Loader2 } from "lucide-vue-next"
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
  title: "重置密码",
})

useSiteSeo({
  title: "重置密码",
  description: "重置您的 LexSeek 法索 AI 账号密码。",
  path: "/reset-password",
  noindex: true,
})

const router = useRouter()
const authStore = useAuthStore()
const resetPasswordSmsCaptcha = useAliyunCaptcha("resetPasswordSms")

// 表单数据
const formData = reactive({
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
})

const errMsg = reactive({
  phone: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
})

// 统一表单验证函数
const validateField = (field) => {
  switch (field) {
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
      validateField("phone")
      validateField("verificationCode")
      validateField("password")
      validateField("confirmPassword")
  }
}

const phoneMsg = () => validateField("phone")
const verificationCodeMsg = () => validateField("verificationCode")
const passwordMsg = () => validateField("password")
const confirmPasswordMsg = () => validateField("confirmPassword")

const showPassword = ref(false)
const showConfirmPassword = ref(false)

// 验证码相关
const isGettingCode = ref(false)
const { countdown, isCoolingDown, applyCooldown, getCooldownMessage } = useSmsCooldown(
  () => formData.phone,
  SmsType.RESET_PASSWORD,
)

onMounted(() => {
  resetPasswordSmsCaptcha.preload()
})

// 表单验证
const isFormValid = computed(() => {
  return formData.verificationCode && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && formData.password.length >= 8 && validatePhone(formData.phone)
})

// 获取验证码
const getVerificationCode = async () => {
  if (!validatePhone(formData.phone)) {
    authStore.error = "请输入正确的手机号格式"
    return
  }

  if (isCoolingDown.value) {
    authStore.error = getCooldownMessage()
    return
  }

  isGettingCode.value = true
  try {
    const captchaVerifyParam = await resetPasswordSmsCaptcha.verify()
    const result = await authStore.sendSmsCode({
      phone: formData.phone,
      type: SmsType.RESET_PASSWORD,
      captchaVerifyParam: captchaVerifyParam || undefined,
    })

    if (result.success) {
      if (result.retryAfterSec) {
        applyCooldown(result.retryAfterSec)
      }
      toast.success("验证码已发送")
    } else {
      if (result.retryAfterSec) {
        applyCooldown(result.retryAfterSec)
      }
      authStore.error = result.retryAfterSec
        ? getCooldownMessage(result.message || "验证码获取频率过高，请稍后再试")
        : result.message || authStore.error || "获取验证码失败"
    }
  } catch (captchaError) {
    authStore.error = captchaError?.message || "安全验证失败，请稍后再试"
  } finally {
    isGettingCode.value = false
  }
}

// 重置密码处理
const handleResetPassword = async () => {
  authStore.error = null
  validateField()

  if (!isFormValid.value) {
    for (const key in errMsg) {
      if (errMsg[key]) {
        authStore.error = errMsg[key]
        return
      }
    }
    authStore.error = "请完成所有必填项"
    return
  }

  const isSuccess = await authStore.resetPassword({
    phone: formData.phone,
    code: formData.verificationCode,
    newPassword: formData.password,
  })

  if (isSuccess) {
    toast.success("密码重置成功，请登录")
    router.replace({ path: "/login", query: { phone: formData.phone } })
  }
}
</script>

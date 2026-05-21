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
        <AuthAliyunCaptchaHost scene="passwordLogin" />
      </ClientOnly>

      <div class="w-full max-w-[420px]">
        <div class="mb-6 flex items-center gap-2.5 lg:hidden">
          <img src="/logo.svg" alt="" class="size-9">
          <span translate="no" class="text-[18px] font-bold">
            LexSeek<span class="font-normal text-muted-foreground mx-1">｜</span><span class="font-semibold">法索 AI</span>
          </span>
        </div>

        <h3 class="mb-2 text-[28px] font-bold leading-[1.2]">登录您的账号</h3>
        <p class="mb-8 text-[14.5px] leading-[1.5] text-muted-foreground">欢迎回来，请登录继续您的案件分析</p>

        <form class="flex flex-col gap-[18px]" @submit.prevent="handleLogin">
          <div>
            <label for="phone" class="mb-1.5 block text-[13.5px] font-medium">手机号</label>
            <Input id="phone" v-model="phone" type="tel" autocomplete="tel" placeholder="请输入您的手机号码" />
          </div>

          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label for="password" class="text-[13.5px] font-medium">密码</label>
              <NuxtLink to="/reset-password" class="text-[13px] font-medium text-primary hover:underline">忘记密码?</NuxtLink>
            </div>
            <div class="relative">
              <Input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="请输入您的密码"
                class="pr-10"
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
          </div>

          <label class="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-medium">
            <Checkbox id="remember-me" v-model="rememberMe" />
            记住我
          </label>

          <button
            type="submit"
            :disabled="authStore.loading"
            class="mt-1 flex h-12 items-center justify-center gap-2 rounded-lg bg-linear-to-br from-[#1E9EED] to-[#090380] text-[15px] font-semibold text-white shadow-[0_14px_28px_-10px_rgba(9,3,128,0.4)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Loader2 v-if="authStore.loading" class="size-4 animate-spin" />
            {{ authStore.loading ? "登录中..." : "登录" }}
          </button>

          <p v-if="authStore.error" class="text-center text-[13px] text-red-500">{{ authStore.error }}</p>
        </form>

        <p class="mt-7 text-center text-[13px] text-muted-foreground">
          还没有账号？
          <NuxtLink to="#" class="font-medium text-primary hover:underline" @click="toRegister">立即注册</NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { EyeIcon, EyeOffIcon, Loader2 } from "lucide-vue-next"
import toast from "#shared/utils/toast"
import AuthAliyunCaptchaHost from "~/components/auth/AliyunCaptchaHost.vue"
import GeneralThemeToggle from "~/components/general/ThemeToggle.vue"
import GeneralAuthSidebar from "~/components/general/authSidebar.vue"
import { useAliyunCaptcha } from "~/composables/useAliyunCaptcha"
import { useAuthStore } from "~/store/auth"
import { getRememberedAccount, rememberMeHandler } from "~/utils/auth"
import { useSiteSeo } from "~/composables/useSiteSeo"

definePageMeta({
  layout: false,
  title: "登录",
})

useSiteSeo({
  title: "登录",
  description: "登录您的 LexSeek 法索 AI 账号。",
  path: "/login",
  noindex: true,
})

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const passwordLoginCaptcha = useAliyunCaptcha("passwordLogin")

// 表单数据
const phone = ref("")
const password = ref("")
const showPassword = ref(false)

// 记住我
const rememberMe = ref(false)
watch(rememberMe, (newVal) => {
  rememberMeHandler(newVal, phone.value)
})

// 组件挂载时，检查是否有保存的账号信息
onMounted(() => {
  const savedAccount = getRememberedAccount()
  if (savedAccount) {
    phone.value = savedAccount
    rememberMe.value = true
  }
  passwordLoginCaptcha.preload()
})

// 登录处理
const handleLogin = async () => {
  authStore.error = null

  if (!phone.value || !password.value) {
    authStore.error = "请填写手机号和密码"
    return
  }

  try {
    let loginResult = await authStore.login({ phone: phone.value, password: password.value })

    if (!loginResult.success && loginResult.requiresCaptcha) {
      try {
        const captchaVerifyParam = await passwordLoginCaptcha.verify()
        loginResult = await authStore.login({
          phone: phone.value,
          password: password.value,
          captchaVerifyParam: captchaVerifyParam || undefined,
        })
      } catch (captchaError) {
        authStore.error = captchaError?.message || "请完成安全验证后重试"
        return
      }
    }

    if (!loginResult.success) {
      return
    }

    if (route.query.redirect && route.query.redirect !== "/") {
      router.replace({ path: route.query.redirect })
    } else {
      router.replace("/dashboard")
    }
    toast.success("登录成功")
    rememberMeHandler(rememberMe.value, phone.value)
  } catch (error) {
    logger.error("登录失败:", error)
    authStore.error = error.message || "登录失败，请检查您的手机号和密码"
  }
}

// 跳转注册页面
const toRegister = () => {
  if (route.query.redirect) {
    router.replace({ path: "/register", query: { redirect: route.query.redirect } })
  } else {
    router.replace("/register")
  }
}
</script>

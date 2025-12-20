<template>
  <div class="min-h-screen bg-background flex">
    <!-- 左侧背景图 -->
    <general-auth-sidebar />

    <!-- 右侧登录区域 -->
    <div class="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 lg:flex-none lg:w-1/2">
      <div class="mx-auto w-full max-w-sm lg:w-96">
        <div class="text-center mb-8">
          <div class="flex justify-center items-center gap-2 mb-2">
            <scale-icon class="h-8 w-8 text-primary" />
            <h1 class="text-2xl font-bold">LexSeek | <span class="text-xl">法索 AI </span></h1>
          </div>
          <h2 class="text-xl font-semibold">登录您的账号</h2>
          <p class="text-muted-foreground mt-2">欢迎回来，请登录您的账号</p>
        </div>

        <div class="bg-card border rounded-lg p-6 shadow-sm">
          <form @submit.prevent="handleLogin" class="space-y-5">
            <div>
              <label for="phone" class="block text-sm font-medium mb-1">手机号</label>
              <input id="phone" v-model="phone" type="tel" autocomplete="tel" required class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="请输入您的手机号码" />
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label for="password" class="block text-sm font-medium">密码</label>
                <router-link to="/reset-password" class="text-xs text-primary hover:underline"> 忘记密码? </router-link>
              </div>
              <div class="relative">
                <input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="请输入您的密码" />
                <button type="button" @click="showPassword = !showPassword" class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  <eye-icon v-if="!showPassword" class="h-4 w-4" />
                  <eye-off-icon v-else class="h-4 w-4" />
                </button>
              </div>
            </div>

            <div class="flex items-center">
              <div class="flex items-center space-x-2">
                <Checkbox id="remember-me" v-model="rememberMe" />
                <label for="remember-me" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"> 记住我 </label>
              </div>
            </div>

            <div>
              <Button type="submit" :disabled="false" class="h-11 w-full text-base flex justify-center items-center py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium">
                <loader-2 v-if="false" class="w-4 h-4 mr-2 animate-spin" />
                <!-- {{ userStore.loading ? "登录中..." : "登录" }} -->
                登录
              </Button>
            </div>

            <!-- 错误信息显示 -->
            <div v-if="false" class="mt-2 text-center">
              <p class="text-sm text-red-500">错误信息</p>
            </div>
          </form>

          <div class="mt-6 text-center">
            <p class="text-sm text-muted-foreground">
              还没有账号?
              <NuxtLink to="#" @click="toRegister" class="text-primary hover:underline font-medium"> 立即注册 </NuxtLink>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ScaleIcon, EyeIcon, EyeOffIcon, Loader2 } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();

// import { getRememberedAccount, rememberMeHandler } from "@/utils";
// import { useUserStore } from "@/stores/user";

// const userStore = useUserStore();

// 表单数据
const phone = ref("");
const password = ref("");
const showPassword = ref(false);

// 记住我
const rememberMe = ref(false);
// watch(rememberMe, (newVal) => {
//   rememberMeHandler(newVal, phone.value);
// });

// 组件挂载时，检查是否有保存的账号信息
onMounted(() => {
  // const savedAccount = getRememberedAccount();
  // if (savedAccount) {
  //   phone.value = savedAccount;
  //   rememberMe.value = true; // 如果有保存的账号，默认勾选"记住我"
  // }
});

// 登录处理
const handleLogin = async () => {};

// 跳转注册页面
const toRegister = () => {
  // 如果登录页面有redirect参数，则跳转注册页面并携带redirect参数
  if (route.query.redirect) {
    router.replace(`/register?redirect=${route.query.redirect}`);
  } else {
    router.replace("/register");
  }
};
</script>

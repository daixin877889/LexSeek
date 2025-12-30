<template>
    <!-- 认证弹框：支持登录和注册 -->
    <Dialog :open="open" @update:open="handleClose">
        <DialogContent class="sm:max-w-[425px]" @open-auto-focus.prevent>
            <DialogHeader>
                <DialogTitle>{{ title }}</DialogTitle>
                <DialogDescription>{{ description }}</DialogDescription>
            </DialogHeader>

            <!-- Tab 切换 -->
            <Tabs v-model="activeTab" class="w-full">
                <TabsList class="grid w-full grid-cols-2">
                    <TabsTrigger value="login">登录</TabsTrigger>
                    <TabsTrigger value="register">注册</TabsTrigger>
                </TabsList>

                <!-- 登录 Tab -->
                <TabsContent value="login" class="mt-4">
                    <form @submit.prevent="handleLogin" class="space-y-4">
                        <!-- 手机号 -->
                        <div>
                            <label for="login-phone" class="block text-sm font-medium mb-1">手机号</label>
                            <Input id="login-phone" v-model="loginForm.phone" type="tel" autocomplete="tel" required
                                placeholder="请输入手机号" />
                        </div>

                        <!-- 密码 -->
                        <div>
                            <label for="login-password" class="block text-sm font-medium mb-1">密码</label>
                            <div class="relative">
                                <Input id="login-password" v-model="loginForm.password"
                                    :type="showLoginPassword ? 'text' : 'password'" autocomplete="current-password"
                                    required placeholder="请输入密码" />
                                <button type="button" @click="showLoginPassword = !showLoginPassword"
                                    class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                                    <EyeIcon v-if="!showLoginPassword" class="h-4 w-4" />
                                    <EyeOffIcon v-else class="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <!-- 登录按钮 -->
                        <Button type="submit" :disabled="authStore.loading" class="w-full">
                            <Loader2 v-if="authStore.loading" class="w-4 h-4 mr-2 animate-spin" />
                            {{ authStore.loading ? '登录中...' : '登录' }}
                        </Button>

                        <!-- 错误信息 -->
                        <p v-if="loginError" class="text-sm text-red-500 text-center">{{ loginError }}</p>
                    </form>
                </TabsContent>

                <!-- 注册 Tab -->
                <TabsContent value="register" class="mt-4">
                    <form @submit.prevent="handleRegister" class="space-y-4">
                        <!-- 姓名 -->
                        <div>
                            <label for="register-name" class="block text-sm font-medium mb-1">
                                <span class="text-red-500">*</span>姓名
                            </label>
                            <Input id="register-name" v-model="registerForm.name" type="text" autocomplete="name"
                                required placeholder="请输入姓名" />
                        </div>

                        <!-- 手机号 -->
                        <div>
                            <label for="register-phone" class="block text-sm font-medium mb-1">
                                <span class="text-red-500">*</span>手机号
                            </label>
                            <div class="relative">
                                <Input id="register-phone" v-model="registerForm.phone" type="tel" autocomplete="tel"
                                    required placeholder="请输入手机号" class="pr-24" />
                                <Button type="button" @click="getVerificationCode"
                                    :disabled="isGettingCode || countdown > 0 || !validatePhone(registerForm.phone)"
                                    class="absolute right-0 top-0 h-full px-3 rounded-l-none" variant="secondary">
                                    {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
                                </Button>
                            </div>
                        </div>

                        <!-- 验证码 -->
                        <div>
                            <label for="register-code" class="block text-sm font-medium mb-1">
                                <span class="text-red-500">*</span>验证码
                            </label>
                            <Input id="register-code" v-model="registerForm.code" type="text"
                                autocomplete="one-time-code" required placeholder="请输入验证码" />
                        </div>

                        <!-- 密码 -->
                        <div>
                            <label for="register-password" class="block text-sm font-medium mb-1">
                                <span class="text-red-500">*</span>密码
                            </label>
                            <div class="relative">
                                <Input id="register-password" v-model="registerForm.password"
                                    :type="showRegisterPassword ? 'text' : 'password'" autocomplete="new-password"
                                    required placeholder="请设置密码（至少8位）" />
                                <button type="button" @click="showRegisterPassword = !showRegisterPassword"
                                    class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                                    <EyeIcon v-if="!showRegisterPassword" class="h-4 w-4" />
                                    <EyeOffIcon v-else class="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <!-- 服务条款 -->
                        <div class="flex items-start space-x-2">
                            <Checkbox id="agree-terms" v-model="registerForm.agreeTerms" class="mt-1" />
                            <label for="agree-terms" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                                我已阅读并同意
                                <NuxtLink to="/terms-of-use" target="_blank" class="text-primary hover:underline">服务条款
                                </NuxtLink>
                                和
                                <NuxtLink to="/privacy-agreement" target="_blank" class="text-primary hover:underline">
                                    隐私政策</NuxtLink>
                            </label>
                        </div>

                        <!-- 注册按钮 -->
                        <Button type="submit" :disabled="authStore.loading || !isRegisterFormValid" class="w-full">
                            <Loader2 v-if="authStore.loading" class="w-4 h-4 mr-2 animate-spin" />
                            {{ authStore.loading ? '注册中...' : '注册' }}
                        </Button>

                        <!-- 错误信息 -->
                        <p v-if="registerError" class="text-sm text-red-500 text-center">{{ registerError }}</p>
                    </form>
                </TabsContent>
            </Tabs>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import { EyeIcon, EyeOffIcon, Loader2 } from 'lucide-vue-next';

// Props
const props = withDefaults(defineProps<{
    /** 弹框是否打开 */
    open: boolean;
    /** 弹框标题 */
    title?: string;
    /** 弹框描述 */
    description?: string;
    /** 默认显示的 Tab */
    defaultTab?: 'login' | 'register';
}>(), {
    title: '登录或注册',
    description: '请登录或注册以继续',
    defaultTab: 'login',
});

// Emits
const emit = defineEmits<{
    'update:open': [value: boolean];
    'success': [];
    'cancel': [];
}>();

// Store
const authStore = useAuthStore();
const route = useRoute();

// 当前激活的 Tab
const activeTab = ref<'login' | 'register'>(props.defaultTab);

// 获取 URL 中的邀请码
const invitedBy = computed(() => {
    return (route.query.invitedBy as string) || localStorage.getItem("invitedBy") || "";
});

// 监听 defaultTab 变化
watch(() => props.defaultTab, (newVal) => {
    activeTab.value = newVal;
});

// 登录表单
const loginForm = reactive({
    phone: '',
    password: '',
});
const showLoginPassword = ref(false);
const loginError = ref('');

// 注册表单
const registerForm = reactive({
    name: '',
    phone: '',
    code: '',
    password: '',
    agreeTerms: true, // 默认勾选
});
const showRegisterPassword = ref(false);
const registerError = ref('');

// 验证码相关
const isGettingCode = ref(false);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// 注册表单验证
const isRegisterFormValid = computed(() => {
    return (
        registerForm.name.trim().length >= 2 &&
        validatePhone(registerForm.phone) &&
        registerForm.code.length > 0 &&
        registerForm.password.length >= 8 &&
        registerForm.agreeTerms
    );
});

/**
 * 处理登录
 */
const handleLogin = async () => {
    loginError.value = '';

    if (!loginForm.phone || !loginForm.password) {
        loginError.value = '请填写手机号和密码';
        return;
    }

    const success = await authStore.login({
        phone: loginForm.phone,
        password: loginForm.password,
    });

    if (success) {
        emit('success');
        emit('update:open', false);
        resetForms();
    } else {
        loginError.value = authStore.error || '登录失败';
    }
};

/**
 * 获取验证码
 */
const getVerificationCode = async () => {
    if (!validatePhone(registerForm.phone)) {
        registerError.value = '请输入正确的手机号';
        return;
    }

    isGettingCode.value = true;
    registerError.value = '';

    const success = await authStore.sendSmsCode({
        phone: registerForm.phone,
        type: SmsType.REGISTER,
    });

    if (success) {
        toast.success('验证码已发送');
        // 启动倒计时
        countdown.value = 60;
        countdownTimer = setInterval(() => {
            if (countdown.value > 0) {
                countdown.value--;
            } else {
                if (countdownTimer) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                }
            }
        }, 1000);
    } else {
        registerError.value = authStore.error || '获取验证码失败';
    }

    isGettingCode.value = false;
};

/**
 * 处理注册
 */
const handleRegister = async () => {
    registerError.value = '';

    if (!isRegisterFormValid.value) {
        if (registerForm.name.trim().length < 2) {
            registerError.value = '姓名至少2个字符';
        } else if (!validatePhone(registerForm.phone)) {
            registerError.value = '请输入正确的手机号';
        } else if (!registerForm.code) {
            registerError.value = '请输入验证码';
        } else if (registerForm.password.length < 8) {
            registerError.value = '密码至少8位';
        } else if (!registerForm.agreeTerms) {
            registerError.value = '请同意服务条款';
        }
        return;
    }

    const success = await authStore.register({
        phone: registerForm.phone,
        code: registerForm.code,
        name: registerForm.name,
        password: registerForm.password,
        invitedBy: invitedBy.value || undefined,
    });

    if (success) {
        emit('success');
        emit('update:open', false);
        resetForms();
    } else {
        registerError.value = authStore.error || '注册失败';
    }
};

/**
 * 关闭弹框
 */
const handleClose = (value: boolean) => {
    if (!value) {
        emit('cancel');
    }
    emit('update:open', value);
};

/**
 * 重置表单
 */
const resetForms = () => {
    loginForm.phone = '';
    loginForm.password = '';
    loginError.value = '';

    registerForm.name = '';
    registerForm.phone = '';
    registerForm.code = '';
    registerForm.password = '';
    registerForm.agreeTerms = true;
    registerError.value = '';
};

// 组件卸载时清理定时器
onUnmounted(() => {
    if (countdownTimer) {
        clearInterval(countdownTimer);
    }
});
</script>

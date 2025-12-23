<template>
  <div class="bg-card rounded-lg border p-6">
    <h2 class="text-xl font-semibold mb-6">安全设置</h2>

    <form @submit.prevent="changePassword" class="space-y-6">
      <div>
        <label for="current-password" class="block text-sm font-medium mb-1">当前密码</label>
        <div class="relative">
          <Input id="current-password" v-model="security.currentPassword" type="password" autocomplete="current-password" class="w-full px-3 py-2 border rounded-md bg-background h-[42px] text-base pr-10" placeholder="请输入当前密码 (未设置过密码留空)" />
          <button v-if="security.currentPassword" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" @click="security.currentPassword = ''">
            <x-icon class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div>
        <label for="new-password" class="block text-sm font-medium mb-1">新密码</label>
        <div class="relative">
          <Input id="new-password" v-model="security.newPassword" type="password" autocomplete="new-password" class="w-full px-3 py-2 border rounded-md bg-background h-[42px] text-base pr-10" placeholder="请输入新密码" />
          <button v-if="security.newPassword" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" @click="security.newPassword = ''">
            <x-icon class="h-4 w-4" />
          </button>
        </div>
        <p class="text-xs text-muted-foreground mt-1">密码长度至少为8位，包含字母和数字</p>
      </div>

      <div>
        <label for="confirm-password" class="block text-sm font-medium mb-1">确认新密码</label>
        <div class="relative">
          <Input id="confirm-password" v-model="security.confirmPassword" type="password" autocomplete="new-password" class="w-full px-3 py-2 border rounded-md bg-background h-[42px] text-base pr-10" placeholder="请再次输入新密码" />
          <button v-if="security.confirmPassword" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" @click="security.confirmPassword = ''">
            <x-icon class="h-4 w-4" />
          </button>
        </div>
        <p class="text-xs text-muted-foreground mt-1">请确保两次输入的新密码一致</p>
      </div>

      <div class="flex justify-between items-center">
        <router-link to="/reset-password" class="text-primary hover:underline flex items-center gap-1 text-sm"> 忘记密码？前往 <strong>重置密码</strong> 页面 </router-link>
        <Button type="submit" class="h-10 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2" :disabled="isSecuritySaving || !isPasswordValid">
          <loader-2-icon v-if="isSecuritySaving" class="h-4 w-4 animate-spin" />
          <save-icon v-else class="h-4 w-4" />
          修改密码
        </Button>
      </div>
    </form>

    <!-- <div class="mt-8 pt-8 border-t">
      <h3 class="text-lg font-medium mb-4">登录设备</h3>
      <div class="space-y-4">
        <div v-for="(device, index) in security.devices" :key="index" class="flex items-start justify-between p-4 border rounded-md">
          <div class="flex items-start gap-3">
            <div class="bg-primary/10 text-primary p-2 rounded-md">
              <smartphone-icon v-if="device.type === 'mobile'" class="h-5 w-5" />
              <laptop-icon v-else-if="device.type === 'desktop'" class="h-5 w-5" />
              <tablet-icon v-else class="h-5 w-5" />
            </div>
            <div>
              <p class="font-medium">{{ device.name }}</p>
              <p class="text-sm text-muted-foreground">{{ device.location }} · {{ device.lastActive }}</p>
              <p v-if="device.current" class="text-xs text-green-600 mt-1">当前设备</p>
            </div>
          </div>
          <button v-if="!device.current" @click="logoutDevice(device.id)" class="text-red-500 hover:text-red-700 text-sm">
            退出登录
          </button>
        </div>
      </div>
    </div> -->
  </div>
</template>

<script setup>
definePageMeta({
  title: "安全设置",
  layout: "dashboard-layout",
});
import { Loader2Icon, SaveIcon, SmartphoneIcon, LaptopIcon, TabletIcon, XIcon, RefreshCwIcon } from "lucide-vue-next";
const userStore = useUserStore();
const authStore = useAuthStore();
const roleStore = useRoleStore();

// 安全设置
const security = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const isSecuritySaving = ref(false);

// 密码验证
const isPasswordValid = computed(() => {
  if (!security.newPassword) return false;
  if (security.newPassword.length < 8) return false;
  if (!/[a-zA-Z]/.test(security.newPassword)) return false;
  if (!/[0-9]/.test(security.newPassword)) return false;
  if (security.newPassword !== security.confirmPassword) return false;
  return true;
});

// 获取密码验证错误信息
const getPasswordError = () => {
  if (!security.newPassword) return "请输入新密码";
  if (security.newPassword.length < 8) return "密码长度至少为8位";
  if (!/[a-zA-Z]/.test(security.newPassword)) return "密码必须包含字母";
  if (!/[0-9]/.test(security.newPassword)) return "密码必须包含数字";
  if (security.newPassword !== security.confirmPassword) return "两次输入的密码不一致";
  return "";
};

// 修改密码
const changePassword = async () => {
  const errorMessage = getPasswordError();
  if (errorMessage) {
    toast.error("验证失败", errorMessage);
    return;
  }

  try {
    const success = await userStore.updateUserPassword({
      currentPassword: security.currentPassword.trim(),
      newPassword: security.newPassword.trim(),
    });

    console.log(success);

    if (success) {
      // 显示成功提示
      toast.success("修改成功", "密码已成功修改");

      // 清空表单
      security.currentPassword = "";
      security.newPassword = "";
      security.confirmPassword = "";

      // 重置所有 store 的状态
      resetAllStore();
      // 跳转至登录页面
      navigateTo("/login");
    } else {
      // 显示错误提示
      toast.error("修改失败", userStore.error || "修改密码失败，请确认当前密码是否正确");
    }
  } catch (error) {
    toast.error("修改密码失败", error.message || "修改密码失败，请稍后重试");
  }
};
</script>

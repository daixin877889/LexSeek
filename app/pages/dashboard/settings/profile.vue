<template>
  <div class="bg-card rounded-lg border p-6">
    <h2 class="text-xl font-semibold mb-6">个人资料</h2>

    <form @submit.prevent="saveProfile" class="space-y-6">
      <div class="flex flex-col md:flex-row gap-6">
        <div class="flex-1">
          <label for="name" class="block text-sm font-medium mb-1">姓名</label>
          <Input id="name" v-model="userForm.name" type="text" placeholder="请输入您的姓名" class="w-full px-3 py-2 h-[42px] text-base border rounded-md bg-background" />
        </div>
        <div class="flex-1">
          <label for="company" class="block text-sm font-medium mb-1">所属律所/公司</label>
          <Input id="company" v-model="userForm.company" type="text" placeholder="请输入您的所属律所或公司" class="w-full px-3 py-2 h-[42px] text-base border rounded-md bg-background" />
        </div>
      </div>

      <div class="flex flex-col md:flex-row gap-6">
        <div class="flex-1">
          <label for="phone" class="block text-sm font-medium mb-1">手机号码</label>
          <Input id="phone" v-model="userForm.phone" type="text" placeholder="请输入您的手机号码" class="w-full px-3 py-2 h-[42px] text-base border rounded-md bg-background" disabled />
        </div>
        <div class="flex-1">
          <label for="email" class="block text-sm font-medium mb-1">电子邮箱</label>
          <Input id="email" v-model="userForm.email" type="text" placeholder="请输入您的电子邮箱" class="w-full px-3 py-2 h-[42px] text-base border rounded-md bg-background" disabled />
        </div>
      </div>

      <div>
        <label for="bio" class="block text-sm font-medium mb-1">个人简介</label>
        <Textarea id="bio" v-model="userForm.profile" rows="4" class="w-full px-3 py-2 border rounded-md bg-background resize-none" placeholder="请简要介绍您自己（选填）"></Textarea>
      </div>

      <div class="flex justify-end">
        <Button type="submit" class="h-10 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2" :disabled="userStore.loading">
          <loader-2-icon v-if="userStore.loading" class="h-4 w-4 animate-spin" />
          <save-icon v-else class="h-4 w-4" />
          保存修改
        </Button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { Loader2Icon, SaveIcon } from "lucide-vue-next";

definePageMeta({
  layout: "dashboard-layout",
  title: "个人资料",
});

const props = defineProps({
  userInfo: {
    type: Object,
    default: () => ({}),
  },
});

const userStore = useUserStore();

// 计算属性处理用户信息
const userForm = computed({
  get: () => ({
    name: userStore.userInfo?.name || "",
    company: userStore.userInfo?.company || "",
    phone: userStore.userInfo?.phone || "",
    email: userStore.userInfo?.email || "",
    profile: userStore.userInfo?.profile || "",
  }),
  set: (value) => {
    if (userStore.userInfo) {
      userStore.userInfo.name = value.name;
      userStore.userInfo.company = value.company;
      userStore.userInfo.phone = value.phone;
      userStore.userInfo.email = value.email;
      userStore.userInfo.profile = value.profile;
    }
  },
});

// 初始化数据
onMounted(async () => {
  try {
    // 使用 store 获取用户信息
    await userStore.refreshUserInfo();
  } catch (error) {
    toast.error("获取用户信息失败，请稍后重试");
  }
});

// 保存个人资料
const saveProfile = async () => {
  if (!userStore.userInfo) {
    toast.error("用户信息不存在，请刷新页面重试");
    return;
  }

  try {
    // 使用 store 更新用户信息
    const success = await userStore.updateUserInfo({
      name: userForm.value.name,
      phone: userForm.value.phone,
      company: userForm.value.company,
      profile: userForm.value.profile,
    });

    if (success) {
      // 显示成功提示
      toast.success("个人资料已成功更新");
    } else {
      throw new Error(userStore.error || "更新个人资料失败");
    }
  } catch (error) {
    toast.error("更新个人资料失败:", error);

    // 显示错误提示
    toast.error(error.message || "更新个人资料失败，请稍后重试");
  }
};
</script>

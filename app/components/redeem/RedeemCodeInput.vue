<template>
    <!-- 输入兑换码区域 -->
    <div class="w-full">
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
            <h3 class="text-lg font-semibold mb-4">输入兑换码</h3>
            <div class="space-y-4">
                <div class="grid w-full items-center gap-1.5">
                    <div class="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
                        <Input v-model="code" placeholder="请输入兑换码" class="h-10 w-full mb-2 text-base"
                            :disabled="loading" @keyup.enter="handleCheck" />
                        <Button class="h-10 w-full sm:w-auto" :disabled="!code || loading" @click="handleCheck">
                            <Loader2 v-if="loading" class="w-4 h-4 mr-2 animate-spin" />
                            开始兑换
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";

// 定义 props
const props = defineProps<{
    loading: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    check: [code: string];
}>();

// 兑换码输入
const code = defineModel<string>("code", { default: "" });

// 检查兑换码
const handleCheck = () => {
    if (!code.value.trim()) {
        toast.error("请输入兑换码");
        return;
    }
    emit("check", code.value.trim());
};
</script>

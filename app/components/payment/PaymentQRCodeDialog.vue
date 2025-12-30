<template>
    <!-- 通用支付二维码弹框 -->
    <Dialog :open="open" @update:open="handleClose">
        <DialogContent class="sm:max-w-[425px]" @open-auto-focus.prevent>
            <DialogHeader>
                <DialogTitle>{{ paid ? '支付成功' : title }}</DialogTitle>
                <DialogDescription>
                    {{ paid ? successDescription : description }}
                </DialogDescription>
            </DialogHeader>

            <div class="flex justify-center py-4">
                <!-- 支付成功状态 -->
                <div v-if="paid" class="flex flex-col items-center justify-center w-64 h-64">
                    <div class="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
                        <Check class="w-10 h-10 text-green-600" />
                    </div>
                    <p class="text-lg font-medium text-green-600">支付成功</p>
                    <p class="text-sm text-muted-foreground mt-2">{{ successMessage }}</p>
                </div>

                <!-- 加载中状态 -->
                <div v-else-if="loading" class="flex flex-col items-center justify-center w-64 h-64">
                    <Loader2 class="w-12 h-12 animate-spin text-primary mb-4" />
                    <p class="text-sm text-muted-foreground">正在生成支付二维码...</p>
                </div>

                <!-- 二维码显示（需要同意协议） -->
                <div v-else-if="agreed && qrCodeUrl" class="flex justify-center">
                    <QRCodeVue :value="qrCodeUrl" :size="256" level="M" />
                </div>

                <!-- 未同意协议时的占位 -->
                <div v-else-if="!agreed"
                    class="flex flex-col items-center justify-center w-64 h-64 border-2 border-dashed border-muted bg-muted/10 rounded-lg">
                    <div class="text-center p-4">
                        <p class="text-sm text-muted-foreground mb-2">请先同意购买协议</p>
                        <p class="text-xs text-muted-foreground">勾选下方协议后显示支付二维码</p>
                    </div>
                </div>

                <!-- 无二维码时的占位 -->
                <div v-else
                    class="flex flex-col items-center justify-center w-64 h-64 border-2 border-dashed border-muted bg-muted/10 rounded-lg">
                    <p class="text-sm text-muted-foreground">暂无支付二维码</p>
                </div>
            </div>

            <!-- 购买协议复选框 -->
            <div v-if="!paid" class="border-t pt-4">
                <div class="flex items-start space-x-2">
                    <Checkbox :id="checkboxId" v-model="agreed" class="mt-1" />
                    <label :for="checkboxId" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                        购买即同意
                        <NuxtLink to="/purchase-agreement" target="_blank"
                            class="text-primary hover:text-primary/80 font-bold">
                            《LexSeek（法索 AI）服务购买协议》
                        </NuxtLink>
                    </label>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import QRCodeVue from "qrcode.vue";
import { Check, Loader2 } from "lucide-vue-next";

// 定义 props
const props = withDefaults(defineProps<{
    /** 弹框是否打开 */
    open: boolean;
    /** 支付二维码 URL */
    qrCodeUrl: string;
    /** 是否正在加载 */
    loading?: boolean;
    /** 是否已支付成功 */
    paid?: boolean;
    /** 弹框标题（未支付时显示） */
    title?: string;
    /** 弹框描述（未支付时显示） */
    description?: string;
    /** 支付成功后的描述 */
    successDescription?: string;
    /** 支付成功后的提示消息 */
    successMessage?: string;
}>(), {
    loading: false,
    paid: false,
    title: '请使用微信扫码支付',
    description: '打开微信扫一扫，完成支付',
    successDescription: '感谢您的支持！',
    successMessage: '正在处理中...',
});

// 定义 emits
const emit = defineEmits<{
    "update:open": [value: boolean];
    close: [];
}>();

// 生成唯一的 checkbox id
const checkboxId = `payment-agreement-${Math.random().toString(36).slice(2, 9)}`;

// 购买协议同意状态（默认勾选）
const agreed = ref(true);

/**
 * 关闭弹框
 */
const handleClose = () => {
    emit("update:open", false);
    emit("close");
};
</script>

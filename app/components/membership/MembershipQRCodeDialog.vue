<template>
    <!-- 二维码弹框 -->
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[425px]" @open-auto-focus.prevent>
            <DialogHeader>
                <DialogTitle>请使用微信扫码购买</DialogTitle>
                <DialogDescription>
                    打开微信扫一扫，立即购买会员
                </DialogDescription>
            </DialogHeader>
            <div class="flex justify-center py-4">
                <div v-if="agreeToAgreement" class="flex justify-center">
                    <img :src="qrCodeUrl" alt="微信支付二维码" class="w-64 h-64" />
                </div>
                <div v-else
                    class="flex flex-col items-center justify-center w-64 h-64 border-2 border-dashed border-muted bg-muted/10 rounded-lg">
                    <div class="text-center p-4">
                        <p class="text-sm text-muted-foreground mb-2">请先同意购买协议</p>
                        <p class="text-xs text-muted-foreground">勾选下方协议后显示支付二维码</p>
                    </div>
                </div>
            </div>

            <!-- 购买协议复选框 -->
            <div class="border-t pt-4">
                <div class="flex items-start space-x-2">
                    <Checkbox id="qrcode-agreement" :checked="agreeToAgreement"
                        @update:checked="emit('update:agreeToAgreement', $event)" class="mt-1" />
                    <label for="qrcode-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                        购买即同意
                        <a href="/purchase-agreement" target="_blank"
                            class="text-primary hover:text-primary/80 font-bold">
                            《LexSeek（法索 AI ）服务购买协议》
                        </a>
                    </label>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
// 定义 props
defineProps<{
    open: boolean;
    qrCodeUrl: string;
    agreeToAgreement: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:agreeToAgreement': [value: boolean];
}>();
</script>

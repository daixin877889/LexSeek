<template>
    <!-- 微信客服二维码对话框 -->
    <Dialog :open="wxSupportStore.isVisible" @update:open="updateVisibility">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>微信客服</DialogTitle>
                <DialogDescription>
                    扫描下方二维码添加客服微信，获取即时帮助
                </DialogDescription>
            </DialogHeader>
            <div class="flex items-center justify-center p-4">
                <img :src="wxSupportStore.qrcode" alt="微信客服二维码" class="max-w-full h-auto rounded-lg" />
            </div>
            <DialogFooter>
                <Button @click="wxSupportStore.hideQrCode">关闭</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
/**
 * 微信客服二维码组件
 * 显示微信客服二维码的对话框组件，通过 Pinia store 控制显示/隐藏
 *
 * @example
 * // 在需要显示二维码的地方
 * const wxSupportStore = useWxSupportStore();
 * wxSupportStore.showQrCode();
 */

// 使用微信客服 store（Nuxt 自动导入）
const wxSupportStore = useWxSupportStore();

/**
 * 更新可见性状态
 * @param isVisible - 对话框是否可见
 */
const updateVisibility = (isVisible: boolean) => {
    if (!isVisible) {
        wxSupportStore.hideQrCode();
    }
};
</script>

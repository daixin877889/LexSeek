import { defineStore } from "pinia";

/**
 * 微信客服二维码 Store
 * 用于管理微信客服二维码弹窗的显示状态
 */
export const useWxSupportStore = defineStore("wxSupport", {
    state: () => ({
        /** 弹窗是否可见 */
        isVisible: false,
        /** 二维码图片路径 */
        qrcode: "/images/mpwxcode.jpg",
    }),

    actions: {
        /**
         * 显示微信客服二维码
         * @param qrcode - 可选的自定义二维码图片路径
         */
        showQrCode(qrcode?: string) {
            this.qrcode = qrcode || "/images/mpwxcode.jpg";
            this.isVisible = true;
        },

        /**
         * 隐藏微信客服二维码
         */
        hideQrCode() {
            this.isVisible = false;
        },

        /**
         * 切换微信客服二维码显示状态
         */
        toggleQrCode() {
            this.isVisible = !this.isVisible;
        },
    },
});

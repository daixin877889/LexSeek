import { defineStore } from 'pinia';

/**
 * 全局AlertDialog状态管理
 * @description 用于管理全局确认对话框的显示状态和内容
 */
interface AlertDialogOptions {
    title: string | null;
    message: string | null;
    type: 'success' | 'error' | null;
    confirmText: string | null;
    cancelText: string | null;
    showCancel: boolean;
    onConfirm: () => void | null;
    onCancel: () => void | null;
    zIndex?: number; // 自定义 z-index，默认为 600
}
export const useAlertDialogStore = defineStore('alertDialog', {
    state: () => ({
        isVisible: false,
        title: '',
        message: '',
        type: 'success', // success 或 error
        confirmText: '确认',
        cancelText: '取消',
        showCancel: true,
        zIndex: 600, // 默认 z-index
        confirmCallback: null as unknown as () => void | null,
        cancelCallback: null as unknown as () => void | null
    }),

    actions: {
        /**
         * 显示确认对话框
         * @param {Object} options - 对话框配置选项
         * @param {string} options.title - 对话框标题
         * @param {string} options.message - 对话框内容
         * @param {string} [options.type='success'] - 对话框类型: success 或 error
         * @param {string} [options.confirmText='确认'] - 确认按钮文本
         * @param {string} [options.cancelText='取消'] - 取消按钮文本
         * @param {boolean} [options.showCancel=true] - 是否显示取消按钮
         * @param {number} [options.zIndex=9999] - 自定义 z-index
         * @param {Function} [options.onConfirm] - 确认后的回调函数
         * @param {Function} [options.onCancel] - 取消后的回调函数
         */
        showDialog(options: AlertDialogOptions) {
            this.title = options.title || '提示';
            this.message = options.message || '';
            this.type = options.type || 'success';
            this.confirmText = options.confirmText || '确认';
            this.cancelText = options.cancelText || '取消';
            this.showCancel = options.showCancel !== false;
            this.zIndex = options.zIndex || 9999;
            this.confirmCallback = options.onConfirm;
            this.cancelCallback = options.onCancel;
            this.isVisible = true;
        },

        /**
         * 显示成功确认对话框
         * @param {Object} options - 对话框配置选项
         */
        showSuccessDialog(options: AlertDialogOptions) {
            this.showDialog({
                ...options,
                type: 'success'
            });
        },

        /**
         * 显示错误确认对话框
         * @param {Object} options - 对话框配置选项
         */
        showErrorDialog(options: AlertDialogOptions) {
            this.showDialog({
                ...options,
                type: 'error'
            });
        },

        /**
         * 隐藏确认对话框
         */
        hideDialog() {
            this.isVisible = false;
        },

        /**
         * 处理确认操作
         */
        handleConfirm() {
            if (typeof this.confirmCallback === 'function') {
                this.confirmCallback();
            }
            this.hideDialog();
        },

        /**
         * 处理取消操作
         */
        handleCancel() {
            if (typeof this.cancelCallback === 'function') {
                this.cancelCallback();
            }
            this.hideDialog();
        }
    }
}); 
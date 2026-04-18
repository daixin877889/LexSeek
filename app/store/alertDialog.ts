import { defineStore } from 'pinia';

interface AlertDialogOptions {
    title?: string | null;
    message?: string | null;
    type?: 'success' | 'error' | null;
    confirmText?: string | null;
    cancelText?: string | null;
    showCancel?: boolean;
    onConfirm?: (() => void | Promise<void>) | null;
    onCancel?: (() => void | Promise<void>) | null;
    zIndex?: number;
}

export const useAlertDialogStore = defineStore('alertDialog', {
    state: () => ({
        isVisible: false,
        title: '',
        message: '',
        type: 'success' as 'success' | 'error',
        confirmText: '确认',
        cancelText: '取消',
        showCancel: true,
        zIndex: 600,
        confirmCallback: null as (() => void | Promise<void>) | null,
        cancelCallback: null as (() => void | Promise<void>) | null,
    }),

    actions: {
        showDialog(options: AlertDialogOptions) {
            this.title = options.title || '提示';
            this.message = options.message || '';
            this.type = options.type || 'success';
            this.confirmText = options.confirmText || '确认';
            this.cancelText = options.cancelText || '取消';
            this.showCancel = options.showCancel !== false;
            this.zIndex = options.zIndex || 9999;
            this.confirmCallback = options.onConfirm ?? null;
            this.cancelCallback = options.onCancel ?? null;
            this.isVisible = true;
        },

        showSuccessDialog(options: AlertDialogOptions) {
            this.showDialog({
                ...options,
                type: 'success',
            });
        },

        showErrorDialog(options: AlertDialogOptions) {
            this.showDialog({
                ...options,
                type: 'error',
            });
        },

        hideDialog() {
            this.isVisible = false;
        },

        handleConfirm() {
            if (typeof this.confirmCallback === 'function') {
                this.confirmCallback();
            }
            this.hideDialog();
        },

        handleCancel() {
            if (typeof this.cancelCallback === 'function') {
                this.cancelCallback();
            }
            this.hideDialog();
        },
    },
});

<template>
  <!-- 全局确认对话框 -->
  <Dialog :open="alertDialogStore.isVisible" @update:open="updateVisibility">
    <DialogContent class="sm:max-w-lg alert-dialog-content" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="flex items-center mb-2">
          <check-circle-icon v-if="alertDialogStore.type === 'success'" class="h-5 w-5 text-primary mr-2" />
          <alert-circle-icon v-else class="h-5 w-5 text-red-500 mr-2" />
          {{ alertDialogStore.title }}
        </DialogTitle>
        <DialogDescription>
          {{ alertDialogStore.message }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="flex justify-end gap-2 mt-2">
        <Button v-if="alertDialogStore.showCancel" variant="outline" @click="alertDialogStore.handleCancel">
          {{ alertDialogStore.cancelText }}
        </Button>
        <Button
          :class="alertDialogStore.type === 'success' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-red-500 hover:bg-red-600 text-white'"
          @click="alertDialogStore.handleConfirm">
          {{ alertDialogStore.confirmText }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
// import { useAlertDialogStore } from '@/stores/alert-dialog';
import { CheckCircleIcon, AlertCircleIcon } from "lucide-vue-next";

/**
 * 全局确认对话框组件
 * @description 显示确认/警告对话框的全局组件，支持成功和错误两种样式
 */

// 使用确认对话框store
const alertDialogStore = useAlertDialogStore();

/**
 * 动态更新 z-index
 * 由于 Dialog 通过 Portal 渲染到 body，需要直接操作 DOM
 */
watchEffect(() => {
  if (alertDialogStore.isVisible) {
    // 使用 nextTick 确保 DOM 已渲染
    nextTick(() => {
      const zIndex = alertDialogStore.zIndex;
      const overlayZIndex = zIndex - 9;

      // 更新遮罩层 z-index
      const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement | null;
      if (overlay) {
        overlay.style.zIndex = String(overlayZIndex);
      }

      // 更新内容层 z-index
      const content = document.querySelector('[data-slot="dialog-content"].alert-dialog-content') as HTMLElement | null;
      if (content) {
        content.style.zIndex = String(zIndex);
      }
    });
  }
});

/**
 * 更新可见性状态
 * @param {boolean} isVisible - 对话框是否可见
 */
const updateVisibility = (isVisible: boolean) => {
  if (!isVisible) {
    alertDialogStore.hideDialog();
  }
};
</script>

<style>
/* 默认样式，作为后备 */
.alert-dialog-content {
  z-index: 9999 !important;
}
</style>

<script lang="ts">
/**
 * 确认对话框组件
 * @module AlertDialog
 *
 * @description
 * 这个组件用于显示全局确认对话框，支持成功和错误两种样式，通过Pinia状态管理来控制显示和隐藏。
 *
 * @example
 * // 在App.vue或布局组件中引入
 * import AlertDialog from '@/components/general/AlertDialog';
 *
 * // 在需要显示确认对话框的地方
 * import { useAlertDialogStore } from '@/stores';
 * const alertDialogStore = useAlertDialogStore();
 *
 * // 显示确认对话框
 * alertDialogStore.showDialog({
 *   title: '确认操作',
 *   message: '您确定要执行此操作吗？',
 *   onConfirm: () => {
 *     // 确认后的处理逻辑
 *   }
 * });
 *
 * // 显示错误确认对话框
 * alertDialogStore.showErrorDialog({
 *   title: '删除确认',
 *   message: '此操作将永久删除数据，且无法恢复。是否继续？',
 *   onConfirm: () => {
 *     // 确认删除的处理逻辑
 *   }
 * });
 */
export default {
  name: "AlertDialog",
};
</script>

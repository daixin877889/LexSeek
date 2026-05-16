<template>
    <!-- 文件详情对话框 -->
    <Dialog v-model:open="dialogOpen">
        <DialogContent
            class="sm:max-w-2xl file-detail-dialog-content flex flex-col min-w-[80vw] min-h-[80vh] max-h-[90vh] overflow-hidden p-0 gap-0"
            @interactOutside="(e) => e.preventDefault()" @openAutoFocus="(e) => e.preventDefault()"
            @closeAutoFocus="(e) => e.preventDefault()">
            <!-- 固定头部 -->
            <DialogHeader class="pr-8 overflow-hidden shrink-0 p-4 pb-2 border-b border-border border-dashed">
                <DialogTitle class="flex items-center gap-2 overflow-hidden pr-8">
                    <component :is="getFileIcon(file?.fileType || '')" class="h-5 w-5 shrink-0"
                        :class="getFileIconColor(file?.fileType || '')" />
                    <span class="truncate block" :title="file?.fileName">{{ file?.fileName }}</span>
                </DialogTitle>
                <DialogDescription>文件详情与预览</DialogDescription>
            </DialogHeader>

            <!-- 可滚动的内容区域 -->
            <div class="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 space-y-4">
                <!-- 文件预览区域 -->
                <div v-if="canPreview" class="border rounded-lg overflow-hidden bg-muted">
                    <!-- 图片预览 -->
                    <div v-if="isImageFile" class="flex items-center justify-center p-4 min-h-[200px] max-h-[400px]">
                        <div v-if="previewLoading" class="flex flex-col items-center gap-2">
                            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            <span class="text-sm text-muted-foreground">{{ previewLoadingText }}</span>
                        </div>
                        <div v-else-if="previewError" class="text-center text-red-500 dark:text-red-400">
                            <AlertCircleIcon class="h-8 w-8 mx-auto mb-2" />
                            <p class="text-sm">{{ previewError }}</p>
                        </div>
                        <img v-else-if="previewUrl" :src="previewUrl" :alt="file?.fileName"
                            class="max-w-full max-h-[360px] object-contain rounded" />
                    </div>

                    <!-- 音频预览 -->
                    <div v-else-if="isAudioFile" class="p-4">
                        <div v-if="previewLoading" class="flex flex-col items-center gap-2 py-8">
                            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            <span class="text-sm text-muted-foreground">{{ previewLoadingText }}</span>
                        </div>
                        <div v-else-if="previewError" class="text-center text-red-500 dark:text-red-400 py-8">
                            <AlertCircleIcon class="h-8 w-8 mx-auto mb-2" />
                            <p class="text-sm">{{ previewError }}</p>
                        </div>
                        <div v-else-if="previewUrl" class="space-y-3">
                            <div class="flex items-center gap-3 p-3 bg-card rounded-lg border">
                                <div
                                    class="w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                                    <MusicIcon class="h-6 w-6 text-green-600 dark:text-green-400" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm font-medium truncate">{{ file?.fileName }}</p>
                                    <p class="text-xs text-muted-foreground">{{ formatByteSize(file?.fileSize || 0, 2)
                                    }}</p>
                                </div>
                            </div>
                            <GeneralAudioPlayer :audio-url="previewUrl" />
                        </div>
                    </div>
                </div>

                <!-- 不支持预览提示 -->
                <div v-else class="border rounded-lg p-6 bg-muted text-center">
                    <div class="w-16 h-16 mx-auto mb-3 rounded-lg flex items-center justify-center"
                        :class="getFileIconBg(file?.fileType || '')">
                        <component :is="getFileIcon(file?.fileType || '')" class="h-8 w-8"
                            :class="getFileIconColor(file?.fileType || '')" />
                    </div>
                    <p class="text-muted-foreground text-sm">此文件类型暂不支持预览</p>
                </div>

                <!-- 文件信息 -->
                <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                        <p class="text-muted-foreground text-xs">文件大小</p>
                        <p class="font-medium">{{ formatByteSize(file?.fileSize || 0, 2) }}</p>
                    </div>
                    <div>
                        <p class="text-muted-foreground text-xs">文件类型</p>
                        <p class="font-medium truncate" :title="file?.fileType">{{ file?.fileType || "未知" }}</p>
                    </div>
                    <div>
                        <p class="text-muted-foreground text-xs">来源</p>
                        <p class="font-medium">{{ file?.sourceName }}</p>
                    </div>
                    <div>
                        <p class="text-muted-foreground text-xs">上传时间</p>
                        <p class="font-medium">{{ formatDateTime(file?.createdAt) }}</p>
                    </div>
                </div>
            </div>

            <!-- 固定底部按钮 -->
            <DialogFooter class="shrink-0 border-t border-border border-dashed px-4 py-4">
                <div class="flex justify-between w-full">
                    <!-- 左侧删除按钮 -->
                    <Button class="bg-red-500 hover:bg-red-600 text-white" @click="confirmDeleteFile"
                        :disabled="deleteLoading">
                        <Trash2Icon v-if="!deleteLoading" class="h-4 w-4 mr-1" />
                        <div v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                        {{ deleteLoading ? "删除中..." : "删除" }}
                    </Button>
                    <!-- 右侧按钮组 -->
                    <div class="flex gap-2">
                        <Button variant="outline" @click="dialogOpen = false">关闭</Button>
                        <Button
                            class="bg-gradient-brand-button text-white shadow-[0_10px_20px_-8px_rgba(30,158,237,0.42)]"
                            @click="downloadFile" :disabled="downloadLoading">
                            <div v-if="downloadLoading"
                                class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                            <DownloadIcon v-else class="h-4 w-4 mr-1" />
                            {{ downloadLoading ? "下载中..." : "下载" }}
                        </Button>
                    </div>
                </div>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import { LockIcon, UnlockIcon, MusicIcon, AlertCircleIcon, DownloadIcon, Trash2Icon } from "lucide-vue-next";
import dayjs from "dayjs";
import toast from '#shared/utils/toast'
import { formatByteSize } from '#shared/utils/unitConverision'
import GeneralAudioPlayer from '~/components/general/audio/AudioPlayer.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import type { OssFileItem } from '~/store/file'
import { canPreviewFile, getFileIcon, getFileIconBg, getFileIconColor, isAudioType, isImageType } from '~/utils/file'

// ==================== Props ====================

interface Props {
    /** 是否显示对话框 */
    open: boolean;
    /** 文件信息 */
    file: OssFileItem | null;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
    /** 更新显示状态 */
    (e: "update:open", value: boolean): void;
    /** 删除成功事件 */
    (e: "deleted"): void;
}>();

// ==================== 状态 ====================

// 对话框显示状态（双向绑定）
const dialogOpen = computed({
    get: () => props.open,
    set: (value) => emit("update:open", value),
});

// 预览相关状态
const previewUrl = ref<string | null>(null);
const previewLoading = ref(false);
const previewLoadingText = ref("加载中...");
const previewError = ref<string | null>(null);
const downloadLoading = ref(false);
const deleteLoading = ref(false);

// 删除确认对话框
const showDeleteConfirm = ref(false);

// 获取 alertDialog store
const alertDialogStore = useAlertDialogStore();

// ==================== 计算属性 ====================

// 判断是否为图片文件
const isImageFile = computed(() => {
    const fileType = props.file?.fileType || "";
    return isImageType(fileType);
});

// 判断是否为音频文件
const isAudioFile = computed(() => {
    const fileType = props.file?.fileType || "";
    return isAudioType(fileType);
});

// 判断是否可预览
const canPreview = computed(() => {
    const fileType = props.file?.fileType || "";
    return canPreviewFile(fileType);
});

// ==================== 方法 ====================

/**
 * 格式化日期时间
 */
const formatDateTime = (dateString?: string) => {
    if (!dateString) return "--";
    return dayjs(dateString).format("YYYY-MM-DD HH:mm");
};

/**
 * 加载文件预览
 */
const loadPreview = async (file: OssFileItem) => {
    if (!file.url) {
        previewError.value = "文件 URL 不可用";
        return;
    }

    previewLoading.value = true;
    previewError.value = null;

    try {
        previewUrl.value = file.url;
    } catch (err) {
        console.error("加载预览失败:", err);
        previewError.value = err instanceof Error ? err.message : "加载预览失败";
    } finally {
        previewLoading.value = false;
    }
};

/**
 * 下载文件
 */
const downloadFile = async () => {
    // 检查文件是否存在
    if (!props.file?.url) {
        toast.error("文件 URL 不可用");
        return;
    }

    downloadLoading.value = true;

    try {
        const response = await fetch(props.file.url);
        if (!response.ok) {
            throw new Error("下载失败");
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = props.file.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 释放 blob URL
        URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error("下载失败:", err);
        toast.error("下载失败");
    } finally {
        downloadLoading.value = false;
    }
};

/**
 * 确认删除文件
 */
const confirmDeleteFile = () => {
    if (!props.file) return;

    alertDialogStore.showDialog({
        title: "确认删除",
        message: `确定要删除文件「${props.file.fileName}」吗？此操作不可恢复。`,
        confirmText: "删除",
        cancelText: "取消",
        type: "error",
        showCancel: true,
        onConfirm: () => { deleteFile(); },
        onCancel: () => { },
    });
};

/**
 * 删除文件
 */
const deleteFile = async () => {
    if (!props.file?.id) return;

    deleteLoading.value = true;

    try {
        const result = await useApiFetch(`/api/v1/files/oss/${props.file.id}`, {
            method: "DELETE",
        });

        // 检查返回值，只有成功才执行后续操作
        if (result) {
            toast.success("删除成功");
            // 关闭对话框并通知父组件
            dialogOpen.value = false;
            emit("deleted");
        }
    } catch (err) {
        console.error("删除文件失败:", err);
    } finally {
        deleteLoading.value = false;
    }
};

// ==================== 监听器 ====================

// 监听文件变化，自动加载预览
watch(
    () => props.file,
    async (newFile) => {
        // 重置状态
        previewUrl.value = null;
        previewError.value = null;
        previewLoading.value = false;

        // 如果有文件且可预览，加载预览
        if (newFile && canPreviewFile(newFile.fileType || "") && newFile.url) {
            await loadPreview(newFile);
        }
    }
);

// 关闭对话框时清理资源
watch(dialogOpen, (isOpen) => {
    if (!isOpen) {
        if (previewUrl.value && previewUrl.value.startsWith("blob:")) {
            URL.revokeObjectURL(previewUrl.value);
        }
        previewUrl.value = null;
        previewError.value = null;
    }
});
</script>

<style>
.file-detail-dialog-content {
    z-index: 601 !important;
}

.password-dialog-content {
    z-index: 701 !important;
}
</style>

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
                        <div v-else-if="needsUnlock" class="text-center py-4">
                            <div
                                class="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <LockIcon class="h-8 w-8 text-amber-600 dark:text-amber-400" />
                            </div>
                            <p class="text-muted-foreground text-sm mb-3">请先解锁加密密钥以查看此文件</p>
                            <Button size="sm" @click="showPasswordDialog = true">
                                <UnlockIcon class="h-4 w-4 mr-1" />
                                输入密码解锁
                            </Button>
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
                        <div v-else-if="needsUnlock" class="text-center py-8">
                            <div
                                class="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <LockIcon class="h-8 w-8 text-amber-600 dark:text-amber-400" />
                            </div>
                            <p class="text-muted-foreground text-sm mb-3">请先解锁加密密钥以查看此文件</p>
                            <Button size="sm" @click="showPasswordDialog = true">
                                <UnlockIcon class="h-4 w-4 mr-1" />
                                输入密码解锁
                            </Button>
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

                <!-- 加密文件需要解锁 -->
                <div v-else-if="file?.encrypted && !encryptionStore.isUnlocked"
                    class="border rounded-lg p-6 bg-muted text-center">
                    <div
                        class="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <LockIcon class="h-8 w-8 text-amber-600 dark:text-amber-400" />
                    </div>
                    <p class="text-muted-foreground text-sm mb-3">请先解锁加密密钥以下载此文件</p>
                    <Button size="sm" @click="showPasswordDialog = true">
                        <UnlockIcon class="h-4 w-4 mr-1" />
                        输入密码解锁
                    </Button>
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
                    <div class="col-span-2">
                        <p class="text-muted-foreground text-xs">加密状态</p>
                        <p class="font-medium flex items-center gap-1">
                            <LockIcon v-if="file?.encrypted" class="h-4 w-4 text-green-600 dark:text-green-400" />
                            <UnlockIcon v-else class="h-4 w-4 text-muted-foreground" />
                            {{ file?.encrypted ? "已加密" : "未加密" }}
                        </p>
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
                        <Button @click="downloadFile" :disabled="downloadLoading">
                            <div v-if="downloadLoading"
                                class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
                            <DownloadIcon v-else class="h-4 w-4 mr-1" />
                            {{ downloadLoading ? "解密中..." : "下载" }}
                        </Button>
                    </div>
                </div>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- 密码输入对话框 -->
    <EncryptionPasswordDialog v-model:open="showPasswordDialog" content-class="password-dialog-content"
        @success="handleUnlockSuccess" />
</template>

<script lang="ts" setup>
import { LockIcon, UnlockIcon, MusicIcon, AlertCircleIcon, DownloadIcon, Trash2Icon } from "lucide-vue-next";
import dayjs from "dayjs";

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
const needsUnlock = ref(false);
const downloadLoading = ref(false);
const deleteLoading = ref(false);

// 密码输入对话框
const showPasswordDialog = ref(false);

// 删除确认对话框
const showDeleteConfirm = ref(false);

// 获取 alertDialog store
const alertDialogStore = useAlertDialogStore();

// 获取加密 store
const encryptionStore = useEncryptionStore();

// 获取加密工具
const { fetchAndDecryptToObjectURL, isEncryptedUrl } = useAgeCrypto();

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
        const mimeType = file.fileType || "application/octet-stream";
        const isHeic = isHeicFormat(mimeType, file.fileName);

        let objectUrl = await fetchAndDecryptToObjectURL(file.url, mimeType, ({ stage }) => {
            switch (stage) {
                case "check":
                    previewLoadingText.value = "检查加密状态...";
                    break;
                case "download":
                    previewLoadingText.value = "下载文件...";
                    break;
                case "decrypt":
                    previewLoadingText.value = "解密中...";
                    break;
            }
        });

        if (isHeic && objectUrl) {
            previewLoadingText.value = "转换 HEIC 格式...";
            objectUrl = await convertHeicToJpeg(objectUrl);
        }

        previewUrl.value = objectUrl;
    } catch (err) {
        console.error("加载预览失败:", err);
        if (err instanceof Error) {
            if (err.name === "IdentityNotUnlockedError") {
                needsUnlock.value = true;
                previewError.value = null;
            } else if (err.name === "IdentityMismatchError") {
                previewError.value = "密钥不匹配，无法解密此文件";
            } else {
                previewError.value = err.message || "加载预览失败";
            }
        } else {
            previewError.value = "加载预览失败";
        }
    } finally {
        previewLoading.value = false;
    }
};

/**
 * 解锁成功回调
 */
const handleUnlockSuccess = async () => {
    needsUnlock.value = false;
    if (props.file) {
        await loadPreview(props.file);
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

    // 检查加密文件是否已解锁
    if (props.file.encrypted && !encryptionStore.isUnlocked) {
        showPasswordDialog.value = true;
        return;
    }

    const file = props.file;
    const fileUrl = file.url!;

    if (isEncryptedUrl(fileUrl)) {
        // 加密文件：解密后下载
        let downloadUrl = previewUrl.value;
        if (!downloadUrl || !downloadUrl.startsWith("blob:")) {
            downloadLoading.value = true;
            try {
                const mimeType = file.fileType || "application/octet-stream";
                downloadUrl = await fetchAndDecryptToObjectURL(fileUrl, mimeType);
            } catch (err) {
                console.error("下载解密失败:", err);
                downloadLoading.value = false;
                return;
            }
            downloadLoading.value = false;
        }

        const link = document.createElement("a");
        link.href = downloadUrl;
        // 移除 .age 后缀
        const fileName = file.fileName.endsWith(".age") ? file.fileName.slice(0, -4) : file.fileName;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        // 非加密文件：先下载到本地创建 blob，再使用原始文件名保存
        downloadLoading.value = true;
        try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error("下载失败");
            }
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.href = blobUrl;
            link.download = file.fileName;
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
        needsUnlock.value = false;

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

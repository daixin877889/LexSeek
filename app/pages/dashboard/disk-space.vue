<template>
  <div class="h-full flex flex-col p-4">
    <!-- 顶部标题和存储使用情况 -->
    <div class="bg-white shrink-0 mb-6">
      <div class="mx-auto">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-3xl font-bold mb-2">云盘空间</h1>
            <p class="text-muted-foreground">管理您上传的文件资源</p>
          </div>

          <!-- 上传文件按钮 -->
          <div>
            <Button @click="showUploadDialog = true" class="bg-primary hover:bg-primary/90">
              <UploadIcon class="h-4 w-4" />
              上传文件
            </Button>
          </div>
        </div>

        <!-- 存储空间显示 -->
        <div class="rounded-lg p-4 bg-gradient-custom">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-600">已使用空间</p>
              <p class="text-2xl font-bold text-gray-900">{{ storageInfo.formatted || "0 B" }}</p>
            </div>
            <div class="text-right">
              <p class="text-sm text-gray-600">总容量</p>
              <p class="text-lg font-semibold text-gray-700">{{ storageQuota.formatted || "-- GB" }}</p>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="mt-4">
            <div class="flex justify-between text-sm text-gray-600 mb-2">
              <span>存储使用率</span>
              <span>{{ storageUsagePercentage }}</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2">
              <div class="bg-primary h-2 rounded-full transition-all duration-300" :style="{ width: storageUsagePercentage }"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 文件列表区域 -->
    <div class="flex-1 overflow-hidden flex flex-col">
      <div class="mx-auto h-full w-full flex flex-col">
        <!-- 工具栏 -->
        <div class="flex flex-col gap-4 mb-4 shrink-0">
          <!-- 第一行：视图切换、筛选和排序 -->
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <!-- 视图切换 -->
              <div class="flex bg-gray-100 rounded-lg p-1">
                <Button variant="ghost" size="sm" :class="{ 'bg-white shadow-sm': viewMode === 'grid' }" @click="viewMode = 'grid'">
                  <GridIcon class="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" :class="{ 'bg-white shadow-sm': viewMode === 'list' }" @click="viewMode = 'list'">
                  <ListIcon class="h-4 w-4" />
                </Button>
              </div>

              <div class="text-sm text-gray-600 hidden sm:block">共 {{ pagination.total }} 个文件</div>
            </div>
            <!-- 筛选和排序区域 -->
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <!-- 文件类型筛选 -->
              <Select v-model="searchForm.fileType">
                <SelectTrigger class="w-full sm:w-[140px]">
                  <SelectValue placeholder="文件类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem v-for="(label, key) in fileTypeOptions" :key="key" :value="key">
                    {{ label }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <!-- 来源筛选 -->
              <Select v-model="searchForm.source">
                <SelectTrigger class="w-full sm:w-[140px]">
                  <SelectValue placeholder="文件来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部来源</SelectItem>
                  <SelectItem v-for="(label, key) in sourceNameOptions" :key="key" :value="key">
                    {{ label }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <!-- 排序选择 -->
              <Select v-model="sortBy">
                <SelectTrigger class="w-full sm:w-[140px]">
                  <SelectValue placeholder="排序方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in sortOptionsMap" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- 移动端文件数量显示 -->
            <div class="text-sm text-gray-600 text-center sm:hidden">共 {{ pagination.total }} 个文件</div>
          </div>
          <!-- 第二行：搜索框和刷新按钮 -->
          <div class="flex flex-col sm:flex-row gap-4">
            <!-- 搜索框 -->
            <div class="flex-1 min-w-0">
              <div class="relative" style="padding-left: 1px">
                <SearchIcon class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input v-model="searchForm.fileName" placeholder="搜索文件名..." class="pl-10 pr-8" />
                <!-- 清除按钮 -->
                <button v-if="searchForm.fileName" type="button" class="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" @click="searchForm.fileName = ''">
                  <XIcon class="h-4 w-4" />
                </button>
              </div>
            </div>

            <!-- 刷新按钮 -->
            <Button @click="refresh" :disabled="status === 'pending'" variant="outline" class="shrink-0">
              <RefreshCwIcon class="h-4 w-4 mr-2" :class="{ 'animate-spin': status === 'pending' }" />
              刷新
            </Button>
          </div>
        </div>

        <!-- 文件列表内容 -->
        <div class="flex-1 overflow-auto">
          <!-- 加载状态 -->
          <div v-if="status === 'pending' && !fileList.length" class="flex items-center justify-center h-64">
            <div class="text-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p class="text-gray-600">正在加载文件...</p>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-else-if="!fileList.length" class="flex flex-col items-center justify-center h-64 text-gray-500">
            <FolderOpenIcon class="h-16 w-16 mb-4 text-gray-300" />
            <p class="text-lg font-medium mb-2">暂无文件</p>
            <p class="text-sm">您还没有上传任何文件</p>
          </div>

          <!-- 网格视图 -->
          <div v-else-if="viewMode === 'grid'" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            <div v-for="file in fileList" :key="file.id" class="group bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-primary/50 transition-all cursor-pointer" @click="openFileDetail(file)">
              <!-- 文件图标/缩略图 -->
              <div class="flex justify-center mb-3">
                <!-- 图片缩略图（仅非加密图片） -->
                <div v-if="isImageType(file.fileType) && !file.encrypted" class="w-12 h-12 rounded-lg overflow-hidden bg-purple-100 flex items-center justify-center">
                  <img v-if="!thumbnailErrors[String(file.id)]" :src="file.url" :alt="file.fileName" class="w-full h-full object-cover" @error="handleThumbnailError(String(file.id))" />
                  <ImageIcon v-else class="h-6 w-6 text-purple-600" />
                </div>
                <!-- 其他文件类型图标 -->
                <div v-else class="w-12 h-12 rounded-lg flex items-center justify-center" :class="getFileIconBg(file.fileType)">
                  <component :is="getFileIcon(file.fileType)" class="h-6 w-6" :class="getFileIconColor(file.fileType)" />
                </div>
              </div>

              <!-- 文件名 -->
              <p class="text-sm font-medium text-gray-900 truncate text-center mb-1" :title="file.fileName">
                {{ file.fileName }}
              </p>

              <!-- 文件信息 -->
              <div class="flex items-center justify-center gap-2 text-xs text-gray-500">
                <span>{{ formatByteSize(file.fileSize, 2) }}</span>
                <span v-if="file.encrypted" class="text-green-600 flex items-center gap-0.5">
                  <LockIcon class="h-3 w-3" />
                </span>
              </div>

              <!-- 来源标签 -->
              <div class="mt-2 flex justify-center">
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {{ file.sourceName }}
                </span>
              </div>
            </div>
          </div>

          <!-- 列表视图 -->
          <div v-else class="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <!-- 表头 -->
            <div class="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-600">
              <div class="col-span-5">文件名</div>
              <div class="col-span-2">大小</div>
              <div class="col-span-2">来源</div>
              <div class="col-span-2">上传时间</div>
              <div class="col-span-1 text-center">状态</div>
            </div>

            <!-- 文件列表 -->
            <div class="divide-y divide-gray-100">
              <div v-for="file in fileList" :key="file.id" class="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer items-center" @click="openFileDetail(file)">
                <!-- 文件名 -->
                <div class="col-span-5 flex items-center gap-3 min-w-0">
                  <div class="w-8 h-8 rounded flex items-center justify-center shrink-0" :class="getFileIconBg(file.fileType)">
                    <component :is="getFileIcon(file.fileType)" class="h-4 w-4" :class="getFileIconColor(file.fileType)" />
                  </div>
                  <span class="text-sm text-gray-900 truncate" :title="file.fileName">{{ file.fileName }}</span>
                </div>

                <!-- 大小 -->
                <div class="col-span-2 text-sm text-gray-600">
                  {{ formatByteSize(file.fileSize, 2) }}
                </div>

                <!-- 来源 -->
                <div class="col-span-2">
                  <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {{ file.sourceName }}
                  </span>
                </div>

                <!-- 上传时间 -->
                <div class="col-span-2 text-sm text-gray-500">
                  {{ formatDate(file.createdAt) }}
                </div>

                <!-- 状态 -->
                <div class="col-span-1 flex justify-center">
                  <span v-if="file.encrypted" class="text-green-600" title="已加密">
                    <LockIcon class="h-4 w-4" />
                  </span>
                  <span v-else class="text-gray-400" title="未加密">
                    <UnlockIcon class="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 分页导航 -->
        <div v-if="status !== 'pending' && fileList.length > 0" class="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 border-t border-gray-200 mt-4">
          <!-- 分页信息 -->
          <div class="text-sm text-gray-600 text-center sm:text-left">显示第 {{ (pagination.page - 1) * pagination.pageSize + 1 }} - {{ Math.min(pagination.page * pagination.pageSize, pagination.total) }} 条， 共 {{ pagination.total }} 条记录</div>

          <!-- 页码导航 -->
          <div class="flex items-center justify-center gap-2">
            <!-- 上一页 -->
            <Button variant="outline" size="sm" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">
              <ChevronLeftIcon class="h-4 w-4" />
            </Button>

            <!-- 页码按钮 -->
            <div class="flex items-center gap-1">
              <Button v-for="pageNum in getPageNumbers()" :key="pageNum" :variant="pageNum === pagination.page ? 'default' : 'outline'" size="sm" class="w-8" @click="changePage(pageNum)">
                {{ pageNum }}
              </Button>
            </div>

            <!-- 下一页 -->
            <Button variant="outline" size="sm" :disabled="pagination.page >= pagination.totalPages" @click="changePage(pagination.page + 1)">
              <ChevronRightIcon class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传文件对话框 -->
    <Dialog v-model:open="showUploadDialog">
      <DialogContent class="sm:max-w-2xl upload-dialog-content overflow-hidden" @interactOutside="(e) => e.preventDefault()">
        <DialogHeader>
          <DialogTitle>上传文件</DialogTitle>
          <DialogDescription> 选择要上传的文件，支持多文件上传和客户端加密 </DialogDescription>
        </DialogHeader>
        <div class="py-4 overflow-hidden">
          <GeneralFileUploader :source="FileSource.FILE" :multiple="true" :autoUpload="true" :enableEncryption="true" :defaultEncrypted="true" :onSuccess="handleUploadSuccess" :onError="handleUploadError" />
        </div>
      </DialogContent>
    </Dialog>

    <!-- 文件详情对话框 -->
    <Dialog v-model:open="showFileDetailDialog">
      <DialogContent class="sm:max-w-2xl file-detail-dialog-content flex flex-col min-w-[80vw] min-h-[80vh] max-h-[90vh] overflow-hidden p-0 gap-0" @interactOutside="(e) => e.preventDefault()" @openAutoFocus="(e) => e.preventDefault()">
        <!-- 固定头部 -->
        <DialogHeader class="pr-8 overflow-hidden shrink-0 p-4 pb-2 border-b border-gray-100 border-dashed">
          <DialogTitle class="flex items-center gap-2 overflow-hidden">
            <component :is="getFileIcon(selectedFile?.fileType || '')" class="h-5 w-5 shrink-0" :class="getFileIconColor(selectedFile?.fileType || '')" />
            <span class="truncate block" :title="selectedFile?.fileName">{{ selectedFile?.fileName }}</span>
          </DialogTitle>
          <DialogDescription>文件详情与预览</DialogDescription>
        </DialogHeader>

        <!-- 可滚动的内容区域 -->
        <div class="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 space-y-4">
          <!-- 文件预览区域 -->
          <div v-if="canPreview" class="border rounded-lg overflow-hidden bg-gray-50">
            <!-- 图片预览 -->
            <div v-if="isImageFile" class="flex items-center justify-center p-4 min-h-[200px] max-h-[400px]">
              <div v-if="previewLoading" class="flex flex-col items-center gap-2">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span class="text-sm text-gray-500">{{ previewLoadingText }}</span>
              </div>
              <!-- 需要解锁密钥的提示 -->
              <div v-else-if="needsUnlock" class="text-center py-4">
                <div class="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 flex items-center justify-center">
                  <LockIcon class="h-8 w-8 text-amber-600" />
                </div>
                <p class="text-gray-600 text-sm mb-3">请先解锁加密密钥以查看此文件</p>
                <Button size="sm" @click="showPasswordDialog = true">
                  <UnlockIcon class="h-4 w-4 mr-1" />
                  输入密码解锁
                </Button>
              </div>
              <div v-else-if="previewError" class="text-center text-red-500">
                <AlertCircleIcon class="h-8 w-8 mx-auto mb-2" />
                <p class="text-sm">{{ previewError }}</p>
              </div>
              <img v-else-if="previewUrl" :src="previewUrl" :alt="selectedFile?.fileName" class="max-w-full max-h-[360px] object-contain rounded" />
            </div>

            <!-- 音频预览 -->
            <div v-else-if="isAudioFile" class="p-4">
              <div v-if="previewLoading" class="flex flex-col items-center gap-2 py-8">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span class="text-sm text-gray-500">{{ previewLoadingText }}</span>
              </div>
              <!-- 需要解锁密钥的提示 -->
              <div v-else-if="needsUnlock" class="text-center py-8">
                <div class="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 flex items-center justify-center">
                  <LockIcon class="h-8 w-8 text-amber-600" />
                </div>
                <p class="text-gray-600 text-sm mb-3">请先解锁加密密钥以查看此文件</p>
                <Button size="sm" @click="showPasswordDialog = true">
                  <UnlockIcon class="h-4 w-4 mr-1" />
                  输入密码解锁
                </Button>
              </div>
              <div v-else-if="previewError" class="text-center text-red-500 py-8">
                <AlertCircleIcon class="h-8 w-8 mx-auto mb-2" />
                <p class="text-sm">{{ previewError }}</p>
              </div>
              <div v-else-if="previewUrl" class="space-y-3">
                <div class="flex items-center gap-3 p-3 bg-white rounded-lg border">
                  <div class="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                    <MusicIcon class="h-6 w-6 text-green-600" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">{{ selectedFile?.fileName }}</p>
                    <p class="text-xs text-gray-500">{{ formatByteSize(selectedFile?.fileSize || 0, 2) }}</p>
                  </div>
                </div>
                <!-- 使用 AudioPlayer 组件替代原生 audio 标签 -->
                <GeneralAudioPlayer :audio-url="previewUrl" />
              </div>
            </div>
          </div>

          <!-- 加密文件需要解锁（不支持预览的文件类型） -->
          <div v-else-if="selectedFile?.encrypted && !encryptionStore.isUnlocked" class="border rounded-lg p-6 bg-gray-50 text-center">
            <div class="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 flex items-center justify-center">
              <LockIcon class="h-8 w-8 text-amber-600" />
            </div>
            <p class="text-gray-600 text-sm mb-3">请先解锁加密密钥以下载此文件</p>
            <Button size="sm" @click="showPasswordDialog = true">
              <UnlockIcon class="h-4 w-4 mr-1" />
              输入密码解锁
            </Button>
          </div>

          <!-- 不支持预览提示 -->
          <div v-else class="border rounded-lg p-6 bg-gray-50 text-center">
            <div class="w-16 h-16 mx-auto mb-3 rounded-lg flex items-center justify-center" :class="getFileIconBg(selectedFile?.fileType || '')">
              <component :is="getFileIcon(selectedFile?.fileType || '')" class="h-8 w-8" :class="getFileIconColor(selectedFile?.fileType || '')" />
            </div>
            <p class="text-gray-600 text-sm">此文件类型暂不支持预览</p>
          </div>

          <!-- 文件信息 -->
          <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <p class="text-gray-500 text-xs">文件大小</p>
              <p class="font-medium">{{ formatByteSize(selectedFile?.fileSize || 0, 2) }}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs">文件类型</p>
              <p class="font-medium truncate" :title="selectedFile?.fileType">{{ selectedFile?.fileType || "未知" }}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs">来源</p>
              <p class="font-medium">{{ selectedFile?.sourceName }}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs">上传时间</p>
              <p class="font-medium">{{ formatDateTime(selectedFile?.createdAt) }}</p>
            </div>
            <div class="col-span-2">
              <p class="text-gray-500 text-xs">加密状态</p>
              <p class="font-medium flex items-center gap-1">
                <LockIcon v-if="selectedFile?.encrypted" class="h-4 w-4 text-green-600" />
                <UnlockIcon v-else class="h-4 w-4 text-gray-400" />
                {{ selectedFile?.encrypted ? "已加密" : "未加密" }}
              </p>
            </div>
          </div>
        </div>

        <!-- 固定底部按钮 -->
        <DialogFooter class="shrink-0 border-t border-gray-100 border-dashed px-4 py-4">
          <div class="flex justify-end gap-2">
            <Button variant="outline" @click="showFileDetailDialog = false">关闭</Button>
            <Button @click="downloadFile" :disabled="!selectedFile?.url || downloadLoading || (selectedFile?.encrypted && !encryptionStore.isUnlocked)">
              <div v-if="downloadLoading" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
              <DownloadIcon v-else class="h-4 w-4 mr-1" />
              {{ downloadLoading ? "解密中..." : "下载文件" }}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 密码输入对话框 -->
    <EncryptionPasswordDialog v-model:open="showPasswordDialog" content-class="password-dialog-content" @success="handleUnlockSuccess" />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "云盘空间",
  layout: "dashboard-layout",
});

import { UploadIcon, GridIcon, ListIcon, RefreshCwIcon, SearchIcon, FolderOpenIcon, LockIcon, UnlockIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, ImageIcon, MusicIcon, VideoIcon, FileIcon, XIcon, AlertCircleIcon, DownloadIcon } from "lucide-vue-next";
import { refDebounced } from "@vueuse/core";
// import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// import { formatByteSize } from "~~/shared/utils/unitConverision";
// import { FILE_LIST_API, type FileListResponse, type OssFileItem } from "~~/app/store/file";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

// 配置 dayjs
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

// 获取 store
const fileStore = useFileStore();

// 响应式数据
const initialized = ref(false);
const viewMode = ref<"grid" | "list">("grid");
const sortBy = ref("CREATED_AT_DESC");

// 搜索表单
const searchForm = reactive({
  fileName: "",
  fileType: "all",
  source: "all",
});

// 当前页码（用于客户端分页切换）
const currentPage = ref(1);

// 节流后的搜索关键词（用于实际查询）
const debouncedFileName = refDebounced(toRef(searchForm, "fileName"), 300);

// 存储空间信息
const storageInfo = ref({ formatted: "0 B" });
const storageQuota = ref({ formatted: "-- GB" });
const storageUsagePercentage = ref("0%");

// 上传文件对话框
const showUploadDialog = ref(false);

// 文件详情对话框
const showFileDetailDialog = ref(false);
const selectedFile = ref<OssFileItem | null>(null);
const previewUrl = ref<string | null>(null);
const previewLoading = ref(false);
const previewLoadingText = ref("加载中...");
const previewError = ref<string | null>(null);
const needsUnlock = ref(false); // 是否需要解锁密钥

// 密码输入对话框
const showPasswordDialog = ref(false);

// 获取加密 store
const encryptionStore = useEncryptionStore();

// 获取加密工具
const { fetchAndDecryptToObjectURL, isEncryptedUrl } = useAgeCrypto();

// 缩略图加载错误记录（用于回退到图标显示）
const thumbnailErrors = reactive<Record<string, boolean>>({});

/**
 * 判断文件类型是否为图片（用于卡片缩略图）
 */
const isImageType = (fileType: string) => {
  return fileType?.includes("image") || false;
};

/**
 * 判断是否为 HEIC/HEIF 格式
 */
const isHeicFormat = (mimeType: string, fileName: string) => {
  const heicMimeTypes = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];
  const heicExtensions = [".heic", ".heif"];

  if (heicMimeTypes.includes(mimeType.toLowerCase())) {
    return true;
  }

  const lowerFileName = fileName.toLowerCase();
  return heicExtensions.some((ext) => lowerFileName.endsWith(ext));
};

/**
 * 将 HEIC 格式转换为 JPEG
 * @param objectUrl 原始 Object URL
 * @returns 转换后的 JPEG Object URL
 */
const convertHeicToJpeg = async (objectUrl: string): Promise<string> => {
  try {
    // 动态导入 heic2any（仅客户端）
    const heic2any = (await import("heic2any")).default;

    // 获取 blob 数据
    const response = await fetch(objectUrl);
    const heicBlob = await response.blob();

    // 转换为 JPEG
    const jpegBlob = await heic2any({
      blob: heicBlob,
      toType: "image/jpeg",
      quality: 0.9,
    });

    // 释放原始 URL
    URL.revokeObjectURL(objectUrl);

    // 创建新的 Object URL
    const resultBlob = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;
    if (!resultBlob) {
      throw new Error("HEIC 转换结果为空");
    }
    return URL.createObjectURL(resultBlob);
  } catch (err) {
    console.error("HEIC 转换失败:", err);
    // 转换失败时返回原始 URL
    return objectUrl;
  }
};

/**
 * 处理缩略图加载错误
 */
const handleThumbnailError = (fileId: string) => {
  thumbnailErrors[fileId] = true;
};

// 判断是否为图片文件
const isImageFile = computed(() => {
  const fileType = selectedFile.value?.fileType || "";
  return fileType.includes("image");
});

// 判断是否为音频文件
const isAudioFile = computed(() => {
  const fileType = selectedFile.value?.fileType || "";
  return fileType.includes("audio");
});

// 判断是否可预览
const canPreview = computed(() => isImageFile.value || isAudioFile.value);

// 动态筛选选项
const fileTypeOptions = FileTypeName;
const sourceNameOptions = FileSourceName;

// 排序选项映射
const sortOptionsMap = computed(() => [
  { value: "CREATED_AT_DESC", label: "最新上传", field: "createdAt", order: "desc" },
  { value: "CREATED_AT_ASC", label: "最早上传", field: "createdAt", order: "asc" },
  { value: "FILE_SIZE_DESC", label: "大小降序", field: "fileSize", order: "desc" },
  { value: "FILE_SIZE_ASC", label: "大小升序", field: "fileSize", order: "asc" },
  { value: "FILE_NAME_ASC", label: "名称A-Z", field: "fileName", order: "asc" },
  { value: "FILE_NAME_DESC", label: "名称Z-A", field: "fileName", order: "desc" },
]);

// 构建查询参数（使用 store 的方法）
const queryParams = computed(() => {
  const currentSort = sortOptionsMap.value.find((option) => option.value === sortBy.value);
  return fileStore.buildFileListQuery({
    page: currentPage.value,
    pageSize: 30,
    fileName: debouncedFileName.value,
    fileType: searchForm.fileType,
    source: searchForm.source,
    sortField: currentSort?.field,
    sortOrder: currentSort?.order,
  });
});

// 使用 useApi 获取文件列表（支持 SSR）
const { data, status, refresh } = useApi<FileListResponse>(FILE_LIST_API, {
  query: queryParams,
  watch: [queryParams], // 监听参数变化自动刷新
});

// 同步数据到 store（供其他组件使用）
watch(
  data,
  (newData) => {
    fileStore.syncFileListData(newData);
  },
  { immediate: true }
);

// 计算属性：文件列表
const fileList = computed(() => data.value?.list || []);

// 计算属性：分页信息
const pagination = computed(
  () =>
    data.value?.pagination || {
      page: 1,
      pageSize: 30,
      total: 0,
      totalPages: 0,
    }
);

/**
 * 获取页码数组（用于页码导航）
 */
const getPageNumbers = () => {
  const totalPages = pagination.value.totalPages;
  const current = pagination.value.page;
  const range = 2; // 当前页前后显示的页数

  let start = Math.max(1, current - range);
  let end = Math.min(totalPages, current + range);

  // 确保显示足够的页码
  if (end - start < range * 2) {
    if (start === 1) {
      end = Math.min(totalPages, start + range * 2);
    } else if (end === totalPages) {
      start = Math.max(1, end - range * 2);
    }
  }

  const pages: number[] = [];
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return pages;
};

/**
 * 获取文件图标组件
 */
const getFileIcon = (fileType: string) => {
  if (!fileType) return FileIcon;
  if (fileType.includes("image")) return ImageIcon;
  if (fileType.includes("audio")) return MusicIcon;
  if (fileType.includes("video")) return VideoIcon;
  if (fileType.includes("pdf") || fileType.includes("document") || fileType.includes("text") || fileType.includes("word")) return FileTextIcon;
  if (fileType.includes("json")) return FileIcon;
  return FileIcon;
};

/**
 * 获取文件图标背景色
 */
const getFileIconBg = (fileType: string) => {
  if (!fileType) return "bg-gray-100";
  if (fileType.includes("image")) return "bg-purple-100";
  if (fileType.includes("audio")) return "bg-green-100";
  if (fileType.includes("video")) return "bg-red-100";
  if (fileType.includes("pdf") || fileType.includes("document") || fileType.includes("text") || fileType.includes("word")) return "bg-blue-100";
  if (fileType.includes("json")) return "bg-yellow-100";
  return "bg-gray-100";
};

/**
 * 获取文件图标颜色
 */
const getFileIconColor = (fileType: string) => {
  if (!fileType) return "text-gray-500";
  if (fileType.includes("image")) return "text-purple-600";
  if (fileType.includes("audio")) return "text-green-600";
  if (fileType.includes("video")) return "text-red-600";
  if (fileType.includes("pdf") || fileType.includes("document") || fileType.includes("text") || fileType.includes("word")) return "text-blue-600";
  if (fileType.includes("json")) return "text-yellow-600";
  return "text-gray-500";
};

/**
 * 格式化日期（使用 dayjs）
 */
const formatDate = (dateString: string) => {
  if (!dateString) return "--";
  const date = dayjs(dateString);
  const now = dayjs();
  const diffDays = now.diff(date, "day");

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return date.fromNow();
  return date.format("YYYY-MM-DD");
};

/**
 * 格式化日期时间（完整格式）
 */
const formatDateTime = (dateString?: string) => {
  if (!dateString) return "--";
  return dayjs(dateString).format("YYYY-MM-DD HH:mm");
};

/**
 * 切换页码
 */
const changePage = (page: number) => {
  currentPage.value = page;
};

/**
 * 动态更新对话框 z-index
 */
watchEffect(() => {
  if (showUploadDialog.value) {
    nextTick(() => {
      const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement | null;
      if (overlay) overlay.style.zIndex = "600";

      const content = document.querySelector('[data-slot="dialog-content"].upload-dialog-content') as HTMLElement | null;
      if (content) content.style.zIndex = "601";
    });
  }
});

// 监听排序变化，重置页码
watch(sortBy, () => {
  currentPage.value = 1;
});

// 监听筛选变化，重置页码
watch(
  () => searchForm.fileType,
  (newValue, oldValue) => {
    if (initialized.value && oldValue !== undefined && newValue !== oldValue) {
      currentPage.value = 1;
    }
  }
);

watch(
  () => searchForm.source,
  (newValue, oldValue) => {
    if (initialized.value && oldValue !== undefined && newValue !== oldValue) {
      currentPage.value = 1;
    }
  }
);

// 监听搜索关键词变化，重置页码（避免在第 N 页搜索时结果不足 N 页而看不到结果）
watch(debouncedFileName, (newValue, oldValue) => {
  if (initialized.value && oldValue !== undefined && newValue !== oldValue) {
    currentPage.value = 1;
  }
});

// 上传成功回调
const handleUploadSuccess = (uploadedFiles: Record<string, unknown>[]) => {
  console.log("上传成功", uploadedFiles);
  showUploadDialog.value = false;
  refresh();
};

// 上传失败回调
const handleUploadError = (err: Error) => {
  console.log("上传失败", err);
};

/**
 * 打开文件详情对话框
 */
const openFileDetail = async (file: OssFileItem) => {
  // 重置状态
  selectedFile.value = file;
  previewUrl.value = null;
  previewError.value = null;
  previewLoading.value = false;
  needsUnlock.value = false;
  showFileDetailDialog.value = true;

  // 如果是可预览的文件类型，加载预览
  const fileType = file.fileType || "";
  const canPreviewFile = fileType.includes("image") || fileType.includes("audio");

  if (canPreviewFile && file.url) {
    await loadPreview(file);
  }
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

    // 使用统一的方法获取文件（自动判断是否需要解密）
    let objectUrl = await fetchAndDecryptToObjectURL(file.url, mimeType, ({ stage }) => {
      // 更新加载状态文本
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

    // 如果是 HEIC/HEIF 格式，转换为 JPEG
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
        previewError.value = null; // 清除错误，使用 needsUnlock 状态显示
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
 * 解锁成功回调 - 重新加载预览
 */
const handleUnlockSuccess = async () => {
  needsUnlock.value = false;
  if (selectedFile.value) {
    await loadPreview(selectedFile.value);
  }
};

// 下载状态
const downloadLoading = ref(false);

/**
 * 下载文件（加密文件会先解密再下载）
 */
const downloadFile = async () => {
  if (!selectedFile.value?.url) return;

  const file = selectedFile.value;
  const fileUrl = file.url!; // 已在上面检查过不为空

  // 判断是否为加密文件
  if (isEncryptedUrl(fileUrl)) {
    // 加密文件：使用已解密的 previewUrl 或重新解密
    let downloadUrl = previewUrl.value;

    if (!downloadUrl || !downloadUrl.startsWith("blob:")) {
      // 需要重新下载并解密
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

    // 使用解密后的 blob URL 下载
    const link = document.createElement("a");
    link.href = downloadUrl;
    // 移除 .age 后缀
    const fileName = file.fileName.endsWith(".age") ? file.fileName.slice(0, -4) : file.fileName;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // 非加密文件：直接下载
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = file.fileName;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

/**
 * 关闭文件详情对话框时清理资源
 */
watch(showFileDetailDialog, (isOpen) => {
  if (!isOpen) {
    // 释放 Object URL 避免内存泄漏
    if (previewUrl.value && previewUrl.value.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl.value);
    }
    previewUrl.value = null;
    selectedFile.value = null;
    previewError.value = null;
  }
});

// 组件挂载后标记已初始化
onMounted(() => {
  initialized.value = true;
});
</script>

<style>
/* 上传对话框 z-index 后备样式 */
.upload-dialog-content {
  z-index: 601 !important;
}

/* 文件详情对话框样式 */
.file-detail-dialog-content {
  z-index: 601 !important;
}

/* 密码输入对话框样式（需要在文件详情弹框之上） */
.password-dialog-content {
  z-index: 701 !important;
}
</style>

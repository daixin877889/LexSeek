<template>
  <Dialog v-model:open="open">
    <DialogContent
      :class="['max-w-4xl min-w-[80vw] md:min-w-[70vw] h-[85vh] md:h-[90vh]', 'grid grid-rows-[auto_1fr] overflow-hidden', isUploadMode ? '' : 'grid-rows-[auto_1fr_auto]']"
      @interactOutside="(e) => e.preventDefault()">
      <DialogHeader>
        <DialogTitle>选择案情材料</DialogTitle>
        <DialogDescription class="hidden md:block">从已上传的文件中选择，或上传新的案情材料</DialogDescription>
      </DialogHeader>

      <!-- 主内容区域 -->
      <div class="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
        <!-- 操作栏：响应式布局 -->
        <div class="flex flex-wrap items-center gap-2 md:gap-3">
          <!-- 左侧：文件类型筛选 -->
          <div v-if="!isUploadMode" class="flex items-center gap-1.5">
            <Button v-for="option in fileTypeOptions" :key="option.value"
              :variant="selectedFileType === option.value ? 'default' : 'outline'" size="sm"
              @click="selectedFileType = option.value" class="h-9">
              <component :is="option.icon" :class="['size-4', isSearchExpanded ? '' : 'md:mr-1.5', 'lg:mr-1.5']" />
              <span :class="['hidden', isSearchExpanded ? 'lg:inline' : 'md:inline']">{{ option.label }}</span>
            </Button>
          </div>

          <!-- 右侧：搜索 + 上传按钮组 -->
          <div class="flex items-center gap-2 ml-auto">
            <!-- 搜索框容器（上传模式下隐藏） -->
            <div v-if="!isUploadMode" class="relative hidden md:flex items-center">
              <!-- 桌面端（lg+）：默认展开的搜索框 -->
              <Input v-model="searchQuery" placeholder="搜索文件名..." class="h-9 w-64 hidden lg:block">
              <template #prefix>
                <SearchIcon class="size-4 text-muted-foreground" />
              </template>
              </Input>

              <!-- 中等屏幕（md-lg）：收起状态的搜索图标 -->
              <Button v-if="!isSearchExpanded" variant="outline" size="sm" class="h-9 w-9 p-0 lg:hidden"
                @mouseenter="isSearchExpanded = true" @click="isSearchExpanded = true">
                <SearchIcon class="size-4" />
              </Button>

              <!-- 中等屏幕（md-lg）：展开状态的搜索框（向左展开） -->
              <div v-if="isSearchExpanded" class="absolute right-0 z-10 lg:hidden" @mouseleave="handleSearchBlur">
                <Input ref="searchInputRef" v-model="searchQuery" placeholder="搜索文件名..." class="h-9 w-64">
                <template #prefix>
                  <SearchIcon class="size-4 text-muted-foreground" />
                </template>
                </Input>
              </div>
            </div>

            <!-- 上传按钮 -->
            <Button variant="default" size="sm" @click="toggleUploadMode" class="h-9">
              <component :is="isUploadMode ? ArrowLeftIcon : UploadIcon"
                :class="['size-4', isSearchExpanded ? '' : 'md:mr-1.5', 'lg:mr-1.5']" />
              <span :class="['hidden', isSearchExpanded ? 'lg:inline' : 'md:inline']">{{ isUploadMode ? "返回列表" : "上传文件"
                }}</span>
            </Button>
          </div>

          <!-- 移动端：搜索框单独一行 -->
          <div class="w-full md:hidden">
            <Input v-model="searchQuery" placeholder="搜索文件名..." class="h-9 w-full">
            <template #prefix>
              <SearchIcon class="size-4 text-muted-foreground" />
            </template>
            </Input>
          </div>
        </div>

        <!-- 文件列表或上传器 -->
        <div ref="scrollContainerRef" class="flex-1 overflow-y-auto border rounded-md min-h-0" @scroll="handleScroll">
          <!-- 加载状态（首次加载） -->
          <div v-if="loading && allFiles.length === 0 && !isUploadMode" class="flex items-center justify-center h-full">
            <Loader2Icon class="size-8 animate-spin text-muted-foreground" />
          </div>

          <!-- 上传模式 -->
          <div v-else-if="isUploadMode" class="h-full p-4">
            <GeneralFileUploader :source="FileSource.CASE_ANALYSIS" :multiple="true" :autoUpload="true"
              :enableEncryption="true" :defaultEncrypted="true" :onSuccess="handleFileUploadSuccess" class="h-full" />
          </div>

          <!-- 文件列表模式 -->
          <div v-else :class="['divide-y', filteredFiles.length === 0 && !loading ? 'h-full' : '']">
            <!-- 空状态 -->
            <div v-if="filteredFiles.length === 0 && !loading"
              class="flex flex-col items-center justify-center h-full text-center">
              <FileIcon class="size-12 text-muted-foreground/50 mb-4" />
              <p class="text-sm text-muted-foreground mb-2">
                {{ searchQuery ? "未找到匹配的文件" : "暂无案情材料" }}
              </p>
              <Button variant="outline" size="sm" @click="isUploadMode = true">
                <UploadIcon class="size-4 mr-1.5" />
                上传文件
              </Button>
            </div>

            <!-- 文件列表 -->
            <div v-for="file in filteredFiles" :key="file.id" :class="[
              'flex items-center gap-3 p-4 transition-colors',
              isFileDisabled(file.id)
                ? 'opacity-60 cursor-not-allowed bg-muted/30'
                : 'hover:bg-accent/50 cursor-pointer'
            ]" @click="!isFileDisabled(file.id) && toggleFileSelection(file.id)">
              <!-- 复选框 -->
              <Checkbox
                :id="`file-${file.id}`"
                :model-value="selectedFiles.includes(file.id)"
                :disabled="isFileDisabled(file.id)"
                class="cursor-pointer"
                @click.stop
                @update:model-value="handleCheckboxChange(file.id, $event)" />

              <!-- 文件图标 -->
              <div class="flex items-center justify-center size-10 rounded-md bg-muted">
                <component :is="getFileIcon(file.fileType)" :class="['size-5', getFileIconColor(file.fileType)]" />
              </div>

              <!-- 文件信息 -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <label :for="`file-${file.id}`"
                    :class="['text-sm font-medium truncate', isFileDisabled(file.id) ? 'cursor-not-allowed' : 'cursor-pointer']">
                    {{ file.fileName }}
                  </label>
                  <Badge v-if="file.encrypted" variant="secondary" class="text-xs">
                    <LockIcon class="size-3 mr-1" />
                    已加密
                  </Badge>
                  <!-- 已添加标识 -->
                  <Badge v-if="isFileDisabled(file.id)" variant="outline" class="text-xs">
                    已添加
                  </Badge>
                </div>
                <div class="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{{ formatByteSize(file.fileSize) }}</span>
                  <span>•</span>
                  <span>{{ formatDateRelative(file.createdAt) }}</span>
                </div>
              </div>
            </div>

            <!-- 加载更多状态 -->
            <div v-if="loadingMore" class="flex items-center justify-center py-4">
              <Loader2Icon class="size-5 animate-spin text-muted-foreground mr-2" />
              <span class="text-sm text-muted-foreground">加载更多...</span>
            </div>

            <!-- 没有更多数据 -->
            <div v-else-if="!hasMore && allFiles.length > 0" class="flex items-center justify-center py-4">
              <span class="text-sm text-muted-foreground">已加载全部 {{ allFiles.length }} 个文件</span>
            </div>
          </div>
        </div>

        <!-- 已选择文件提示 -->
        <!-- <div v-if="selectedFiles.length > 0 && !isUploadMode"
          class="flex items-center justify-between p-3 bg-primary/10 rounded-md">
          <span class="text-sm font-medium"> 已选择 {{ selectedFiles.length }} 个文件 </span>
          <Button variant="ghost" size="sm" @click="clearSelection"> 清除选择 </Button>
        </div> -->
      </div>

      <!-- 底部操作栏（上传模式下隐藏） -->
      <DialogFooter v-if="!isUploadMode" class="flex-shrink-0 flex-row items-center justify-start gap-2 border-t pt-3">
        <!-- 桌面端全选按钮 -->
        <Button variant="outline" size="sm" @click="toggleSelectAll" :disabled="selectableFiles.length === 0"
          class="md:flex h-9">
          <CheckSquareIcon class="size-4 mr-1.5" />
          {{ isAllSelected ? "取消全选" : "全选" }}
        </Button>

        <!-- 右侧按钮组 -->
        <div class="flex items-center gap-2 ml-auto">
          <Button variant="outline" @click="closeDialog"> 取消 </Button>
          <Button @click="confirmSelection" :disabled="selectedFiles.length === 0"> 确认选择 ({{ selectedFiles.length }})
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { ArrowLeftIcon, CheckSquareIcon, FileIcon, FileTextIcon, FileAudioIcon, ImageIcon, LockIcon, Loader2Icon, SearchIcon, UploadIcon } from "lucide-vue-next";
import { useDebounceFn } from "@vueuse/core";
import { FileSource } from "#shared/types/file";
import type { OssFileItem, FileListParams } from "~/store/file";
import { formatByteSize } from "#shared/utils/unitConverision";
import { getFileIcon, getFileIconColor } from "~/utils/file";

// 组件 Props
const props = defineProps<{
  // 禁止选择的文件 ID 列表（已添加到父组件的文件）
  disabledFileIds?: number[]
}>()

// 使用格式化工具
const { formatDateRelative } = useFormatters();

/**
 * 判断文件是否被禁用（已添加到父组件）
 */
function isFileDisabled(fileId: number): boolean {
  return props.disabledFileIds?.includes(fileId) ?? false
}

// 对话框状态
const open = defineModel<boolean>("open", { default: false });

// 文件 store
const fileStore = useFileStore();

// 是否上传模式
const isUploadMode = ref(false);

// 搜索关键词
const searchQuery = ref("");

// 搜索框展开状态
const isSearchExpanded = ref(false);

// 搜索框 ref（Input 组件实例）
const searchInputRef = ref<any>(null);

// 滚动容器 ref
const scrollContainerRef = ref<HTMLElement | null>(null);

// 文件类型筛选
const selectedFileType = ref<string>("all");

// 文件类型选项
const fileTypeOptions = [
  { value: "all", label: "全部", icon: FileIcon },
  { value: "document", label: "文档", icon: FileTextIcon },
  { value: "image", label: "图片", icon: ImageIcon },
  { value: "audio", label: "音频", icon: FileAudioIcon },
];

// 已选择的文件 ID
const selectedFiles = ref<number[]>([]);

// 当前页码
const currentPage = ref(1);

// 每页数量
const pageSize = ref(20);

// 所有已加载的文件（累积）
const allFiles = ref<OssFileItem[]>([]);

// 总数
const totalFiles = ref(0);

// 是否正在加载更多
const loadingMore = ref(false);

// 是否还有更多数据
const hasMore = computed(() => allFiles.value.length < totalFiles.value);

// 构建查询参数
const queryParams = computed<FileListParams>(() => ({
  page: currentPage.value,
  pageSize: pageSize.value,
  fileName: searchQuery.value || undefined,
  source: FileSource.CASE_ANALYSIS,
  sortField: "createdAt",
  sortOrder: "desc",
}));

// 首次加载状态
const loading = ref(false);

/**
 * 加载文件列表
 * @param append 是否追加到现有列表（用于加载更多）
 */
async function loadFiles(append = false) {
  if (!append) {
    loading.value = true;
  } else {
    loadingMore.value = true;
  }

  try {
    const query = fileStore.buildFileListQuery(queryParams.value);
    const response = await useApiFetch<{
      list: OssFileItem[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    }>(fileStore.FILE_LIST_API, {
      method: "GET",
      query,
      showError: true,
    });

    if (response) {
      if (append) {
        // 追加到现有列表，去重
        const existingIds = new Set(allFiles.value.map(f => f.id));
        const newFiles = response.list.filter(f => !existingIds.has(f.id));
        allFiles.value = [...allFiles.value, ...newFiles];
      } else {
        // 替换列表
        allFiles.value = response.list;
      }
      totalFiles.value = response.pagination.total;

      // 等待 DOM 更新后检查是否需要继续加载
      await nextTick();
      checkAndLoadMore();
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

// 过滤后的文件列表
const filteredFiles = computed(() => {
  let result = allFiles.value;

  // 按文件类型筛选
  if (selectedFileType.value !== "all") {
    result = result.filter((file) => {
      const type = file.fileType.toLowerCase();
      switch (selectedFileType.value) {
        case "document":
          return type.includes("document") || type.includes("文档") || type.includes("pdf") || type.includes("doc");
        case "image":
          return type.includes("image") || type.includes("图片");
        case "audio":
          return type.includes("audio") || type.includes("音频");
        default:
          return true;
      }
    });
  }

  return result;
});

// 可选择的文件列表（排除已禁用的文件）
const selectableFiles = computed(() => {
  return filteredFiles.value.filter(file => !isFileDisabled(file.id))
})

// 是否全选（只考虑可选择的文件）
const isAllSelected = computed(() => {
  return selectableFiles.value.length > 0 && selectableFiles.value.every((file) => selectedFiles.value.includes(file.id));
});

/**
 * 处理滚动事件，实现无限滚动加载
 */
function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;

  // 距离底部 100px 时触发加载
  const threshold = 100;
  const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < threshold;

  // 调试日志
  // console.log('滚动检测:', { isNearBottom, hasMore: hasMore.value, loadingMore: loadingMore.value, loading: loading.value, allFilesCount: allFiles.value.length, totalFiles: totalFiles.value })

  if (isNearBottom && hasMore.value && !loadingMore.value && !loading.value) {
    loadMoreFiles();
  }
}

/**
 * 检查是否需要自动加载更多（当内容不足以填满容器时）
 */
function checkAndLoadMore() {
  const container = scrollContainerRef.value;
  if (!container) return;

  // 如果内容高度小于容器高度，且还有更多数据，自动加载
  if (container.scrollHeight <= container.clientHeight && hasMore.value && !loadingMore.value && !loading.value) {
    loadMoreFiles();
  }
}

/**
 * 加载更多文件
 */
async function loadMoreFiles() {
  if (!hasMore.value || loadingMore.value) return;

  currentPage.value += 1;
  await loadFiles(true);
}

// 切换上传模式
const toggleUploadMode = () => {
  isUploadMode.value = !isUploadMode.value;
  if (!isUploadMode.value) {
    // 返回列表时重新加载数据
    resetAndLoad();
  }
};

// 处理文件上传成功
const handleFileUploadSuccess = async (uploadedFiles: Record<string, unknown>[]) => {
  // 从上传结果中提取文件ID（注意：上传返回的字段是 fileId，不是 id）
  const uploadedFileIds = uploadedFiles
    .map((file) => (file.fileId || file.id) as number)
    .filter((id) => id !== undefined && id !== null);

  // 延迟切换，确保上传组件完成所有操作
  await new Promise(resolve => setTimeout(resolve, 500));

  // 切换回文件选择模式
  isUploadMode.value = false;

  // 重新加载文件列表
  await resetAndLoad();

  // 等待DOM更新
  await nextTick();

  // 等待额外的时间确保列表渲染完成
  await new Promise(resolve => setTimeout(resolve, 300));

  // 将新上传的文件追加到已选择列表中（保留原有选择）
  if (uploadedFileIds.length > 0) {
    // 合并新旧选择，去重
    selectedFiles.value = [...new Set([...selectedFiles.value, ...uploadedFileIds])];
    toast.success(`已选中 ${uploadedFileIds.length} 个刚上传的文件`);
  }
};

// 切换文件选择
const toggleFileSelection = (fileId: number) => {
  const index = selectedFiles.value.indexOf(fileId);
  if (index > -1) {
    selectedFiles.value.splice(index, 1);
  } else {
    selectedFiles.value.push(fileId);
  }
};

// 处理 checkbox 状态变化
const handleCheckboxChange = (fileId: number, checked: boolean) => {
  if (isFileDisabled(fileId)) return;

  const index = selectedFiles.value.indexOf(fileId);
  if (checked && index === -1) {
    selectedFiles.value.push(fileId);
  } else if (!checked && index > -1) {
    selectedFiles.value.splice(index, 1);
  }
};

// 全选/取消全选（只操作可选择的文件）
const toggleSelectAll = () => {
  if (isAllSelected.value) {
    // 取消全选：移除所有可选择文件的选中状态
    const selectableIds = selectableFiles.value.map(file => file.id)
    selectedFiles.value = selectedFiles.value.filter(id => !selectableIds.includes(id))
  } else {
    // 全选：添加所有可选择文件
    const selectableIds = selectableFiles.value.map(file => file.id)
    selectedFiles.value = [...new Set([...selectedFiles.value, ...selectableIds])]
  }
};

// 清除选择（保留以备将来使用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const clearSelection = () => {
  selectedFiles.value = [];
};

// 确认选择
const confirmSelection = () => {
  const selectedFileObjects = allFiles.value.filter((file) => selectedFiles.value.includes(file.id));
  // 触发事件，将选中的文件传递给父组件
  emit("filesSelected", selectedFileObjects);

  closeDialog();
};

/**
 * 重置并加载（用于搜索、筛选变化时）
 */
async function resetAndLoad() {
  currentPage.value = 1;
  allFiles.value = [];
  totalFiles.value = 0;
  await loadFiles(false);
}

// 搜索防抖
const debouncedSearch = useDebounceFn(() => {
  resetAndLoad();
}, 500);

// 监听搜索关键词变化
watch(searchQuery, () => {
  debouncedSearch();
});

// 监听搜索框展开状态
watch(isSearchExpanded, (expanded) => {
  if (expanded) {
    nextTick(() => {
      // Input 组件需要通过 $el 访问原生 input 元素
      const inputElement = searchInputRef.value?.$el?.querySelector("input") || searchInputRef.value?.$el;
      inputElement?.focus();
    });
  }
});

// 处理搜索框失焦
const handleSearchBlur = () => {
  if (!searchQuery.value) {
    isSearchExpanded.value = false;
  }
};

// 打开对话框
const openDialog = () => {
  open.value = true;
  isUploadMode.value = false;
  searchQuery.value = "";
  isSearchExpanded.value = false;
  selectedFileType.value = "all";
  selectedFiles.value = [];
  currentPage.value = 1;
  allFiles.value = [];
  totalFiles.value = 0;
  // 加载文件列表
  loadFiles(false);
};

// 关闭对话框
const closeDialog = () => {
  open.value = false;
  selectedFiles.value = [];
};

// 定义 emit
const emit = defineEmits<{
  filesSelected: [files: OssFileItem[]];
}>();

defineExpose({
  openDialog,
  closeDialog,
});
</script>

<style></style>

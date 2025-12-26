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
              <div class="bg-primary h-2 rounded-full transition-all duration-300"
                :style="{ width: storageUsagePercentage }"></div>
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
              <!-- 视图切换（仅 PC 端显示） -->
              <div class="hidden md:flex bg-gray-100 rounded-lg p-1">
                <Button variant="ghost" size="sm" :class="{ 'bg-white shadow-sm': viewMode === 'grid' }"
                  @click="viewMode = 'grid'">
                  <GridIcon class="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" :class="{ 'bg-white shadow-sm': viewMode === 'list' }"
                  @click="viewMode = 'list'">
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
                  <SelectItem v-for="(label, key) in fileTypeOptions" :key="key" :value="key">{{ label }}</SelectItem>
                </SelectContent>
              </Select>
              <!-- 来源筛选 -->
              <Select v-model="searchForm.source">
                <SelectTrigger class="w-full sm:w-[140px]">
                  <SelectValue placeholder="文件来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部来源</SelectItem>
                  <SelectItem v-for="(label, key) in sourceNameOptions" :key="key" :value="key">{{ label }}</SelectItem>
                </SelectContent>
              </Select>
              <!-- 排序选择 -->
              <Select v-model="sortBy">
                <SelectTrigger class="w-full sm:w-[140px]">
                  <SelectValue placeholder="排序方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in sortOptionsMap" :key="option.value" :value="option.value">{{ option.label
                    }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <!-- 移动端文件数量显示 -->
            <div class="text-sm text-gray-600 text-center sm:hidden">共 {{ pagination.total }} 个文件</div>
          </div>
          <!-- 第二行：搜索框和刷新按钮 -->
          <div class="flex flex-col sm:flex-row gap-4">
            <div class="flex-1 min-w-0">
              <div class="relative" style="padding-left: 1px">
                <SearchIcon class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input v-model="searchForm.fileName" placeholder="搜索文件名..." class="pl-10 pr-8" />
                <button v-if="searchForm.fileName" type="button"
                  class="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  @click="searchForm.fileName = ''">
                  <XIcon class="h-4 w-4" />
                </button>
              </div>
            </div>
            <Button @click="handleRefresh" :disabled="status === 'pending'" variant="outline" class="shrink-0">
              <RefreshCwIcon class="h-4 w-4 mr-2" :class="{ 'animate-spin': status === 'pending' }" />
              刷新
            </Button>
          </div>
        </div>

        <!-- 文件列表内容 -->
        <div class="flex-1 overflow-hidden">
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

          <!-- PC 端：网格/列表视图 + 分页 -->
          <template v-else>
            <!-- PC 端视图 -->
            <div class="hidden md:block h-full overflow-auto">
              <!-- 网格视图 -->
              <DiskSpaceFileListGrid v-if="viewMode === 'grid'" :files="fileList" @click="openFileDetail" />
              <!-- 列表视图 -->
              <DiskSpaceFileListTable v-else :files="fileList" @click="openFileDetail" />
            </div>

            <!-- 移动端：无限滚动列表（使用 ClientOnly 避免 SSR 水合不匹配） -->
            <ClientOnly>
              <div class="md:hidden h-full">
                <DiskSpaceFileListMobile :files="mobileFileList" :loading="mobileLoading" :refreshing="mobileRefreshing"
                  :has-more="mobileHasMore" @click="openFileDetail" @load-more="loadMoreMobile"
                  @refresh="refreshMobile" />
              </div>
              <!-- SSR 占位符 -->
              <template #fallback>
                <div class="md:hidden h-full flex items-center justify-center">
                  <div class="text-center">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                    <p class="text-sm text-gray-500">加载中...</p>
                  </div>
                </div>
              </template>
            </ClientOnly>
          </template>
        </div>

        <!-- PC 端分页导航 -->
        <GeneralPagination v-if="status !== 'pending' && fileList.length > 0" :current-page="pagination.page"
          :page-size="pagination.pageSize" :total="pagination.total"
          class="shrink-0 pt-4 border-t border-gray-200 mt-4 hidden md:flex" @change="changePage" />
      </div>
    </div>

    <!-- 上传文件对话框 -->
    <DiskSpaceUploadDialog v-model:open="showUploadDialog" @success="handleUploadSuccess" />

    <!-- 文件详情对话框 -->
    <DiskSpaceFileDetailDialog v-model:open="showFileDetailDialog" :file="selectedFile" @deleted="handleFileDeleted" />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "云盘空间",
  layout: "dashboard-layout",
});

import { UploadIcon, GridIcon, ListIcon, RefreshCwIcon, SearchIcon, FolderOpenIcon, XIcon } from "lucide-vue-next";
import { refDebounced } from "@vueuse/core";
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

// 当前页码（PC 端分页）
const currentPage = ref(1);

// 节流后的搜索关键词
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

// 构建查询参数
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
  watch: [queryParams],
});

// 同步数据到 store
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

// ==================== 移动端无限滚动相关 ====================

// 移动端当前页码
const mobilePage = ref(1);
// 移动端累积的文件列表
const mobileFileList = ref<OssFileItem[]>([]);
// 移动端加载状态
const mobileLoading = ref(false);
// 移动端刷新状态
const mobileRefreshing = ref(false);
// 移动端是否还有更多数据
const mobileHasMore = computed(() => {
  const total = pagination.value.total;
  return mobileFileList.value.length < total;
});

// 初始化移动端数据
watch(
  fileList,
  (newList) => {
    if (mobilePage.value === 1) {
      mobileFileList.value = [...newList];
    }
  },
  { immediate: true }
);

/**
 * 移动端加载更多
 */
const loadMoreMobile = async () => {
  if (mobileLoading.value || !mobileHasMore.value) return;

  mobileLoading.value = true;
  mobilePage.value++;

  try {
    const currentSort = sortOptionsMap.value.find((option) => option.value === sortBy.value);
    const params = fileStore.buildFileListQuery({
      page: mobilePage.value,
      pageSize: 30,
      fileName: debouncedFileName.value,
      fileType: searchForm.fileType,
      source: searchForm.source,
      sortField: currentSort?.field,
      sortOrder: currentSort?.order,
    });

    const result = await useApiFetch<FileListResponse>(FILE_LIST_API, { query: params });
    if (result?.list) {
      mobileFileList.value = [...mobileFileList.value, ...result.list];
    }
  } finally {
    mobileLoading.value = false;
  }
};

/**
 * 移动端下拉刷新
 */
const refreshMobile = async () => {
  mobileRefreshing.value = true;
  mobilePage.value = 1;
  await refresh();
  mobileRefreshing.value = false;
};

// ==================== 页面操作 ====================

/** PC 端切换页码 */
const changePage = (page: number) => {
  currentPage.value = page;
};

/** 刷新列表 */
const handleRefresh = async () => {
  mobilePage.value = 1;
  await refresh();
};

// 监听排序变化，重置页码
watch(sortBy, () => {
  currentPage.value = 1;
  mobilePage.value = 1;
});

// 监听筛选变化，重置页码
watch(
  () => searchForm.fileType,
  (newValue, oldValue) => {
    if (initialized.value && oldValue !== undefined && newValue !== oldValue) {
      currentPage.value = 1;
      mobilePage.value = 1;
    }
  }
);

watch(
  () => searchForm.source,
  (newValue, oldValue) => {
    if (initialized.value && oldValue !== undefined && newValue !== oldValue) {
      currentPage.value = 1;
      mobilePage.value = 1;
    }
  }
);

watch(debouncedFileName, (newValue, oldValue) => {
  if (initialized.value && oldValue !== undefined && newValue !== oldValue) {
    currentPage.value = 1;
    mobilePage.value = 1;
  }
});

// 上传成功回调
const handleUploadSuccess = () => {
  refresh();
};

// 文件删除成功回调
const handleFileDeleted = () => {
  refresh();
};

// ==================== 文件详情 ====================

/** 打开文件详情对话框 */
const openFileDetail = (file: OssFileItem) => {
  selectedFile.value = file;
  showFileDetailDialog.value = true;
};

// 组件挂载后标记已初始化
onMounted(() => {
  initialized.value = true;
});
</script>

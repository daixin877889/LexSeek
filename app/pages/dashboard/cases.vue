<template>
  <div class="p-4 md:p-6">
    <!-- 页面头部 -->
    <div class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <h1 class="text-2xl md:text-3xl font-bold mb-1">我的案件</h1>
        <p class="text-muted-foreground text-sm">查看和管理您的所有案件分析记录</p>
      </div>
      <NuxtLink to="/dashboard/analysis">
        <Button class="w-full md:w-auto">
          <Plus class="h-4 w-4 mr-2" />
          新建分析
        </Button>
      </NuxtLink>
    </div>

    <!-- 筛选区域 -->
    <CasesFilter :case-types="caseTypes" v-model:case-type-id="filters.caseTypeId" v-model:status="filters.status"
      v-model:title="filters.title" />

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
    </div>

    <!-- 空状态 -->
    <CasesEmpty v-else-if="!cases || cases.length === 0" :has-filters="hasFilters" @reset="resetFilters" />

    <!-- 案件列表 -->
    <template v-else>
      <!-- 桌面端表格 -->
      <CasesTable :list="cases" :case-types="caseTypes" @delete="confirmDelete" />

      <!-- 移动端卡片 -->
      <CasesMobile :list="cases" :case-types="caseTypes" @delete="confirmDelete" />

      <!-- 分页 -->
      <div class="mt-4">
        <GeneralPagination v-model:current-page="pagination.page" :page-size="pagination.pageSize"
          :total="pagination.total" @change="handlePageChange" />
      </div>
    </template>

    <!-- 删除确认弹框 -->
    <CasesDeleteDialog v-model:open="showDeleteDialog" :loading="isDeleting" @confirm="handleDelete" />
  </div>
</template>

<script lang="ts" setup>
import { Plus, Loader2 } from "lucide-vue-next";

// 页面元信息
definePageMeta({
  title: "我的案件",
  layout: "dashboard-layout",
});

// ==================== 类型定义 ====================

/** 案件项 */
interface CaseItem {
  id: number;
  title: string;
  caseTypeId: number;
  status: number;
  createdAt: string;
}

/** 案件类型 */
interface CaseType {
  id: number;
  name: string;
}

/** 分页信息 */
interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ==================== 模拟数据 ====================

// 是否使用模拟数据（开发阶段设为 true，API 完成后改为 false）
const USE_MOCK_DATA = true;

// 模拟案件类型数据
const mockCaseTypes: CaseType[] = [
  { id: 1, name: "民事纠纷" },
  { id: 2, name: "刑事案件" },
  { id: 3, name: "行政诉讼" },
  { id: 4, name: "知识产权" },
  { id: 5, name: "劳动争议" },
];

// 模拟案件列表数据
const mockCases: CaseItem[] = [
  {
    id: 1,
    title: "张三与李四房屋买卖合同纠纷案",
    caseTypeId: 1,
    status: 2,
    createdAt: "2024-12-28T10:30:00Z",
  },
  {
    id: 2,
    title: "王某某涉嫌盗窃罪案件分析",
    caseTypeId: 2,
    status: 1,
    createdAt: "2024-12-27T14:20:00Z",
  },
  {
    id: 3,
    title: "某公司商标侵权纠纷案",
    caseTypeId: 4,
    status: 2,
    createdAt: "2024-12-26T09:15:00Z",
  },
  {
    id: 4,
    title: "劳动合同解除赔偿争议案",
    caseTypeId: 5,
    status: 0,
    createdAt: "2024-12-25T16:45:00Z",
  },
  {
    id: 5,
    title: "行政处罚决定复议案件",
    caseTypeId: 3,
    status: 2,
    createdAt: "2024-12-24T11:00:00Z",
  },
  {
    id: 6,
    title: "借款合同纠纷案件分析",
    caseTypeId: 1,
    status: 1,
    createdAt: "2024-12-23T08:30:00Z",
  },
  {
    id: 7,
    title: "交通事故责任认定争议案",
    caseTypeId: 1,
    status: 2,
    createdAt: "2024-12-22T15:20:00Z",
  },
  {
    id: 8,
    title: "专利侵权损害赔偿案",
    caseTypeId: 4,
    status: 0,
    createdAt: "2024-12-21T13:10:00Z",
  },
];

// ==================== 状态定义 ====================

// 加载状态
const loading = ref(true);

// 案件列表
const cases = ref<CaseItem[]>([]);

// 案件类型列表
const caseTypes = ref<CaseType[]>([]);

// 分页信息
const pagination = reactive<PaginationInfo>({
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
});

// 筛选条件
const filters = reactive({
  title: "",
  caseTypeId: "",
  status: "",
});

// 删除相关状态
const showDeleteDialog = ref(false);
const caseToDelete = ref<number | null>(null);
const isDeleting = ref(false);

// ==================== 计算属性 ====================

/** 是否有筛选条件 */
const hasFilters = computed(() => {
  return !!(filters.title || filters.caseTypeId || filters.status);
});

// ==================== 监听器 ====================

// 监听筛选条件变化，重置页码并重新获取数据
watch(
  filters,
  () => {
    pagination.page = 1;
    fetchCases();
  },
  { deep: true }
);

// ==================== 方法定义 ====================

/**
 * 获取案件列表
 */
const fetchCases = async () => {
  loading.value = true;
  try {
    // 使用模拟数据
    if (USE_MOCK_DATA) {
      // 模拟网络延迟
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 筛选数据
      let filteredCases = [...mockCases];

      // 按标题筛选
      if (filters.title) {
        filteredCases = filteredCases.filter((c) =>
          c.title.toLowerCase().includes(filters.title.toLowerCase())
        );
      }

      // 按类型筛选
      if (filters.caseTypeId) {
        filteredCases = filteredCases.filter(
          (c) => c.caseTypeId === Number(filters.caseTypeId)
        );
      }

      // 按状态筛选
      if (filters.status !== "") {
        filteredCases = filteredCases.filter(
          (c) => c.status === Number(filters.status)
        );
      }

      // 计算分页
      const total = filteredCases.length;
      const totalPages = Math.ceil(total / pagination.pageSize);
      const start = (pagination.page - 1) * pagination.pageSize;
      const end = start + pagination.pageSize;

      cases.value = filteredCases.slice(start, end);
      pagination.total = total;
      pagination.totalPages = totalPages;
      return;
    }

    // 构建查询参数
    const query: Record<string, string | number> = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    };

    // 添加筛选条件（移除空值）
    if (filters.title) query.title = filters.title;
    if (filters.caseTypeId) query.caseTypeId = filters.caseTypeId;
    if (filters.status) query.status = filters.status;

    // 调用 API（注意：API 路径需要根据实际后端实现调整）
    const result = await useApiFetch<{
      list: CaseItem[];
      pagination: PaginationInfo;
    }>("/api/v1/cases", { query });

    if (result) {
      cases.value = result.list || [];
      pagination.page = result.pagination.page;
      pagination.pageSize = result.pagination.pageSize;
      pagination.total = result.pagination.total;
      pagination.totalPages = result.pagination.totalPages;
    }
  } catch (error) {
    console.error("获取案件列表失败:", error);
    cases.value = [];
  } finally {
    loading.value = false;
  }
};

/**
 * 获取案件类型列表
 */
const fetchCaseTypes = async () => {
  // 使用模拟数据
  if (USE_MOCK_DATA) {
    caseTypes.value = mockCaseTypes;
    return;
  }

  const result = await useApiFetch<CaseType[]>("/api/v1/case-types");
  if (result) {
    caseTypes.value = result;
  }
};

/**
 * 重置筛选条件
 */
const resetFilters = () => {
  filters.title = "";
  filters.caseTypeId = "";
  filters.status = "";
  pagination.page = 1;
};

/**
 * 处理分页变化
 */
const handlePageChange = (page: number) => {
  pagination.page = page;
  fetchCases();
};

/**
 * 确认删除
 */
const confirmDelete = (id: number) => {
  caseToDelete.value = id;
  showDeleteDialog.value = true;
};

/**
 * 执行删除
 */
const handleDelete = async () => {
  if (!caseToDelete.value || isDeleting.value) return;

  isDeleting.value = true;
  try {
    // 使用模拟数据时，模拟删除操作
    if (USE_MOCK_DATA) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // 从模拟数据中移除（注意：这里只是演示，实际不会修改原数组）
      const index = mockCases.findIndex((c) => c.id === caseToDelete.value);
      if (index > -1) {
        mockCases.splice(index, 1);
      }
      toast.success("案件删除成功");
      showDeleteDialog.value = false;
      caseToDelete.value = null;
      fetchCases();
      return;
    }

    const result = await useApiFetch(`/api/v1/cases/${caseToDelete.value}`, {
      method: "DELETE",
    });

    if (result !== null) {
      toast.success("案件删除成功");
      showDeleteDialog.value = false;
      caseToDelete.value = null;
      // 刷新列表
      fetchCases();
    }
  } catch (error) {
    console.error("删除案件失败:", error);
  } finally {
    isDeleting.value = false;
  }
};

// ==================== 生命周期 ====================

onMounted(() => {
  fetchCaseTypes();
  fetchCases();
});
</script>

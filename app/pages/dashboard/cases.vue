<template>
  <div class="p-4 md:p-6">
    <!-- 页面头部 -->
    <div class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <h1 class="text-2xl md:text-3xl font-bold mb-1">我的案件</h1>
        <p class="text-muted-foreground text-sm">查看和管理您的所有案件分析记录</p>
      </div>
      <NuxtLink to="/case/analysis/0">
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
/**
 * 案件列表页面
 *
 * 展示用户的所有案件，支持状态筛选和搜索
 * - 显示案件状态（进行中/已完成/已关闭）
 * - 支持进入案件继续分析或查看结果
 *
 * @see Requirements 9.1, 9.2, 9.4
 */
import { Plus, Loader2 } from "lucide-vue-next";
import { toast } from "vue-sonner";

// 页面元信息
definePageMeta({
  title: "我的案件",
  layout: "dashboard-layout",
});

// ==================== 类型定义 ====================

/** 案件项（匹配 API 返回格式） */
interface CaseItem {
  id: number;
  title: string;
  content: string | null;
  caseTypeId: number;
  status: number; // 1-进行中，2-已完成，3-已关闭
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  caseType: {
    id: number;
    name: string;
  } | null;
  latestSession: {
    sessionId: string;
    status: number;
    createdAt: string;
  } | null;
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
    // 构建查询参数
    const query: Record<string, string | number> = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    };

    // 添加筛选条件（移除空值）
    if (filters.title) query.keyword = filters.title;
    if (filters.caseTypeId) query.caseTypeId = Number(filters.caseTypeId);
    if (filters.status) query.status = Number(filters.status);

    // 调用 API
    const result = await useApiFetch<{
      items: CaseItem[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>("/api/v1/cases", { query });

    if (result) {
      cases.value = result.items || [];
      pagination.page = result.page;
      pagination.pageSize = result.pageSize;
      pagination.total = result.total;
      pagination.totalPages = result.totalPages;
    }
  } catch (error) {
    logger.error("获取案件列表失败:", error);
    cases.value = [];
  } finally {
    loading.value = false;
  }
};

/**
 * 获取案件类型列表
 */
const fetchCaseTypes = async () => {
  try {
    const result = await useApiFetch<{ items: CaseType[] }>("/api/v1/case-types");
    if (result?.items) {
      caseTypes.value = result.items;
    }
  } catch (error) {
    logger.error("获取案件类型失败:", error);
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
    logger.error("删除案件失败:", error);
    toast.error("删除案件失败");
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

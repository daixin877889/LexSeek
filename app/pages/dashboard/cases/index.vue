<template>
  <div class="p-4 md:p-6 space-y-6 relative">
    <!-- 装饰性背景 (右上角渐变) -->
    <div class="absolute top-0 right-0 -z-10 w-1/3 h-1/4 bg-primary/5 blur-[100px] pointer-events-none"></div>

    <!-- 页面头部 -->
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
      <div class="space-y-1">
        <h1
          class="text-3xl font-bold tracking-tight bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          我的案件</h1>
        <p class="text-muted-foreground text-sm md:text-base">这里记录了您的法律探索足迹，随时回顾和继续分析</p>
      </div>
      <div class="flex items-center gap-3">
        <!-- 视图切换 (仅 PC) -->
        <div class="hidden md:flex items-center bg-muted/50 rounded-lg p-1 border">
          <Button variant="ghost" size="sm"
            :class="['h-8 w-8 p-0 rounded-md transition-all', viewMode === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            @click="viewMode = 'list'" title="列表视图">
            <List class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm"
            :class="['h-8 w-8 p-0 rounded-md transition-all', viewMode === 'grid' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            @click="viewMode = 'grid'" title="卡片视图">
            <LayoutGrid class="h-4 w-4" />
          </Button>
        </div>

        <!-- <NuxtLink to="/dashboard/cases/create">
          <Button variant="outline" class="w-full md:w-auto transition-all hover:scale-105 active:scale-95">
            <Plus class="h-4 w-4 mr-2" />
            创建案件
          </Button>
        </NuxtLink>
        <NuxtLink to="/dashboard/cases/create">
          <Button class="w-full md:w-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95">
            <Plus class="h-4 w-4 mr-2" />
            新建分析
          </Button>
        </NuxtLink> -->
        <NuxtLink to="/dashboard/cases/create">
          <Button class="w-full md:w-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95">
            <Plus class="h-4 w-4 mr-2" />
            新建分析
          </Button>
        </NuxtLink>
      </div>
    </div>

    <!-- 快速统计卡片 -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card class="bg-card/50 backdrop-blur border-primary/10 hover:border-primary/30 transition-colors">
        <div class="p-4 flex items-center gap-4">
          <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Briefcase class="h-5 w-5" />
          </div>
          <div>
            <p class="text-xs text-muted-foreground uppercase font-medium">累计案件</p>
            <p class="text-2xl font-bold">{{ pagination.total }}</p>
          </div>
        </div>
      </Card>

      <Card class="bg-card/50 backdrop-blur border-primary/10 hover:border-primary/30 transition-colors">
        <div class="p-4 flex items-center gap-4">
          <div class="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
            <Clock class="h-5 w-5" />
          </div>
          <div>
            <p class="text-xs text-muted-foreground uppercase font-medium">进行中</p>
            <p class="text-2xl font-bold">{{cases.filter(c => c.status >= 1 && c.status <= 4).length}}<span
                class="text-sm font-normal text-muted-foreground ml-1">(当前页)</span></p>
          </div>
        </div>
      </Card>

      <Card class="bg-card/50 backdrop-blur border-primary/10 hover:border-primary/30 transition-colors">
        <div class="p-4 flex items-center gap-4">
          <div class="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
            <CheckCircle class="h-5 w-5" />
          </div>
          <div>
            <p class="text-xs text-muted-foreground uppercase font-medium">结案</p>
            <p class="text-2xl font-bold">{{cases.filter(c => c.status === 99).length}}<span
                class="text-sm font-normal text-muted-foreground ml-1">(当前页)</span></p>
          </div>
        </div>
      </Card>
    </div>

    <!-- 筛选区域 -->
    <div class="bg-card/50 backdrop-blur border rounded-xl overflow-hidden shadow-sm">
      <CasesFilter :case-types="caseTypes" v-model:case-type-id="filters.caseTypeId" v-model:status="filters.status"
        v-model:title="filters.title" />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-24">
      <div class="relative">
        <Loader2 class="h-12 w-12 animate-spin text-primary" />
        <div class="absolute inset-0 blur-xl bg-primary/20 -z-10 animate-pulse"></div>
      </div>
    </div>

    <!-- 空状态 -->
    <CasesEmpty v-else-if="!cases || cases.length === 0" :has-filters="hasFilters" @reset="resetFilters" />

    <!-- 案件列表 -->
    <template v-else>
      <!-- 列表内容 -->
      <div class="space-y-4">
        <!-- 桌面端 -->
        <div class="hidden md:block">
          <CasesTable v-if="viewMode === 'list'" :list="cases" :case-types="caseTypes" @delete="confirmDelete" @archived="fetchCases" />
          <CasesGrid v-else :list="cases" :case-types="caseTypes" @delete="confirmDelete" @archived="fetchCases" />
        </div>

        <!-- 移动端卡片 -->
        <CasesMobile :list="cases" :case-types="caseTypes" @delete="confirmDelete" @archived="fetchCases" />
      </div>

      <!-- 分页 -->
      <div class="mt-8 flex justify-center md:justify-end">
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
import { Plus, Loader2, Briefcase, Clock, CheckCircle, List, LayoutGrid } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { CaseListItem, CaseTypeOption } from "#shared/types/case";
import CasesDeleteDialog from '~/components/cases/CasesDeleteDialog.vue'
import CasesEmpty from '~/components/cases/CasesEmpty.vue'
import CasesFilter from '~/components/cases/CasesFilter.vue'
import CasesGrid from '~/components/cases/CasesGrid.vue'
import CasesMobile from '~/components/cases/CasesMobile.vue'
import CasesTable from '~/components/cases/CasesTable.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import type { caseTypes, cases } from '~~/generated/prisma/client'

// 页面元信息
definePageMeta({
  title: "我的案件",
  layout: "dashboard-layout",
});

const route = useRoute();
const router = useRouter();

// 从 URL 解析初始页码（非法/缺省时回落到 1）
const parsePageFromQuery = (value: unknown): number => {
  const raw = Array.isArray(value) ? value[0] : value;
  const num = Number(raw);
  return Number.isInteger(num) && num >= 1 ? num : 1;
};

const initialPage = parsePageFromQuery(route.query.page);

// 将当前页码同步到 URL（page=1 时移除参数，保持链接简洁）
const syncPageToUrl = (page: number) => {
  const query = { ...route.query };
  if (page <= 1) delete query.page;
  else query.page = String(page);
  router.replace({ query });
};

// ==================== 类型定义 ====================

/** 分页信息 */
interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ==================== 状态定义 ====================

/** 视图模式 */
const viewMode = ref<"list" | "grid">("list");

// 加载状态
const loading = ref(true);

// 案件列表
const cases = ref<CaseListItem[]>([]);

// 案件类型列表
const caseTypes = ref<CaseTypeOption[]>([]);

// 分页信息
const pagination = reactive<PaginationInfo>({
  page: initialPage,
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
    syncPageToUrl(pagination.page);
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
      items: CaseListItem[];
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
      // 后端可能对越界页码做了修正，保持 URL 与实际页码一致
      syncPageToUrl(result.page);
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
    const result = await useApiFetch<{ items: CaseTypeOption[] }>("/api/v1/case-types");
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
  syncPageToUrl(page);
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
    await useApiFetch(`/api/v1/cases/${caseToDelete.value}`, {
      method: "DELETE",
    });

    toast.success("案件删除成功");
    showDeleteDialog.value = false;
    caseToDelete.value = null;
    // 刷新列表
    fetchCases();
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

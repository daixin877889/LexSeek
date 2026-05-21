<template>
  <div class="relative space-y-6 p-4 md:p-6">
    <!-- 装饰性背景（右上角品牌光晕） -->
    <div class="pointer-events-none absolute right-0 top-0 -z-10 h-1/4 w-1/3 bg-primary/5 blur-[100px]" />

    <!-- 页面头部 -->
    <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="space-y-1">
        <h1 class="text-3xl font-bold tracking-tight text-foreground">我的案件</h1>
        <p class="text-sm text-muted-foreground md:text-base">这里记录了您的法律探索足迹，随时回顾和继续分析</p>
      </div>
      <NuxtLink to="/dashboard/cases/create">
        <Button
          class="w-full bg-gradient-brand-button text-white shadow-lg shadow-primary/25 transition hover:brightness-105 active:scale-95 md:w-auto">
          <Plus class="mr-2 size-4" />
          新建案件
        </Button>
      </NuxtLink>
    </div>

    <!-- 快速统计卡片（移动端也保持一行 3 列，图标文字横向排列） -->
    <div class="grid grid-cols-3 gap-3 sm:gap-4">
      <Card v-for="stat in caseStats" :key="stat.label" class="border-primary/10 bg-card/60 p-3 backdrop-blur transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md sm:p-5">
        <div class="flex items-center gap-2.5 sm:gap-4">
          <div :class="['flex size-9 shrink-0 items-center justify-center rounded-lg sm:size-11 sm:rounded-xl', TINTS[stat.tint]]">
            <component :is="stat.icon" class="size-4 sm:size-5" />
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{{ stat.label }}</p>
            <p class="text-xl font-bold text-foreground sm:text-2xl">{{ stat.value }}</p>
          </div>
        </div>
      </Card>
    </div>

    <!-- 工具栏：筛选 + 视图切换 -->
    <div class="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 backdrop-blur sm:flex-row sm:items-center">
      <CasesFilter class="flex-1" :case-types="caseTypes" v-model:case-type-id="filters.caseTypeId"
        v-model:status="filters.status" v-model:title="filters.title" />
      <div class="hidden shrink-0 items-center gap-1 self-end rounded-lg border bg-muted p-1 md:flex">
        <button type="button" title="列表视图" aria-label="列表视图"
          class="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
          :class="viewMode === 'list' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="viewMode = 'list'">
          <List class="size-4" />
        </button>
        <button type="button" title="卡片视图" aria-label="卡片视图"
          class="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
          :class="viewMode === 'grid' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="viewMode = 'grid'">
          <LayoutGrid class="size-4" />
        </button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-24">
      <div class="relative">
        <Loader2 class="size-12 animate-spin text-primary" />
        <div class="absolute inset-0 -z-10 animate-pulse bg-primary/20 blur-xl" />
      </div>
    </div>

    <!-- 空状态 -->
    <CasesEmpty v-else-if="cases.length === 0" :has-filters="hasFilters" @reset="resetFilters" />

    <!-- 案件列表 -->
    <template v-else>
      <div class="space-y-4">
        <!-- 桌面端 -->
        <div class="hidden md:block">
          <CasesList v-if="viewMode === 'list'" :list="cases" :case-types="caseTypes" @delete="confirmDelete" @archived="fetchCases" />
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
import type { Component } from 'vue'
import { Plus, Loader2, Briefcase, Clock, CheckCircle, List, LayoutGrid } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { CaseListItem, CaseTypeOption, CaseStatusSummary } from "#shared/types/case";
import CasesDeleteDialog from '~/components/cases/CasesDeleteDialog.vue'
import CasesEmpty from '~/components/cases/CasesEmpty.vue'
import CasesFilter from '~/components/cases/CasesFilter.vue'
import CasesGrid from '~/components/cases/CasesGrid.vue'
import CasesMobile from '~/components/cases/CasesMobile.vue'
import CasesList from '~/components/cases/CasesList.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'

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

/** 统计卡品牌淡彩图标块 */
type StatTint = 'sky' | 'mint' | 'navy'
const TINTS: Record<StatTint, string> = {
  sky: 'bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]',
  mint: 'bg-[image:var(--tint-mint-bg)] text-[color:var(--tint-mint-fg)]',
  navy: 'bg-[image:var(--tint-navy-bg)] text-[color:var(--tint-navy-fg)]',
}

interface CaseStat {
  label: string
  value: number
  icon: Component
  tint: StatTint
}

/** 案件状态概览（来自接口，跨全部案件，不受筛选 / 分页影响） */
const statusSummary = ref<CaseStatusSummary>({ total: 0, inProgress: 0, closed: 0 })

/** 三张统计卡——均取自跨全部案件的状态概览 */
const caseStats = computed<CaseStat[]>(() => [
  { label: '累计案件', value: statusSummary.value.total, icon: Briefcase, tint: 'sky' },
  { label: '进行中', value: statusSummary.value.inProgress, icon: Clock, tint: 'mint' },
  { label: '结案', value: statusSummary.value.closed, icon: CheckCircle, tint: 'navy' },
])

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
      statusSummary: CaseStatusSummary;
    }>("/api/v1/cases", { query });

    if (result) {
      cases.value = result.items || [];
      pagination.page = result.page;
      pagination.pageSize = result.pageSize;
      pagination.total = result.total;
      pagination.totalPages = result.totalPages;
      statusSummary.value = result.statusSummary;
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

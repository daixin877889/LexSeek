<template>
  <div class="w-full bg-card rounded-lg border p-6">
    <!-- 标题和操作按钮 -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-3">
      <h2 class="text-xl font-semibold leading-none">
        我的积分
        <span class="text-xs text-muted-foreground font-normal mt-1"> (不含已过期和未生效积分) </span>
      </h2>
      <div class="flex gap-2 sm:shrink-0">
        <Button variant="outline" class="h-10 px-4 py-2 flex-1 sm:flex-initial" @click="showConsumptionStandard = true"> 积分消耗标准 </Button>
        <Button class="h-10 px-4 py-2 flex-1 sm:flex-initial" @click="showPointProducts = true"> 购买积分 </Button>
      </div>
    </div>

    <!-- 积分统计卡片 -->
    <div class="bg-muted/30 rounded-lg p-4 mb-2 pt-2 pl-0">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- 当前可用积分 -->
        <div>
          <p class="text-sm text-muted-foreground mb-2">当前可用总积分</p>
          <p class="text-3xl font-bold mb-1">
            {{ pointInfo.remaining }}
          </p>
          <p class="text-xs text-muted-foreground">可用购买积分+可用赠送积分</p>
        </div>
        <!-- 购买积分 -->
        <div>
          <p class="text-xs text-muted-foreground mb-2">可用购买积分</p>
          <p class="text-3xl font-semibold text-muted-foreground mb-1">
            {{ pointInfo.purchasePoint }}
          </p>
          <p class="text-xs text-muted-foreground">购买会员赠送或直接购买</p>
        </div>
        <!-- 赠送积分 -->
        <div>
          <p class="text-xs text-muted-foreground mb-2">可用赠送积分</p>
          <p class="text-3xl font-semibold text-muted-foreground mb-1">
            {{ pointInfo.otherPoint }}
          </p>
          <p class="text-xs text-muted-foreground">参与活动或系统赠送</p>
        </div>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="mb-6">
      <Tabs v-model="currentTab" class="w-full">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="history">积分获取记录</TabsTrigger>
          <TabsTrigger value="usage">积分使用记录</TabsTrigger>
        </TabsList>

        <!-- 积分获取记录 Tab -->
        <TabsContent value="history" class="mt-4">
          <!-- 桌面端表格视图 -->
          <div class="border rounded-lg overflow-hidden hidden md:block">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium">积分来源</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">积分数量</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">已使用积分</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">剩余积分</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">是否可用</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                <!-- 加载中 -->
                <tr v-if="historyLoading">
                  <td colspan="8" class="px-4 py-8 text-center">
                    <div class="flex items-center justify-center">
                      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      <span class="ml-2 text-muted-foreground">加载中...</span>
                    </div>
                  </td>
                </tr>
                <!-- 空状态 -->
                <tr v-else-if="historyList.length === 0">
                  <td colspan="8" class="px-4 py-8 text-center text-muted-foreground">暂无积分获取记录</td>
                </tr>
                <!-- 数据列表 -->
                <template v-else>
                  <tr v-for="record in historyList" :key="record.id" class="border-b last:border-b-0 hover:bg-muted/30">
                    <td class="px-4 py-3 text-sm">{{ record.sourceTypeName }}</td>
                    <td class="px-4 py-3 text-sm">{{ record.pointAmount }}</td>
                    <td class="px-4 py-3 text-sm">{{ record.used }}</td>
                    <td class="px-4 py-3 text-sm">{{ record.remaining }}</td>
                    <td class="px-4 py-3 text-sm">
                      {{ dayjs(record.effectiveAt).format("YYYY年MM月DD日") }} -
                      {{ dayjs(record.expiredAt).format("YYYY年MM月DD日") }}
                    </td>
                    <td class="px-4 py-3 text-sm">
                      <span v-if="record.status === 1" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                      <span v-else-if="record.status === 2" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">已结算</span>
                      <span v-else-if="record.status === 3" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                    </td>
                    <td class="px-4 py-3 text-sm">
                      <span v-if="isAvailable(record)" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">可用</span>
                      <span v-else-if="isNotEffective(record)" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">未生效</span>
                      <span v-else class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-400">已过期</span>
                    </td>
                    <td class="px-4 py-3 text-sm">{{ record.remark || "-" }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="md:hidden space-y-4">
            <div v-if="historyLoading" class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span class="ml-2 text-muted-foreground">加载中...</span>
            </div>
            <div v-else-if="historyList.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">暂无积分获取记录</div>
            <div v-else v-for="record in historyList" :key="record.id" class="border rounded-lg p-4 space-y-3">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-medium text-sm mb-1">{{ record.sourceTypeName }}</h3>
                  <p class="text-lg font-bold text-primary">{{ record.pointAmount }} 积分</p>
                </div>
                <div class="flex flex-col gap-1">
                  <span v-if="record.status === 1" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                  <span v-else-if="record.status === 2" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">已结算</span>
                  <span v-else-if="record.status === 3" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                  <span v-if="isAvailable(record)" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">可用</span>
                  <span v-else-if="isNotEffective(record)" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">未生效</span>
                  <span v-else class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-400">已过期</span>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p class="text-muted-foreground">已使用</p>
                  <p class="font-medium">{{ record.used }}</p>
                </div>
                <div>
                  <p class="text-muted-foreground">剩余</p>
                  <p class="font-medium">{{ record.remaining }}</p>
                </div>
              </div>
              <div class="text-sm">
                <p class="text-muted-foreground mb-1">有效期</p>
                <p>{{ dayjs(record.effectiveAt).format("YYYY年MM月DD日") }} - {{ dayjs(record.expiredAt).format("YYYY年MM月DD日") }}</p>
              </div>
              <div v-if="record.remark" class="text-sm">
                <p class="text-muted-foreground mb-1">备注</p>
                <p>{{ record.remark }}</p>
              </div>
            </div>
          </div>

          <!-- 积分获取记录分页 -->
          <div v-if="historyPagination.totalPages > 1" class="mt-4 flex justify-between items-center">
            <div class="text-sm text-muted-foreground">显示 {{ historyList.length }} 条，共 {{ historyPagination.total }} 条</div>
            <div class="flex items-center gap-1">
              <button :disabled="historyCurrentPage <= 1" :class="['p-1 rounded-md', historyCurrentPage <= 1 ? 'text-muted-foreground cursor-not-allowed' : 'hover:bg-muted']" @click="onHistoryPageChange(historyCurrentPage - 1)">
                <ChevronLeft class="h-5 w-5" />
              </button>
              <span class="px-3 py-1">{{ historyCurrentPage }} / {{ historyPagination.totalPages }}</span>
              <button :disabled="historyCurrentPage >= historyPagination.totalPages" :class="['p-1 rounded-md', historyCurrentPage >= historyPagination.totalPages ? 'text-muted-foreground cursor-not-allowed' : 'hover:bg-muted']" @click="onHistoryPageChange(historyCurrentPage + 1)">
                <ChevronRight class="h-5 w-5" />
              </button>
            </div>
          </div>
        </TabsContent>

        <!-- 积分使用记录 Tab -->
        <TabsContent value="usage" class="mt-4">
          <!-- 桌面端表格视图 -->
          <div class="border rounded-lg overflow-hidden hidden md:block">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium">使用场景</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">消耗积分</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">使用时间</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                <!-- 加载中 -->
                <tr v-if="usageLoading">
                  <td colspan="5" class="px-4 py-8 text-center">
                    <div class="flex items-center justify-center">
                      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      <span class="ml-2 text-muted-foreground">加载中...</span>
                    </div>
                  </td>
                </tr>
                <!-- 空状态 -->
                <tr v-else-if="usageList.length === 0">
                  <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">暂无积分使用记录</td>
                </tr>
                <!-- 数据列表 -->
                <template v-else>
                  <tr v-for="usage in usageList" :key="usage.id" class="border-b last:border-b-0 hover:bg-muted/30">
                    <td class="px-4 py-3 text-sm">{{ usage.itemDescription }}</td>
                    <td class="px-4 py-3 text-sm">{{ usage.pointAmount }}</td>
                    <td class="px-4 py-3 text-sm">
                      <span v-if="usage.status === 0" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">异常</span>
                      <span v-else-if="usage.status === 1" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">预扣</span>
                      <span v-else-if="usage.status === 2" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">已结算</span>
                    </td>
                    <td class="px-4 py-3 text-sm">{{ dayjs(usage.createdAt).format("YYYY年MM月DD日 HH:mm") }}</td>
                    <td class="px-4 py-3 text-sm">{{ usage.remark || "-" }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="md:hidden space-y-4">
            <div v-if="usageLoading" class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span class="ml-2 text-muted-foreground">加载中...</span>
            </div>
            <div v-else-if="usageList.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">暂无积分使用记录</div>
            <div v-else v-for="usage in usageList" :key="usage.id" class="border rounded-lg p-4 space-y-3">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-medium text-sm mb-1">{{ usage.itemDescription }}</h3>
                  <p class="text-lg font-bold text-red-600">-{{ usage.pointAmount }} 积分</p>
                </div>
                <span v-if="usage.status === 0" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">异常</span>
                <span v-else-if="usage.status === 1" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">预扣</span>
                <span v-else-if="usage.status === 2" class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">已结算</span>
              </div>
              <div class="text-sm">
                <p class="text-muted-foreground mb-1">使用时间</p>
                <p>{{ dayjs(usage.createdAt).format("YYYY年MM月DD日 HH:mm") }}</p>
              </div>
              <div v-if="usage.remark" class="text-sm">
                <p class="text-muted-foreground mb-1">备注</p>
                <p>{{ usage.remark }}</p>
              </div>
            </div>
          </div>

          <!-- 积分使用记录分页 -->
          <div v-if="usagePagination.totalPages > 1" class="mt-4 flex justify-between items-center">
            <div class="text-sm text-muted-foreground">显示 {{ usageList.length }} 条，共 {{ usagePagination.total }} 条</div>
            <div class="flex items-center gap-1">
              <button :disabled="usageCurrentPage <= 1" :class="['p-1 rounded-md', usageCurrentPage <= 1 ? 'text-muted-foreground cursor-not-allowed' : 'hover:bg-muted']" @click="onUsagePageChange(usageCurrentPage - 1)">
                <ChevronLeft class="h-5 w-5" />
              </button>
              <span class="px-3 py-1">{{ usageCurrentPage }} / {{ usagePagination.totalPages }}</span>
              <button :disabled="usageCurrentPage >= usagePagination.totalPages" :class="['p-1 rounded-md', usageCurrentPage >= usagePagination.totalPages ? 'text-muted-foreground cursor-not-allowed' : 'hover:bg-muted']" @click="onUsagePageChange(usageCurrentPage + 1)">
                <ChevronRight class="h-5 w-5" />
              </button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>

    <!-- 购买积分弹框 -->
    <Dialog v-model:open="showPointProducts">
      <DialogContent class="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>购买积分</DialogTitle>
          <DialogDescription>选择合适的积分套餐，立即购买</DialogDescription>
        </DialogHeader>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
          <div v-for="product in pointProductList" :key="product.id" class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer relative">
            <div class="flex justify-between items-start mb-2">
              <h4 class="font-semibold">{{ product.name }}</h4>
              <Button size="sm" :disabled="!agreeToPurchaseAgreement" class="absolute top-2 right-2" @click.stop="buyPoints(product)"> 购买 </Button>
            </div>
            <p class="text-2xl font-bold mb-2">¥{{ product.unitPrice }}</p>
            <p class="text-xs text-muted-foreground">{{ product.description }}</p>
          </div>
        </div>
        <!-- 购买协议复选框 -->
        <div class="border-t pt-4">
          <div class="flex items-start space-x-2">
            <Checkbox id="purchase-agreement" v-model:checked="agreeToPurchaseAgreement" class="mt-1" />
            <label for="purchase-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
              购买即代表您同意
              <a href="/purchase-agreement" target="_blank" class="text-primary font-bold hover:text-primary/80"> 《LexSeek（法索 AI）服务购买协议》 </a>
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 微信支付二维码弹框 -->
    <Dialog v-model:open="showQRCode">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>请使用微信扫码购买</DialogTitle>
          <DialogDescription>打开微信扫一扫，立即购买积分</DialogDescription>
        </DialogHeader>
        <div class="flex justify-center py-4">
          <img :src="qrCodeUrl" alt="微信支付二维码" class="w-64 h-64" />
        </div>
      </DialogContent>
    </Dialog>

    <!-- 积分消耗标准弹框 -->
    <Dialog v-model:open="showConsumptionStandard">
      <DialogContent class="sm:max-w-[800px] max-h-[80vh] flex flex-col" @openAutoFocus="(e) => e.preventDefault()">
        <DialogHeader class="shrink-0">
          <DialogTitle>积分消耗标准</DialogTitle>
          <DialogDescription>查看各功能模块的积分消耗详情</DialogDescription>
        </DialogHeader>
        <div class="py-4 overflow-y-auto flex-1">
          <!-- 使用积分消耗标准组件 -->
          <PointsConsumptionStandard />
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script lang="ts" setup>
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// 配置 dayjs
dayjs.locale("zh-cn");

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "我的积分",
});

// ==================== 类型定义 ====================

/** 积分获取记录 */
interface PointHistoryRecord {
  id: number;
  sourceType: number;
  sourceTypeName: string;
  pointAmount: number;
  used: number;
  remaining: number;
  effectiveAt: string;
  expiredAt: string;
  status: number;
  remark?: string;
}

/** 积分使用记录 */
interface PointUsageRecord {
  id: number;
  itemDescription: string;
  pointAmount: number;
  status: number;
  createdAt: string;
  remark?: string;
}

/** 积分商品 */
interface PointProduct {
  id: number;
  name: string;
  unitPrice: number;
  description: string;
}

/** 分页信息 */
interface Pagination {
  total: number;
  totalPages: number;
}

// ==================== 状态定义 ====================

// 当前 Tab
const currentTab = ref("history");

// 积分信息（模拟数据）
const pointInfo = reactive({
  remaining: 1580,
  purchasePoint: 1000,
  otherPoint: 580,
});

// 积分获取记录
const historyLoading = ref(false);
const historyCurrentPage = ref(1);
const historyList = ref<PointHistoryRecord[]>([]);
const historyPagination = reactive<Pagination>({
  total: 0,
  totalPages: 0,
});

// 积分使用记录
const usageLoading = ref(false);
const usageCurrentPage = ref(1);
const usageList = ref<PointUsageRecord[]>([]);
const usagePagination = reactive<Pagination>({
  total: 0,
  totalPages: 0,
});

// 弹框状态
const showPointProducts = ref(false);
const showQRCode = ref(false);
const showConsumptionStandard = ref(false);
const qrCodeUrl = ref("");
const agreeToPurchaseAgreement = ref(true);

// 积分商品列表（模拟数据）
const pointProductList = ref<PointProduct[]>([
  { id: 1, name: "100 积分", unitPrice: 10, description: "适合轻度使用" },
  { id: 2, name: "500 积分", unitPrice: 45, description: "9折优惠，推荐购买" },
  { id: 3, name: "1000 积分", unitPrice: 80, description: "8折优惠，超值之选" },
  { id: 4, name: "5000 积分", unitPrice: 350, description: "7折优惠，企业首选" },
]);

// ==================== 工具方法 ====================

/**
 * 判断积分记录是否可用
 */
const isAvailable = (record: PointHistoryRecord): boolean => {
  const now = new Date();
  const effectiveAt = new Date(record.effectiveAt);
  const expiredAt = new Date(record.expiredAt);
  return effectiveAt < now && expiredAt > now;
};

/**
 * 判断积分记录是否未生效
 */
const isNotEffective = (record: PointHistoryRecord): boolean => {
  const now = new Date();
  const effectiveAt = new Date(record.effectiveAt);
  return effectiveAt > now;
};

/**
 * 获取来源类型名称
 */
const getSourceTypeName = (sourceType: number): string => {
  return PointRecordSourceTypeName[sourceType as keyof typeof PointRecordSourceTypeName] || "其他";
};

// ==================== 数据加载方法 ====================

/**
 * 加载积分获取记录（模拟数据）
 */
const loadHistoryList = async () => {
  historyLoading.value = true;
  try {
    // TODO: 替换为实际 API 调用
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 模拟数据
    historyList.value = [
      {
        id: 1,
        sourceType: 1,
        sourceTypeName: getSourceTypeName(1),
        pointAmount: 500,
        used: 120,
        remaining: 380,
        effectiveAt: "2024-01-01T00:00:00Z",
        expiredAt: "2025-12-31T23:59:59Z",
        status: 1,
        remark: "购买年度会员赠送",
      },
      {
        id: 2,
        sourceType: 7,
        sourceTypeName: getSourceTypeName(7),
        pointAmount: 100,
        used: 100,
        remaining: 0,
        effectiveAt: "2024-01-15T00:00:00Z",
        expiredAt: "2024-07-15T23:59:59Z",
        status: 1,
        remark: "新用户注册赠送",
      },
      {
        id: 3,
        sourceType: 8,
        sourceTypeName: getSourceTypeName(8),
        pointAmount: 300,
        used: 0,
        remaining: 300,
        effectiveAt: "2024-06-01T00:00:00Z",
        expiredAt: "2025-06-01T23:59:59Z",
        status: 1,
        remark: "邀请好友注册奖励",
      },
    ];
    historyPagination.total = 3;
    historyPagination.totalPages = 1;
  } finally {
    historyLoading.value = false;
  }
};

/**
 * 加载积分使用记录（模拟数据）
 */
const loadUsageList = async () => {
  usageLoading.value = true;
  try {
    // TODO: 替换为实际 API 调用
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 模拟数据
    usageList.value = [
      {
        id: 1,
        itemDescription: "AI 对话 - 深度分析",
        pointAmount: 5,
        status: 2,
        createdAt: "2024-12-20T10:30:00Z",
        remark: "",
      },
      {
        id: 2,
        itemDescription: "文档解析 - PDF 文档",
        pointAmount: 10,
        status: 2,
        createdAt: "2024-12-19T14:20:00Z",
        remark: "合同文档解析",
      },
      {
        id: 3,
        itemDescription: "案例检索",
        pointAmount: 3,
        status: 1,
        createdAt: "2024-12-18T09:15:00Z",
        remark: "",
      },
    ];
    usagePagination.total = 3;
    usagePagination.totalPages = 1;
  } finally {
    usageLoading.value = false;
  }
};

// ==================== 事件处理 ====================

/**
 * 积分获取记录分页变化
 */
const onHistoryPageChange = (page: number) => {
  if (page < 1 || page > historyPagination.totalPages) return;
  historyCurrentPage.value = page;
  loadHistoryList();
};

/**
 * 积分使用记录分页变化
 */
const onUsagePageChange = (page: number) => {
  if (page < 1 || page > usagePagination.totalPages) return;
  usageCurrentPage.value = page;
  loadUsageList();
};

/**
 * 购买积分
 */
const buyPoints = async (product: PointProduct) => {
  // TODO: 实现购买逻辑
  logger.info("购买积分:", product);
  toast.info(`购买 ${product.name} 功能开发中`);
};

// ==================== 监听器 ====================

// 监听 Tab 切换，加载对应数据
watch(currentTab, (newTab) => {
  if (newTab === "usage" && usageList.value.length === 0) {
    loadUsageList();
  }
});

// ==================== 生命周期 ====================

onMounted(() => {
  loadHistoryList();
});
</script>

<style scoped>
/* 积分页面样式 */
</style>

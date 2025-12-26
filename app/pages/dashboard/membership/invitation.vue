<template>
  <div class="w-full bg-card rounded-lg border p-6">
    <div class="mb-6">
      <h3 class="text-lg font-medium">邀请注册</h3>
      <p class="text-sm text-muted-foreground">邀请好友注册，共同享受 LexSeek 服务</p>
    </div>

    <!-- Tab 导航 -->
    <Tabs v-model="activeTab" class="w-full">
      <TabsList class="grid w-full grid-cols-2">
        <TabsTrigger value="invite-link">邀请链接</TabsTrigger>
        <TabsTrigger value="invite-records">邀请记录</TabsTrigger>
      </TabsList>

      <!-- 邀请链接 Tab -->
      <TabsContent value="invite-link" class="mt-6">
        <div class="space-y-6">
          <!-- 邀请码展示区域 -->
          <div class="border rounded-lg p-6 bg-card">
            <div class="space-y-4">
              <!-- 邀请链接 -->
              <div>
                <Label class="text-sm font-medium">邀请链接</Label>
                <div class="flex items-center space-x-2 mt-1">
                  <Input :model-value="inviteLink" readonly class="flex-1"
                    :placeholder="inviteLink ? '' : '正在获取邀请链接...'" />
                  <Button variant="outline" size="sm" @click="copyInviteLink" :disabled="!inviteLink">
                    <Copy class="h-4 w-4 mr-1" />
                    复制
                  </Button>
                </div>
              </div>

              <!-- 二维码 -->
              <div class="flex flex-col items-center space-y-2">
                <Label class="text-sm font-medium">邀请二维码</Label>
                <div class="p-4 bg-white rounded-lg border">
                  <div ref="qrcodeContainer" class="w-32 h-32 flex items-center justify-center">
                    <div v-if="!qrCodeGenerated" class="text-muted-foreground text-sm">生成中...</div>
                  </div>
                </div>
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" @click="downloadQRCode" :disabled="!qrCodeGenerated">
                    <Download class="h-4 w-4 mr-1" />
                    下载二维码
                  </Button>
                  <Button variant="outline" size="sm" @click="regenerateQRCode">
                    <RefreshCw class="h-4 w-4 mr-1" />
                    重新生成
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <!-- 邀请规则说明 -->
          <div class="border rounded-lg p-6 bg-card">
            <h4 class="text-base font-medium mb-4">邀请规则</h4>
            <div class="space-y-2 text-sm text-muted-foreground">
              <div class="flex items-start space-x-2">
                <div class="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0"></div>
                <p>分享邀请码或邀请链接给好友，好友注册时填写您的邀请码</p>
              </div>
              <div class="flex items-start space-x-2">
                <div class="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0"></div>
                <p>好友成功注册后，您可以获得 <span class="font-medium text-red-500">300</span> 积分奖励</p>
              </div>
              <div class="flex items-start space-x-2">
                <div class="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0"></div>
                <p>邀请码长期有效，可重复使用</p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- 邀请记录 Tab -->
      <TabsContent value="invite-records" class="mt-6">
        <div class="border rounded-lg p-6 bg-card">
          <div class="flex items-center justify-between mb-4">
            <h4 class="text-base font-medium">邀请记录</h4>
            <Button variant="outline" size="sm" @click="fetchInvitees" :disabled="loading">
              <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
              刷新
            </Button>
          </div>

          <!-- 空状态 -->
          <div v-if="invitees.length === 0" class="text-center py-8">
            <UserPlus class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p class="text-muted-foreground">暂无邀请记录</p>
            <p class="text-sm text-muted-foreground mt-1">快分享你的邀请码给好友吧</p>
          </div>

          <!-- 邀请记录列表 -->
          <div v-else class="space-y-4">
            <div class="text-sm text-muted-foreground mb-2">
              共邀请了 <span class="font-medium text-foreground">{{ invitees.length }}</span> 位用户
            </div>
            <div class="space-y-2">
              <div v-for="invitee in invitees" :key="invitee.id"
                class="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div class="flex items-center space-x-3">
                  <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User class="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div class="font-medium">
                      {{ invitee.name || "未知用户" }}
                      <span class="text-muted-foreground text-sm">{{ invitee.phone }}</span>
                    </div>
                    <div class="text-sm text-muted-foreground">注册时间：{{ formatDate(invitee.createdAt) }}</div>
                  </div>
                </div>
                <div class="text-sm">
                  <span
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    已注册 </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<script lang="ts" setup>
import { RefreshCw, Copy, Download, UserPlus, User } from "lucide-vue-next";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// 配置 dayjs
dayjs.locale("zh-cn");

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "邀请注册",
});

// 获取用户 store
const userStore = useUserStore();

// 状态
const activeTab = ref("invite-link");
const loading = ref(false);
const qrcodeContainer = ref<HTMLElement | null>(null);
const qrCodeGenerated = ref(false);

// 缓存二维码 canvas，避免切换 tab 后丢失
let cachedQRCodeCanvas: HTMLCanvasElement | null = null;

// 二维码配置：高清晰度，适合印刷
const QR_CODE_CONFIG = {
  displayWidth: 128,  // 显示尺寸
  exportWidth: 512,   // 导出尺寸（4倍，适合印刷）
  color: {
    dark: "#000000",
    light: "#FFFFFF",
  },
  margin: 2,          // 边距
  errorCorrectionLevel: 'H' as const,  // 最高纠错级别
};

// 邀请记录类型
interface Invitee {
  id: number;
  name: string;
  phone: string;
  createdAt: string;
}
const invitees = ref<Invitee[]>([]);

// 计算邀请链接
const inviteCode = computed(() => userStore.userInfo.inviteCode || "");
const inviteLink = computed(() => {
  if (!inviteCode.value) return "";
  const baseUrl = import.meta.client ? window.location.origin : "";
  return `${baseUrl}/register?invitedBy=${inviteCode.value}`;
});

// 生成二维码
const generateQRCode = async (forceRegenerate = false) => {
  if (!inviteLink.value || !qrcodeContainer.value) return;

  // 如果有缓存且不强制重新生成，直接使用缓存
  if (cachedQRCodeCanvas && !forceRegenerate) {
    qrcodeContainer.value.innerHTML = "";
    // 创建显示用的 canvas（缩小显示）
    const displayCanvas = document.createElement("canvas");
    displayCanvas.width = QR_CODE_CONFIG.displayWidth;
    displayCanvas.height = QR_CODE_CONFIG.displayWidth;
    const ctx = displayCanvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(cachedQRCodeCanvas, 0, 0, QR_CODE_CONFIG.displayWidth, QR_CODE_CONFIG.displayWidth);
    }
    qrcodeContainer.value.appendChild(displayCanvas);
    qrCodeGenerated.value = true;
    return;
  }

  try {
    // 动态导入 QRCode 库
    const QRCode = await import("qrcode");

    // 创建高清 canvas（用于导出）
    cachedQRCodeCanvas = document.createElement("canvas");
    await QRCode.toCanvas(cachedQRCodeCanvas, inviteLink.value, {
      width: QR_CODE_CONFIG.exportWidth,
      margin: QR_CODE_CONFIG.margin,
      errorCorrectionLevel: QR_CODE_CONFIG.errorCorrectionLevel,
      color: QR_CODE_CONFIG.color,
    });

    // 创建显示用的 canvas（缩小显示，保持清晰）
    const displayCanvas = document.createElement("canvas");
    displayCanvas.width = QR_CODE_CONFIG.displayWidth;
    displayCanvas.height = QR_CODE_CONFIG.displayWidth;
    const ctx = displayCanvas.getContext("2d");
    if (ctx) {
      // 使用高质量缩放
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cachedQRCodeCanvas, 0, 0, QR_CODE_CONFIG.displayWidth, QR_CODE_CONFIG.displayWidth);
    }

    // 清空容器并添加显示用 canvas
    qrcodeContainer.value.innerHTML = "";
    qrcodeContainer.value.appendChild(displayCanvas);
    qrCodeGenerated.value = true;
  } catch (error) {
    logger.error("生成二维码失败:", error);
    if (qrcodeContainer.value) {
      qrcodeContainer.value.innerHTML = '<div class="text-red-500 text-sm">生成失败</div>';
    }
  }
};

// 重新生成二维码
const regenerateQRCode = async () => {
  qrCodeGenerated.value = false;
  cachedQRCodeCanvas = null;  // 清除缓存
  if (qrcodeContainer.value) {
    qrcodeContainer.value.innerHTML = '<div class="text-muted-foreground text-sm">生成中...</div>';
  }
  await nextTick();
  await generateQRCode(true);
};

// 复制邀请链接
const copyInviteLink = async () => {
  if (!inviteLink.value) return;

  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast.success("邀请链接已复制到剪贴板");
  } catch (error) {
    logger.error("复制邀请链接失败:", error);
    toast.error("复制失败，请手动复制");
  }
};

// 下载二维码（使用高清缓存版本）
const downloadQRCode = () => {
  if (!cachedQRCodeCanvas) return;

  try {
    const link = document.createElement("a");
    link.download = `邀请二维码-${inviteCode.value}.png`;
    // 使用高清缓存 canvas 导出
    link.href = cachedQRCodeCanvas.toDataURL("image/png");
    link.click();
    toast.success("二维码已下载（高清版本）");
  } catch (error) {
    logger.error("下载二维码失败:", error);
    toast.error("下载失败，请稍后重试");
  }
};

// 获取邀请记录
const fetchInvitees = async () => {
  loading.value = true;
  try {
    // 使用 useApiFetch，适用于组件挂载后的事件处理
    const data = await useApiFetch<{ invitees: Invitee[] }>('/api/v1/users/invitees');
    invitees.value = data?.invitees || [];
  } catch (error) {
    logger.error('获取邀请记录失败:', error);
  } finally {
    loading.value = false;
  }
};

// 格式化日期（使用 dayjs）
const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  return dayjs(dateStr).format("YYYY-MM-DD");
};

// 监听 tab 切换
watch(activeTab, (newTab) => {
  if (newTab === "invite-link") {
    // 切换回邀请链接 tab 时，等待 DOM 更新后恢复二维码
    nextTick(() => {
      // 需要等待 TabsContent 渲染完成
      setTimeout(() => {
        if (qrcodeContainer.value) {
          generateQRCode(false);
        }
      }, 50);
    });
  } else if (newTab === "invite-records") {
    fetchInvitees();
  }
});

// 监听二维码容器 ref 变化（Tab 切换后 DOM 重建时触发）
watch(qrcodeContainer, (newContainer) => {
  if (newContainer && cachedQRCodeCanvas && activeTab.value === "invite-link") {
    // 容器重新挂载后，从缓存恢复二维码
    generateQRCode(false);
  }
});

// 监听邀请链接变化（邀请码变化时需要重新生成）
watch(inviteLink, (newLink, oldLink) => {
  if (newLink !== oldLink && activeTab.value === "invite-link") {
    cachedQRCodeCanvas = null;  // 清除旧缓存
    nextTick(() => generateQRCode(true));
  }
});

// 组件挂载时初始化
onMounted(async () => {
  await nextTick();
  if (inviteLink.value) {
    generateQRCode(true);
  }
});
</script>

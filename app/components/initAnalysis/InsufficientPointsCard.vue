<template>
  <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
    <div class="flex items-center gap-3">
      <div class="rounded-full bg-amber-500/10 p-2">
        <AlertTriangleIcon class="size-5 text-amber-500" />
      </div>
      <h3 class="text-base font-semibold">积分不足，分析已暂停</h3>
    </div>

    <Alert>
      <AlertDescription>
        <p>{{ scenarioMessage }}</p>
        <div class="mt-2 flex gap-4 text-sm text-muted-foreground">
          <span>当前可用积分：<strong class="text-foreground">{{ availablePoints ?? 0 }}</strong></span>
          <span>本次所需积分：<strong class="text-foreground">{{ requiredPoints ?? 0 }}</strong></span>
        </div>
      </AlertDescription>
    </Alert>

    <div class="flex flex-wrap gap-3">
      <!-- 无会员：显示升级会员按钮 -->
      <Button v-if="!isMember" @click="openMembershipDialog">
        <CrownIcon class="size-4 mr-1.5" />
        开通会员
      </Button>
      <!-- 有会员但积分不足：显示购买积分按钮 -->
      <Button v-else @click="openPointDialog">
        <CoinsIcon class="size-4 mr-1.5" />
        购买积分
      </Button>
      <Button variant="outline" :disabled="isResuming" @click="handleResume">
        <Loader2Icon v-if="isResuming" class="size-4 mr-2 animate-spin" />
        已充值，继续分析
      </Button>
    </div>

    <!-- 会员升级弹窗 -->
    <MembershipUpgradeDialog
      v-model:open="showUpgradeDialog"
      :loading="upgradeLoading"
      :options="upgradeOptions"
      :selected-option="selectedUpgradeOption"
      v-model:agree-to-agreement="agreeToAgreement"
      @select="selectedUpgradeOption = $event"
      @confirm="confirmUpgrade"
      @close="closeUpgradeDialog"
    />

    <!-- 会员支付弹窗 -->
    <MembershipQRCodeDialog
      v-model:open="showMemberQRCode"
      :qr-code-url="qrCodeUrl"
      :loading="paymentLoading"
      :paid="paymentPaid"
      :use-jsapi="useJsapiPayment"
      :jsapi-params="jsapiParams"
      @close="closePaymentDialog"
      @jsapi-result="handleJsapiResult"
    />

    <!-- 积分购买弹窗 -->
    <PointsPointPurchaseDialog
      v-model:open="showPointDialog"
      :product-list="pointProductList"
      @buy="buyPoints"
    />

    <!-- 积分支付弹窗 -->
    <PointsPointQRCodeDialog
      v-model:open="showPointQRCode"
      :qr-code-url="qrCodeUrl"
      :loading="paymentLoading"
      :paid="paymentPaid"
      :use-jsapi="useJsapiPayment"
      :jsapi-params="jsapiParams"
      @close="closePaymentDialog"
      @jsapi-result="handleJsapiResult"
    />
  </div>
</template>

<script lang="ts" setup>
import { AlertTriangleIcon, Loader2Icon, CrownIcon, CoinsIcon } from 'lucide-vue-next'
import { PaymentChannel, PaymentMethod, DurationUnit } from '#shared/types/payment'
import type { WechatPaymentParams, WechatPaymentResult } from '~/composables/useWechatPayment'

interface Props {
  isMember: boolean
  availablePoints?: number
  requiredPoints?: number
  reason?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  resume: []
}>()

// ==================== 场景提示 ====================

const scenarioMessage = computed(() => {
  if (!props.isMember) {
    return '您尚未开通会员，开通会员后即可获得积分并继续分析。'
  }
  return '您的积分不足以完成本次分析，请购买积分后继续。'
})

// ==================== 继续分析 ====================

const isResuming = ref(false)

function handleResume() {
  isResuming.value = true
  emit('resume')
  setTimeout(() => { isResuming.value = false }, 15000)
}

// ==================== 共享支付状态 ====================

const qrCodeUrl = ref('')
const paymentLoading = ref(false)
const paymentPaid = ref(false)
const currentTransactionNo = ref('')
const agreeToAgreement = ref(true)
let pollTimer: ReturnType<typeof setInterval> | null = null

const { isInWechat, ensureOpenId, redirectToAuth } = useWechatPayment()
const useJsapiPayment = ref(false)
const jsapiParams = ref<WechatPaymentParams | undefined>(undefined)

// ==================== 会员升级 ====================

const showUpgradeDialog = ref(false)
const upgradeLoading = ref(false)
const upgradeOptions = ref<any[]>([])
const selectedUpgradeOption = ref<any>(null)
const showMemberQRCode = ref(false)

async function openMembershipDialog() {
  upgradeLoading.value = true
  showUpgradeDialog.value = true

  const result = await useApiFetch<{
    currentMembership: any
    options: any[]
  }>('/api/v1/memberships/upgrade/options', { showError: false })

  if (!result?.options?.length) {
    // 没有升级选项时 fallback 到会员购买页面
    toast.error('获取会员方案失败，请稍后重试')
    showUpgradeDialog.value = false
    upgradeLoading.value = false
    return
  }

  upgradeOptions.value = result.options
  selectedUpgradeOption.value = result.options[0] ?? null
  upgradeLoading.value = false
}

function closeUpgradeDialog() {
  showUpgradeDialog.value = false
  selectedUpgradeOption.value = null
  upgradeOptions.value = []
}

async function confirmUpgrade() {
  if (!selectedUpgradeOption.value) return
  showUpgradeDialog.value = false

  const shouldUseJsapi = isInWechat.value

  if (shouldUseJsapi) {
    const currentOpenId = await ensureOpenId()
    if (!currentOpenId) { redirectToAuth(); return }

    const result = await useApiFetch<{
      transactionNo: string
      paymentParams: WechatPaymentParams
    }>('/api/v1/memberships/upgrade/pay', {
      method: 'POST',
      body: {
        targetLevelId: selectedUpgradeOption.value.levelId,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.MINI_PROGRAM,
        openid: currentOpenId,
      },
    })
    if (!result) return

    currentTransactionNo.value = result.transactionNo
    useJsapiPayment.value = true
    jsapiParams.value = result.paymentParams
    resetPaymentFlags()
    showMemberQRCode.value = true
  } else {
    const result = await useApiFetch<{
      transactionNo: string
      codeUrl: string
    }>('/api/v1/memberships/upgrade/pay', {
      method: 'POST',
      body: {
        targetLevelId: selectedUpgradeOption.value.levelId,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.SCAN_CODE,
      },
    })
    if (!result) return

    currentTransactionNo.value = result.transactionNo
    qrCodeUrl.value = result.codeUrl
    useJsapiPayment.value = false
    jsapiParams.value = undefined
    resetPaymentFlags()
    showMemberQRCode.value = true
    startPolling()
  }
}

// ==================== 积分购买 ====================

const showPointDialog = ref(false)
const showPointQRCode = ref(false)
const pointProductList = ref<any[]>([])

async function openPointDialog() {
  // 加载积分商品列表
  const data = await useApiFetch<any[]>('/api/v1/products', {
    query: { type: 2 },
    showError: false,
  })

  pointProductList.value = (data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    unitPrice: p.unitPrice ?? 0,
    originalUnitPrice: p.originalUnitPrice,
    pointAmount: p.pointAmount ?? 0,
    description: p.description ?? '',
  }))

  showPointDialog.value = true
}

async function buyPoints(product: any) {
  showPointDialog.value = false

  const shouldUseJsapi = isInWechat.value

  if (shouldUseJsapi) {
    const currentOpenId = await ensureOpenId()
    if (!currentOpenId) { redirectToAuth(); return }

    const result = await useApiFetch<{
      transactionNo: string
      paymentParams: WechatPaymentParams
    }>('/api/v1/payments/create', {
      method: 'POST',
      body: {
        productId: product.id,
        duration: 1,
        durationUnit: DurationUnit.MONTH,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.MINI_PROGRAM,
        openid: currentOpenId,
      },
    })
    if (!result) return

    currentTransactionNo.value = result.transactionNo
    useJsapiPayment.value = true
    jsapiParams.value = result.paymentParams
    resetPaymentFlags()
    showPointQRCode.value = true
  } else {
    const result = await useApiFetch<{
      transactionNo: string
      codeUrl: string
    }>('/api/v1/payments/create', {
      method: 'POST',
      body: {
        productId: product.id,
        duration: 1,
        durationUnit: DurationUnit.MONTH,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.SCAN_CODE,
      },
    })
    if (!result) return

    currentTransactionNo.value = result.transactionNo
    qrCodeUrl.value = result.codeUrl
    useJsapiPayment.value = false
    jsapiParams.value = undefined
    resetPaymentFlags()
    showPointQRCode.value = true
    startPolling()
  }
}

// ==================== 共享支付逻辑 ====================

function resetPaymentFlags() {
  paymentPaid.value = false
  paymentLoading.value = false
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!currentTransactionNo.value) { stopPolling(); return }

    const result = await useApiFetch<{ paid: boolean }>(
      `/api/v1/payments/query?transactionNo=${currentTransactionNo.value}&sync=true`,
      { showError: false },
    )

    if (result?.paid) {
      paymentPaid.value = true
      stopPolling()
      toast.success('支付成功！')
      setTimeout(() => {
        closePaymentDialog()
        emit('resume')
      }, 2000)
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function closePaymentDialog() {
  showMemberQRCode.value = false
  showPointQRCode.value = false
  stopPolling()
  currentTransactionNo.value = ''
  qrCodeUrl.value = ''
  paymentPaid.value = false
  useJsapiPayment.value = false
  jsapiParams.value = undefined
}

async function handleJsapiResult(result: WechatPaymentResult) {
  if (result === 'ok') {
    paymentLoading.value = true
    const queryResult = await useApiFetch<{ paid: boolean }>(
      `/api/v1/payments/query?transactionNo=${currentTransactionNo.value}&sync=true`,
      { showError: false },
    )
    if (queryResult?.paid) {
      paymentPaid.value = true
      toast.success('支付成功！')
      setTimeout(() => {
        closePaymentDialog()
        emit('resume')
      }, 2000)
    } else {
      paymentLoading.value = false
      toast.info('支付处理中，请稍候...')
      startPolling()
    }
  } else if (result === 'cancel') {
    toast.info('支付已取消')
  } else {
    toast.error('支付失败，请重试')
  }
}

onUnmounted(() => {
  stopPolling()
})
</script>

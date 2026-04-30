<template>
  <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
    <div class="flex items-center gap-3">
      <div class="rounded-full bg-amber-500/10 p-2">
        <AlertTriangleIcon class="size-5 text-amber-500" />
      </div>
      <h3 class="text-base font-semibold">{{ isMember ? '积分不足，分析已暂停' : '请先开通会员' }}</h3>
    </div>

    <p class="text-sm text-muted-foreground">{{ scenarioMessage }}</p>

    <!-- 加载中 -->
    <div v-if="loading" class="flex items-center justify-center py-8">
      <Loader2Icon class="size-5 animate-spin text-muted-foreground" />
      <span class="ml-2 text-sm text-muted-foreground">加载中...</span>
    </div>

    <!-- 无会员：展示会员套餐 -->
    <template v-else-if="!isMember">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="plan in membershipPlans"
          :key="plan.id"
          class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer"
          @click="buyMembership(plan)"
        >
          <h4 class="font-semibold mb-1">{{ plan.name }}</h4>
          <p class="text-xl font-bold">
            ¥{{ plan.defaultDuration === 1 ? plan.priceMonthly : plan.priceYearly }}
            <span class="text-xs text-muted-foreground font-normal">/{{ plan.defaultDuration === 1 ? '月' : '年' }}</span>
          </p>
          <p v-if="plan.giftPoint" class="text-xs text-primary mt-1">赠送 {{ plan.giftPoint }} 积分</p>
          <p class="text-xs text-muted-foreground mt-1">{{ plan.description }}</p>
        </div>
      </div>
    </template>

    <!-- 有会员无积分：展示积分套餐 -->
    <template v-else>
      <div class="flex gap-4 text-sm text-muted-foreground mb-2">
        <span>当前可用积分：<strong class="text-foreground">{{ availablePoints ?? 0 }}</strong></span>
        <!-- availablePoints 来自 props.interrupt.data.availablePoints（已 computed） -->
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="product in pointProducts"
          :key="product.id"
          class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer"
          @click="buyPoints(product)"
        >
          <div class="flex justify-between items-start">
            <h4 class="font-semibold">{{ product.name }}</h4>
          </div>
          <p class="text-xl font-bold mt-1">
            ¥{{ product.unitPrice }}
            <span
              v-if="product.originalUnitPrice && product.originalUnitPrice > product.unitPrice"
              class="text-sm line-through text-muted-foreground ml-1"
            >¥{{ product.originalUnitPrice }}</span>
          </p>
          <p class="text-xs text-muted-foreground mt-1">{{ product.pointAmount }} 积分</p>
        </div>
      </div>
    </template>

    <!-- 购买协议 -->
    <div v-if="!loading" class="flex items-start gap-2 pt-2 border-t">
      <Checkbox id="purchase-agreement" v-model="agreeToAgreement" class="mt-0.5" />
      <label for="purchase-agreement" class="text-xs text-muted-foreground leading-5 cursor-pointer">
        购买即代表您同意
        <NuxtLink to="/purchase-agreement" target="_blank" class="text-primary font-bold hover:text-primary/80">
          《LexSeek（法索 AI）服务购买协议》
        </NuxtLink>
      </label>
    </div>

    <!-- 已充值继续分析 -->
    <div class="flex gap-3 pt-2">
      <Button variant="outline" :disabled="isResuming" @click="handleResume">
        <Loader2Icon v-if="isResuming" class="size-4 mr-2 animate-spin" />
        已充值，继续分析
      </Button>
    </div>

    <!-- 支付二维码弹窗（会员和积分共用） -->
    <PaymentQRCodeDialog
      v-model:open="showQRCode"
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
import { AlertTriangleIcon, Loader2Icon } from 'lucide-vue-next'
import { PaymentChannel, PaymentMethod, DurationUnit } from '#shared/types/payment'
import type { WechatPaymentParams, WechatPaymentResult } from '~/composables/useWechatPayment'
import toast from '#shared/utils/toast'
import PaymentQRCodeDialog from '~/components/payment/PaymentQRCodeDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useWechatPayment } from '~/composables/useWechatPayment'
import type { InsufficientPointsInterruptData } from '#shared/types/case'

/**
 * 通过 InterruptDispatcher 的标准契约接入：
 *   - 入参：interrupt（完整中断对象，从 data.* 解出展示字段）
 *   - 出参：submit/cancel（dispatcher 监听这两个事件转发给父级 resumeInterrupt）
 *
 * 旧版直接传 isMember/availablePoints/... 顶层 props 的写法已废弃，避免 dispatcher 路径
 * 缺 required prop 报 Vue warn；同时旧版 emit('resume') 在 dispatcher 路径不被监听，
 * 现在统一发 submit({action:'continue'})。
 */
interface Props {
  interrupt: InsufficientPointsInterruptData
  isSubmitting?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  submit: [value: { action: 'continue' }]
  cancel: []
}>()

const isMember = computed(() => props.interrupt?.data?.isMember ?? false)
const availablePoints = computed(() => props.interrupt?.data?.availablePoints)

const scenarioMessage = computed(() => {
  if (!isMember.value) {
    return '开通会员即可获得积分，选择以下套餐立即开通：'
  }
  return '选择以下积分套餐购买后即可继续分析：'
})

// ==================== 商品加载 ====================

const loading = ref(true)
const membershipPlans = ref<any[]>([])
const pointProducts = ref<any[]>([])
const agreeToAgreement = ref(true)

onMounted(async () => {
  if (!isMember.value) {
    const data = await useApiFetch<any[]>('/api/v1/products', {
      query: { type: 1 },
      showError: false,
    })
    membershipPlans.value = (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      levelId: p.levelId ?? 0,
      priceMonthly: p.priceMonthly ?? 0,
      priceYearly: p.priceYearly ?? 0,
      giftPoint: p.giftPoint ?? 0,
      description: p.description ?? '',
      defaultDuration: p.defaultDuration ?? 2,
    }))
  } else {
    const data = await useApiFetch<any[]>('/api/v1/products', {
      query: { type: 2 },
      showError: false,
    })
    pointProducts.value = (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      unitPrice: p.unitPrice ?? 0,
      originalUnitPrice: p.originalUnitPrice,
      pointAmount: p.pointAmount ?? 0,
      description: p.description ?? '',
    }))
  }
  loading.value = false
})

// ==================== 继续分析 ====================

const isResuming = ref(false)

function handleResume() {
  isResuming.value = true
  emit('submit', { action: 'continue' })
  setTimeout(() => { isResuming.value = false }, 15000)
}

// ==================== 支付 ====================

const qrCodeUrl = ref('')
const paymentLoading = ref(false)
const paymentPaid = ref(false)
const currentTransactionNo = ref('')
const showQRCode = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const { isInWechat, ensureOpenId, redirectToAuth } = useWechatPayment()
const useJsapiPayment = ref(false)
const jsapiParams = ref<WechatPaymentParams | undefined>(undefined)

async function buyMembership(plan: any) {
  if (!agreeToAgreement.value) {
    toast.warning('请先同意购买协议')
    return
  }

  const durationUnit = plan.defaultDuration === 1 ? DurationUnit.MONTH : DurationUnit.YEAR
  await createPayment(plan.id, durationUnit)
}

async function buyPoints(product: any) {
  if (!agreeToAgreement.value) {
    toast.warning('请先同意购买协议')
    return
  }

  await createPayment(product.id, DurationUnit.MONTH)
}

async function createPayment(productId: number, durationUnit: DurationUnit) {
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
        productId,
        duration: 1,
        durationUnit,
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
    showQRCode.value = true
  } else {
    const result = await useApiFetch<{
      transactionNo: string
      codeUrl: string
    }>('/api/v1/payments/create', {
      method: 'POST',
      body: {
        productId,
        duration: 1,
        durationUnit,
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
    showQRCode.value = true
    startPolling()
  }
}

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
        emit('submit', { action: 'continue' })
      }, 2000)
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function closePaymentDialog() {
  showQRCode.value = false
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
        emit('submit', { action: 'continue' })
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

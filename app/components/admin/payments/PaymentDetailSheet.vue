<template>
    <Sheet v-model:open="open">
        <SheetContent class="theme-brand w-full overflow-y-auto sm:max-w-[640px]">
            <SheetHeader>
                <SheetTitle>支付详情</SheetTitle>
                <SheetDescription>查看支付单完整信息、关联订单和回调原始数据</SheetDescription>
            </SheetHeader>
            <div v-if="!detail" class="py-12 text-center text-muted-foreground">
                <Loader2 class="w-6 h-6 animate-spin mx-auto" />
            </div>
            <div v-else class="space-y-6 mt-4 px-4 pb-6">
                <!-- 基本信息 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">基本信息</h3>
                    <dl class="space-y-1 text-sm">
                        <div class="flex"><dt class="w-24 text-muted-foreground">支付单号</dt>
                            <dd class="font-mono">{{ detail.transactionNo }}</dd></div>
                        <div class="flex items-center"><dt class="w-24 text-muted-foreground">状态</dt>
                            <dd><StatusBadge :status="detail.status" :text-map="PaymentStatusText"
                                :variant-map="PaymentStatusVariant" /></dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">金额</dt>
                            <dd>¥{{ Number(detail.amount).toFixed(2) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">支付渠道</dt>
                            <dd>{{ PaymentChannelText[detail.paymentChannel as keyof typeof PaymentChannelText] ?? detail.paymentChannel }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">支付方式</dt>
                            <dd>{{ PaymentMethodText[detail.paymentMethod as keyof typeof PaymentMethodText] ?? detail.paymentMethod }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">第三方交易号</dt>
                            <dd class="font-mono text-xs break-all">{{ detail.outTradeNo ?? '-' }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">创建时间</dt>
                            <dd>{{ formatDate(detail.createdAt) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">支付时间</dt>
                            <dd>{{ formatDate(detail.paidAt) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">过期时间</dt>
                            <dd>{{ formatDate(detail.expiredAt) }}</dd></div>
                    </dl>
                </section>

                <!-- 关联订单（可点击跳转） -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">关联订单</h3>
                    <div v-if="detail.order"
                        class="text-sm cursor-pointer hover:underline inline-flex items-center gap-1"
                        @click="emit('open-order', detail.order.id)">
                        <span class="font-mono">{{ detail.order.orderNo }}</span>
                        <span>· ¥{{ Number(detail.order.amount).toFixed(2) }}</span>
                        <ArrowUpRight class="w-3 h-3" />
                    </div>
                </section>

                <!-- 业务备注（只读） -->
                <section v-if="detail.remark">
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">业务备注（系统记录，仅供参考）</h3>
                    <pre class="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{{ detail.remark }}</pre>
                </section>

                <!-- 错误信息 -->
                <section v-if="detail.errorMessage">
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">错误信息</h3>
                    <pre class="text-xs bg-destructive/10 text-destructive p-2 rounded whitespace-pre-wrap">{{ detail.errorMessage }}</pre>
                </section>

                <!-- 回调原始数据（折叠） -->
                <section v-if="detail.callbackData">
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">回调原始数据</h3>
                    <details class="text-xs">
                        <summary class="cursor-pointer text-muted-foreground select-none">展开 / 收起 JSON</summary>
                        <pre class="bg-muted p-2 rounded overflow-x-auto font-mono mt-2">{{ JSON.stringify(detail.callbackData, null, 2) }}</pre>
                    </details>
                </section>

                <!-- 管理员备注 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">管理员备注（仅后台可见）</h3>
                    <OrderAdminRemarkEditor :api-url="`/api/v1/admin/payments/remark/${detail.id}`"
                        :model-value="detail.adminRemark"
                        :updater-name="detail.adminRemarkUpdaterName"
                        :updated-at="detail.adminRemarkUpdatedAt"
                        @saved="loadDetail()" />
                </section>

                <!-- 操作记录 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">操作记录</h3>
                    <ul v-if="detail.auditLogs?.length" class="space-y-1 text-xs">
                        <li v-for="log in detail.auditLogs" :key="log.id">
                            <span class="text-muted-foreground">{{ formatDate(log.createdAt) }}</span>
                            <span class="ml-2">{{ log.operator?.name ?? '系统' }}</span>
                            <span class="ml-2">{{ actionText(log.action) }}</span>
                        </li>
                    </ul>
                    <div v-else class="text-sm text-muted-foreground">暂无操作记录</div>
                </section>
            </div>
        </SheetContent>
    </Sheet>
</template>

<script setup lang="ts">
import { Loader2, ArrowUpRight } from 'lucide-vue-next'
import {
    PaymentStatusVariant, PaymentStatusText,
    PaymentChannelText, PaymentMethodText,
} from '#shared/types/payment'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '~/components/ui/sheet'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import OrderAdminRemarkEditor from '~/components/admin/orders/OrderAdminRemarkEditor.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'

const { formatDate: formatDateRaw } = useFormatters()
function formatDate(d: Date | string | null | undefined) {
    return formatDateRaw(d ? String(d) : null, 'YYYY-MM-DD HH:mm:ss')
}

const open = ref(false)
const detail = ref<any | null>(null)

const ACTION_TEXT: Record<string, string> = {
    order_cancel: '取消了订单',
    order_remark_update: '修改了订单备注',
    payment_remark_update: '修改了备注',
}

const emit = defineEmits<{ refresh: []; 'open-order': [orderId: number] }>()
defineExpose({ openPayment })

async function openPayment(id: number) {
    open.value = true
    detail.value = null
    await loadDetail(id)
}

async function loadDetail(id?: number) {
    const paymentId = id ?? detail.value?.id
    if (!paymentId) return
    const data = await useApiFetch<any>(`/api/v1/admin/payments/${paymentId}`)
    if (data) detail.value = data
}

function actionText(action: string) { return ACTION_TEXT[action] ?? action }
</script>

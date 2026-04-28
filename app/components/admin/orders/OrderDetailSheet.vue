<template>
    <Sheet v-model:open="open">
        <SheetContent class="w-full sm:max-w-[640px] overflow-y-auto">
            <SheetHeader>
                <SheetTitle>订单详情</SheetTitle>
                <SheetDescription>查看订单完整信息、关联支付单和操作记录</SheetDescription>
            </SheetHeader>
            <div v-if="!detail" class="py-12 text-center text-muted-foreground">
                <Loader2 class="w-6 h-6 animate-spin mx-auto" />
            </div>
            <div v-else class="space-y-6 mt-4 px-4 pb-6">
                <!-- 基本信息 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">基本信息</h3>
                    <dl class="space-y-1 text-sm">
                        <div class="flex"><dt class="w-24 text-muted-foreground">订单号</dt>
                            <dd class="font-mono">{{ detail.orderNo }}</dd></div>
                        <div class="flex items-center"><dt class="w-24 text-muted-foreground">状态</dt>
                            <dd><StatusBadge :status="detail.status" :text-map="OrderStatusText"
                                :variant-map="OrderStatusVariant" /></dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">订单金额</dt>
                            <dd>¥{{ Number(detail.amount).toFixed(2) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">订单类型</dt>
                            <dd>{{ OrderTypeText[detail.orderType as keyof typeof OrderTypeText] ?? detail.orderType }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">时长</dt>
                            <dd>{{ detail.duration }} {{ detail.durationUnit === 'month' ? '个月' : '年' }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">创建时间</dt>
                            <dd>{{ formatDate(detail.createdAt) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">支付时间</dt>
                            <dd>{{ formatDate(detail.paidAt) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">过期时间</dt>
                            <dd>{{ formatDate(detail.expiredAt) }}</dd></div>
                    </dl>
                </section>

                <!-- 用户信息 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">用户信息</h3>
                    <p class="text-sm">{{ detail.user?.phone ?? '-' }} · {{ detail.user?.name ?? '-' }}</p>
                </section>

                <!-- 商品信息 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">商品信息</h3>
                    <p class="text-sm">{{ detail.product?.name ?? '-' }}</p>
                </section>

                <!-- 业务备注（只读） -->
                <section v-if="detail.remark">
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">业务备注（系统记录，仅供参考）</h3>
                    <pre class="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{{ detail.remark }}</pre>
                </section>

                <!-- 管理员备注（可编辑） -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">管理员备注（仅后台可见）</h3>
                    <OrderAdminRemarkEditor :api-url="`/api/v1/admin/orders/remark/${detail.id}`"
                        :model-value="detail.adminRemark"
                        :updater-name="detail.adminRemarkUpdaterName"
                        :updated-at="detail.adminRemarkUpdatedAt"
                        @saved="loadDetail()" />
                </section>

                <!-- 关联支付单 -->
                <section>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">
                        关联支付单（{{ detail.paymentTransactions?.length ?? 0 }} 条）
                    </h3>
                    <div v-if="!detail.paymentTransactions?.length" class="text-sm text-muted-foreground">
                        暂无支付单
                    </div>
                    <ul v-else class="space-y-2">
                        <li v-for="p in detail.paymentTransactions" :key="p.id"
                            class="flex justify-between items-center border-b pb-1 text-sm">
                            <div class="flex flex-col">
                                <span class="font-mono text-xs">{{ p.transactionNo }}</span>
                                <span class="text-xs text-muted-foreground">
                                    {{ p.paymentChannel === 'wechat' ? '微信' : '支付宝' }} · ¥{{ Number(p.amount).toFixed(2) }}
                                </span>
                            </div>
                            <StatusBadge :status="p.status" :text-map="PaymentStatusText"
                                :variant-map="PaymentStatusVariant" />
                        </li>
                    </ul>
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

                <!-- 取消订单 inline 表单（仅待支付） -->
                <section v-if="detail.status === 0" class="pt-4 border-t">
                    <div v-if="cancelMode === 'idle'">
                        <Button variant="destructive" @click="enterCancelMode">
                            <Ban class="w-4 h-4 mr-1" /> 取消订单
                        </Button>
                    </div>
                    <div v-else class="space-y-2">
                        <h3 class="text-sm font-medium">取消订单</h3>
                        <Textarea v-model="cancelReason" rows="3"
                            placeholder="请填写取消原因（1-200 字）" :maxlength="200" />
                        <div class="flex gap-2">
                            <Button variant="destructive" :disabled="!isReasonValid || cancelling"
                                @click="submitCancel">
                                <Loader2 v-if="cancelling" class="w-4 h-4 mr-1 animate-spin" />
                                确认取消
                            </Button>
                            <Button variant="ghost" @click="cancelMode = 'idle'">返回</Button>
                        </div>
                        <p v-if="cancelReason && !isReasonValid" class="text-xs text-destructive">
                            原因 1-200 字
                        </p>
                    </div>
                </section>
            </div>
        </SheetContent>
    </Sheet>
</template>

<script setup lang="ts">
import { Loader2, Ban } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { toast } from 'vue-sonner'
import {
    OrderStatusVariant, PaymentStatusVariant,
    OrderStatusText, PaymentStatusText,
    OrderTypeText,
} from '#shared/types/payment'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '~/components/ui/sheet'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import OrderAdminRemarkEditor from '~/components/admin/orders/OrderAdminRemarkEditor.vue'
import { useApiFetch } from '~/composables/useApiFetch'

const open = ref(false)
const detail = ref<any | null>(null)

// 取消订单 inline 表单
const cancelMode = ref<'idle' | 'editing'>('idle')
const cancelReason = ref('')
const cancelling = ref(false)
const isReasonValid = computed(() => {
    const t = cancelReason.value.trim()
    return t.length >= 1 && t.length <= 200
})

const ACTION_TEXT: Record<string, string> = {
    order_cancel: '取消了订单',
    order_remark_update: '修改了备注',
    payment_remark_update: '修改了支付单备注',
}

const emit = defineEmits<{ refresh: [] }>()
defineExpose({ openOrder })

async function openOrder(id: number) {
    open.value = true
    detail.value = null
    cancelMode.value = 'idle'
    cancelReason.value = ''
    await loadDetail(id)
}

async function loadDetail(id?: number) {
    const orderId = id ?? detail.value?.id
    if (!orderId) return
    const data = await useApiFetch<any>(`/api/v1/admin/orders/${orderId}`)
    if (data) detail.value = data
}

function enterCancelMode() {
    cancelReason.value = ''
    cancelMode.value = 'editing'
}

async function submitCancel() {
    if (!detail.value || !isReasonValid.value) return
    cancelling.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/orders/cancel/${detail.value.id}`, {
            method: 'POST',
            body: { reason: cancelReason.value.trim() },
        })
        if (result) {
            toast.success('订单已取消')
            cancelMode.value = 'idle'
            await loadDetail()
            emit('refresh')
        }
    } finally {
        cancelling.value = false
    }
}

function formatDate(d: Date | string | null | undefined) {
    return d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : '-'
}

function actionText(action: string) {
    return ACTION_TEXT[action] ?? action
}
</script>

<template>
    <div class="space-y-6">
        <!-- 标题区 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">支付记录</h1>
                <p class="text-muted-foreground text-sm">查询用户支付情况</p>
            </div>
            <Button variant="outline" @click="exportCsv">
                <Download class="w-4 h-4 mr-2" /> 导出 CSV
            </Button>
        </div>

        <!-- 筛选 -->
        <PaymentFilters @search="onSearch" />

        <!-- 加载 / 空 / 列表 -->
        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="w-10 h-10 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="!list.length" class="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard class="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium">暂无支付记录</h3>
        </div>
        <template v-else>
            <PaymentTable :payments="list" @open="openDetail" />
            <PaymentMobile :payments="list" @open="openDetail" />
            <GeneralPagination :current-page="page" :page-size="pageSize" :total="total" @change="onPage" />
        </template>

        <PaymentDetailSheet ref="sheetRef" @refresh="loadList" @open-order="goToOrder" />
    </div>
</template>

<script setup lang="ts">
import { CreditCard, Download, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import PaymentFilters from '~/components/admin/payments/PaymentFilters.vue'
import PaymentTable from '~/components/admin/payments/PaymentTable.vue'
import PaymentMobile from '~/components/admin/payments/PaymentMobile.vue'
import PaymentDetailSheet from '~/components/admin/payments/PaymentDetailSheet.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'

definePageMeta({ layout: 'admin-layout', title: '支付记录' })

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const query = ref<Record<string, any>>({})
const loading = ref(false)
const sheetRef = ref<InstanceType<typeof PaymentDetailSheet> | null>(null)

async function loadList() {
    loading.value = true
    try {
        const params = { ...query.value, page: page.value, pageSize: pageSize.value }
        const data = await useApiFetch<{ items: any[]; total: number }>(
            '/api/v1/admin/payments', { query: params },
        )
        if (data) {
            list.value = data.items
            total.value = data.total
        }
    } finally {
        loading.value = false
    }
}

function onSearch(q: Record<string, any>) {
    query.value = q
    page.value = 1
    loadList()
}

function onPage(p: number) { page.value = p; loadList() }

function openDetail(payment: any) {
    sheetRef.value?.openPayment(payment.id)
}

function goToOrder(orderId: number) {
    navigateTo(`/admin/orders?openId=${orderId}`)
}

function exportCsv() {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query.value)) {
        if (v !== undefined && v !== null && v !== '') params.append(k, String(v))
    }
    window.open(`/api/v1/admin/payments/export?${params.toString()}`, '_blank')
    toast.success('正在导出...')
}

onMounted(loadList)
</script>

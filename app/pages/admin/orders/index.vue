<template>
    <div class="theme-brand space-y-6">
        <!-- 标题区 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">订单管理</h1>
                <p class="text-muted-foreground text-sm">查询和管理用户订单</p>
            </div>
            <Button variant="outline" class="brand-control-focus" @click="exportCsv">
                <Download class="w-4 h-4 mr-2" /> 导出 CSV
            </Button>
        </div>

        <!-- 筛选 -->
        <OrderFilters @search="onSearch" />

        <!-- 加载 / 空 / 列表 -->
        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="w-10 h-10 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="!list.length" class="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart class="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium">暂无订单</h3>
        </div>
        <template v-else>
            <OrderTable :orders="list" @open="openDetail" />
            <OrderMobile :orders="list" @open="openDetail" />
            <GeneralPagination :current-page="page" :page-size="pageSize" :total="total" @change="onPage" />
        </template>

        <OrderDetailSheet ref="sheetRef" @refresh="loadList" />
    </div>
</template>

<script setup lang="ts">
import { ShoppingCart, Download, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import OrderFilters from '~/components/admin/orders/OrderFilters.vue'
import OrderTable from '~/components/admin/orders/OrderTable.vue'
import OrderMobile from '~/components/admin/orders/OrderMobile.vue'
import OrderDetailSheet from '~/components/admin/orders/OrderDetailSheet.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'

definePageMeta({ layout: 'admin-layout', title: '订单管理' })

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const query = ref<Record<string, any>>({})
const loading = ref(false)
const sheetRef = ref<InstanceType<typeof OrderDetailSheet> | null>(null)

async function loadList() {
    loading.value = true
    try {
        const params = { ...query.value, page: page.value, pageSize: pageSize.value }
        const data = await useApiFetch<{ items: any[]; total: number }>(
            '/api/v1/admin/orders', { query: params },
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

function openDetail(order: any) {
    sheetRef.value?.openOrder(order.id)
}

function exportCsv() {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query.value)) {
        if (v !== undefined && v !== null && v !== '') params.append(k, String(v))
    }
    window.open(`/api/v1/admin/orders/export?${params.toString()}`, '_blank')
    toast.success('正在导出...')
}

// 支持从支付页跳转打开订单详情
const route = useRoute()
watch(() => route.query.openId, (id) => {
    if (id) sheetRef.value?.openOrder(Number(id))
}, { immediate: true })

onMounted(loadList)
</script>

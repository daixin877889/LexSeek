<template>
    <div class="flex flex-col gap-3 md:flex-row md:flex-wrap">
        <Input v-model="local.keyword" placeholder="订单号 / 手机号 / 昵称" :class="['md:w-56', brandFocusClass]" />
        <Select v-model="statusValue">
            <SelectTrigger :class="['md:w-32', brandFocusClass]">
                <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent class="theme-brand">
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="0">待支付</SelectItem>
                <SelectItem value="1">已支付</SelectItem>
                <SelectItem value="2">已取消</SelectItem>
                <SelectItem value="3">已退款</SelectItem>
            </SelectContent>
        </Select>
        <Select v-model="local.orderType">
            <SelectTrigger :class="['md:w-32', brandFocusClass]">
                <SelectValue placeholder="类型" />
            </SelectTrigger>
            <SelectContent class="theme-brand">
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="purchase">新购</SelectItem>
                <SelectItem value="upgrade">升级</SelectItem>
                <SelectItem value="renew">续费</SelectItem>
            </SelectContent>
        </Select>
        <Input v-model="local.startTime" type="date" :class="['md:w-40', brandFocusClass]" />
        <Input v-model="local.endTime" type="date" :class="['md:w-40', brandFocusClass]" />
        <Button variant="outline" :class="brandFocusClass" @click="emit('search', toQuery())">
            <Search class="w-4 h-4 mr-1" /> 筛选
        </Button>
        <Button variant="ghost" @click="reset">重置</Button>
    </div>
</template>

<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

interface LocalForm {
    keyword: string
    orderType: string
    startTime: string
    endTime: string
}

const local = ref<LocalForm>({ keyword: '', orderType: 'all', startTime: '', endTime: '' })
const statusValue = ref('all')
const brandFocusClass = 'brand-control-focus'

const emit = defineEmits<{ search: [query: Record<string, any>] }>()

function toQuery(): Record<string, any> {
    const q: Record<string, any> = {}
    if (local.value.keyword) q.keyword = local.value.keyword
    if (statusValue.value !== 'all') q.status = Number(statusValue.value)
    if (local.value.orderType !== 'all') q.orderType = local.value.orderType
    if (local.value.startTime) q.startTime = local.value.startTime
    if (local.value.endTime) q.endTime = local.value.endTime
    return q
}

function reset() {
    local.value = { keyword: '', orderType: 'all', startTime: '', endTime: '' }
    statusValue.value = 'all'
    emit('search', {})
}
</script>

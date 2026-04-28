<template>
    <div class="flex flex-col md:flex-row gap-3 flex-wrap">
        <Input v-model="local.keyword" placeholder="支付单号 / 订单号 / 手机号" class="md:w-56" />
        <Select v-model="statusValue">
            <SelectTrigger class="md:w-32">
                <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="0">待支付</SelectItem>
                <SelectItem value="1">支付成功</SelectItem>
                <SelectItem value="2">支付失败</SelectItem>
                <SelectItem value="3">已过期</SelectItem>
                <SelectItem value="4">已退款</SelectItem>
            </SelectContent>
        </Select>
        <Select v-model="local.paymentChannel">
            <SelectTrigger class="md:w-32">
                <SelectValue placeholder="渠道" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">全部渠道</SelectItem>
                <SelectItem value="wechat">微信</SelectItem>
                <SelectItem value="alipay">支付宝</SelectItem>
            </SelectContent>
        </Select>
        <Select v-model="local.paymentMethod">
            <SelectTrigger class="md:w-32">
                <SelectValue placeholder="方式" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">全部方式</SelectItem>
                <SelectItem value="mini_program">小程序</SelectItem>
                <SelectItem value="scan_code">扫码</SelectItem>
                <SelectItem value="wap">H5</SelectItem>
                <SelectItem value="app">APP</SelectItem>
                <SelectItem value="pc">PC</SelectItem>
            </SelectContent>
        </Select>
        <Input v-model="local.startTime" type="date" class="md:w-40" />
        <Input v-model="local.endTime" type="date" class="md:w-40" />
        <Button variant="outline" @click="emit('search', toQuery())">
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
    paymentChannel: string
    paymentMethod: string
    startTime: string
    endTime: string
}

const local = ref<LocalForm>({
    keyword: '', paymentChannel: 'all', paymentMethod: 'all', startTime: '', endTime: '',
})
const statusValue = ref('all')

const emit = defineEmits<{ search: [query: Record<string, any>] }>()

function toQuery(): Record<string, any> {
    const q: Record<string, any> = {}
    if (local.value.keyword) q.keyword = local.value.keyword
    if (statusValue.value !== 'all') q.status = Number(statusValue.value)
    if (local.value.paymentChannel !== 'all') q.paymentChannel = local.value.paymentChannel
    if (local.value.paymentMethod !== 'all') q.paymentMethod = local.value.paymentMethod
    if (local.value.startTime) q.startTime = local.value.startTime
    if (local.value.endTime) q.endTime = local.value.endTime
    return q
}

function reset() {
    local.value = { keyword: '', paymentChannel: 'all', paymentMethod: 'all', startTime: '', endTime: '' }
    statusValue.value = 'all'
    emit('search', {})
}
</script>

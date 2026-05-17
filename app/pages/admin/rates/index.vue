<template>
    <div class="theme-brand space-y-6">
        <div>
            <h1 class="text-2xl font-semibold">利率管理</h1>
            <p class="text-muted-foreground mt-1">维护办案工具引用的 LPR / 央行存款 / 央行贷款 三类基准利率历史</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card v-for="entry in entries" :key="entry.path"
                class="cursor-pointer rounded-lg shadow-none transition-colors hover:border-primary hover:bg-muted/30"
                @click="navigateTo(entry.path)">
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <component :is="entry.icon" class="w-5 h-5 text-primary" />
                        {{ entry.title }}
                    </CardTitle>
                    <CardDescription>{{ entry.desc }}</CardDescription>
                </CardHeader>
            </Card>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Card, CardHeader, CardTitle, CardDescription } from '~/components/ui/card'
import { TrendingUp, PiggyBank, Banknote } from 'lucide-vue-next'

definePageMeta({ layout: 'admin-layout', title: '利率管理' })

const entries = [
    { path: '/admin/rates/lpr', title: 'LPR 利率', desc: '央行每月公布的贷款市场报价利率', icon: TrendingUp },
    { path: '/admin/rates/pboc-deposit', title: '央行存款基准利率', desc: '人民银行存款基准利率历史（已停止公布，作为历史保留）', icon: PiggyBank },
    { path: '/admin/rates/pboc-loan', title: '央行贷款基准利率', desc: '人民银行贷款基准利率历史（2019 年起被 LPR 替代）', icon: Banknote },
]
</script>

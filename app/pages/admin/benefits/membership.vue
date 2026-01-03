<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">会员级别权益配置</h1>
                <p class="text-muted-foreground text-sm">为每个会员级别配置不同的权益值</p>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!levels.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Crown class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无会员级别</h3>
                <p class="text-muted-foreground text-sm">请先创建会员级别</p>
            </div>

            <!-- 配置表格 -->
            <template v-else>
                <div class="bg-card rounded-lg border overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b bg-muted/50">
                                    <th class="px-4 py-3 text-left text-sm font-medium">会员级别</th>
                                    <th v-for="benefit in availableBenefits" :key="benefit.id"
                                        class="px-4 py-3 text-center text-sm font-medium min-w-32">
                                        {{ benefit.name }}
                                    </th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-24">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="level in levels" :key="level.levelId"
                                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                                    <td class="px-4 py-3 font-medium">{{ level.levelName }}</td>
                                    <td v-for="benefit in level.benefits" :key="benefit.benefitId"
                                        class="px-4 py-3 text-center text-sm">
                                        {{ benefit.formattedValue }}
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <Button variant="outline" size="sm" @click="openConfigDialog(level)">
                                            <Settings class="h-4 w-4 mr-1" />
                                            配置
                                        </Button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>
        </div>

        <!-- 配置对话框 -->
        <Dialog v-model:open="dialogOpen">
            <DialogContent class="max-w-lg max-h-[85vh] flex flex-col">
                <DialogHeader class="flex-shrink-0">
                    <DialogTitle>配置「{{ selectedLevel?.levelName }}」权益</DialogTitle>
                    <DialogDescription>为该会员级别设置各项权益值</DialogDescription>
                </DialogHeader>
                <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                    <div v-for="(item, index) in configForm" :key="item.benefitId" class="space-y-2">
                        <Label>{{ item.benefitName }}</Label>
                        <div class="flex gap-2">
                            <Input v-model.number="item.inputValue" type="number" min="0" class="flex-1" />
                            <Select v-model="item.unit" class="w-24" v-if="item.unitType === 'byte'">
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="B">B</SelectItem>
                                    <SelectItem value="KB">KB</SelectItem>
                                    <SelectItem value="MB">MB</SelectItem>
                                    <SelectItem value="GB">GB</SelectItem>
                                    <SelectItem value="TB">TB</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <p v-if="item.unitType === 'byte'" class="text-xs text-muted-foreground">
                            = {{ formatByteSize(computeBenefitValue(item)) }}
                        </p>
                    </div>
                </div>
                <DialogFooter class="flex-shrink-0">
                    <Button variant="outline" @click="dialogOpen = false">取消</Button>
                    <Button @click="handleSave" :disabled="saving">
                        <Loader2 v-if="saving" class="h-4 w-4 mr-2 animate-spin" />
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Loader2, Crown, Settings } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { MembershipBenefitConfig, AvailableBenefit } from '#shared/types/benefit'
import { formatByteSize } from '#shared/utils/unitConverision'

definePageMeta({ layout: false, title: '会员级别权益配置' })

// 状态
const loading = ref(false)
const saving = ref(false)
const levels = ref<MembershipBenefitConfig[]>([])
const availableBenefits = ref<AvailableBenefit[]>([])

// 对话框状态
const dialogOpen = ref(false)
const selectedLevel = ref<MembershipBenefitConfig | null>(null)

// 配置表单
interface ConfigFormItem {
    benefitId: number
    benefitName: string
    unitType: string
    inputValue: number
    unit: string
}
const configForm = ref<ConfigFormItem[]>([])

// 计算权益值（字节）
const computeBenefitValue = (item: ConfigFormItem) => {
    const value = item.inputValue || 0
    const multipliers: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024,
    }
    return value * (multipliers[item.unit] || 1)
}

// 加载数据
const loadData = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<{
            levels: MembershipBenefitConfig[]
            availableBenefits: AvailableBenefit[]
        }>('/api/v1/admin/membership-benefits')

        if (data) {
            levels.value = data.levels
            availableBenefits.value = data.availableBenefits
        }
    } finally {
        loading.value = false
    }
}

// 打开配置对话框
const openConfigDialog = (level: MembershipBenefitConfig) => {
    selectedLevel.value = level
    configForm.value = level.benefits.map((b) => {
        const benefitValue = BigInt(b.benefitValue)
        let inputValue = 0
        let unit = 'GB'

        if (b.unitType === 'byte') {
            // 自动选择合适的单位
            if (benefitValue >= BigInt(1024 * 1024 * 1024 * 1024)) {
                inputValue = Number(benefitValue / BigInt(1024 * 1024 * 1024 * 1024))
                unit = 'TB'
            } else if (benefitValue >= BigInt(1024 * 1024 * 1024)) {
                inputValue = Number(benefitValue / BigInt(1024 * 1024 * 1024))
                unit = 'GB'
            } else if (benefitValue >= BigInt(1024 * 1024)) {
                inputValue = Number(benefitValue / BigInt(1024 * 1024))
                unit = 'MB'
            } else if (benefitValue >= BigInt(1024)) {
                inputValue = Number(benefitValue / BigInt(1024))
                unit = 'KB'
            } else {
                inputValue = Number(benefitValue)
                unit = 'B'
            }
        } else {
            inputValue = Number(benefitValue)
        }

        return {
            benefitId: b.benefitId,
            benefitName: b.benefitName,
            unitType: b.unitType,
            inputValue,
            unit,
        }
    })
    dialogOpen.value = true
}

// 保存配置
const handleSave = async () => {
    if (!selectedLevel.value) return

    saving.value = true
    try {
        const benefits = configForm.value.map((item) => ({
            benefitId: item.benefitId,
            benefitValue: computeBenefitValue(item).toString(),
        }))

        const result = await useApiFetch(`/api/v1/admin/membership-benefits/${selectedLevel.value.levelId}`, {
            method: 'PUT',
            body: { benefits },
        })

        if (result !== null) {
            toast.success('保存成功')
            dialogOpen.value = false
            loadData()
        }
    } finally {
        saving.value = false
    }
}

onMounted(() => {
    loadData()
})
</script>

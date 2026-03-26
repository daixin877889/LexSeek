<template>
    <div class="insufficient-points-handler space-y-4">
        <!-- 服务异常 -->
        <Alert v-if="reason === 'service_error'" variant="destructive">
            <AlertDescription>
                系统繁忙，请稍后重试
            </AlertDescription>
            <Button class="mt-3" @click="handleRetry">
                重试
            </Button>
        </Alert>

        <!-- 非会员 -->
        <template v-else-if="reason === 'no_membership'">
            <Alert>
                <AlertDescription>
                    您尚未开通会员，请先购买会员后继续使用案件分析功能。
                </AlertDescription>
            </Alert>
            <MembershipPackageList @select="handleMembershipSelect" />
        </template>

        <!-- 会员但积分不足 -->
        <template v-else>
            <Alert>
                <AlertDescription>
                    <p>积分不足，无法继续分析。</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                        当前可用积分：{{ interrupt.data.availablePoints }}，
                        本次需要：{{ interrupt.data.requiredPoints }}
                    </p>
                    <p v-if="interrupt.data.totalPointsConsumed > 0" class="text-sm text-muted-foreground">
                        本次分析已消耗：{{ interrupt.data.totalPointsConsumed }} 积分
                        （{{ interrupt.data.totalTokensConsumed }} tokens）
                    </p>
                </AlertDescription>
            </Alert>
            <Button @click="openPointPurchase">
                购买积分
            </Button>
        </template>

        <!-- 充值完成后的继续按钮 -->
        <Button
            v-if="reason !== 'service_error'"
            variant="default"
            :disabled="isSubmitting"
            @click="handleContinue"
        >
            {{ isSubmitting ? '恢复中...' : '已充值，继续分析' }}
        </Button>
    </div>
</template>

<script setup lang="ts">
import type { InsufficientPointsInterruptData } from '#shared/types/case'
import MembershipPackageList from '@/components/membership/MembershipPackageList.vue'

interface Props {
    interrupt: InsufficientPointsInterruptData
    isSubmitting?: boolean
}

const emit = defineEmits<{
    (e: 'submit', data: unknown): void
    (e: 'cancel'): void
}>()

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
})

const reason = computed(() => props.interrupt.data.reason)

const handleRetry = () => {
    emit('submit', { type: 'points_recharged' })
}

const handleContinue = () => {
    emit('submit', { type: 'points_recharged' })
}

const handleMembershipSelect = () => {
    navigateTo('/membership')
}

const openPointPurchase = () => {
    navigateTo('/points')
}
</script>

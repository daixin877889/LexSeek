<template>
    <!-- 当前会员信息 -->
    <div class="bg-muted/30 rounded-lg p-4 mb-0 pl-0">
        <div class="flex items-center justify-between">
            <div>
                <p class="text-sm text-muted-foreground mb-2">当前会员等级</p>
                <p class="text-3xl font-bold mb-2">{{ membership.levelName }}</p>
                <p class="text-sm text-muted-foreground">
                    有效期至：{{ membership.expiresAt }}
                </p>
            </div>
            <div class="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" @click="navigateTo('/dashboard/membership/redeem')" class="h-10 px-4 py-2">
                    兑换会员
                </Button>
                <Button v-if="!isFreeUser" @click="emit('renew')"
                    class="h-10 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                    续期
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
// 定义 props
const props = defineProps<{
    membership: {
        levelName: string;
        expiresAt: string;
        levelId: number;
    };
}>();

// 定义 emits
const emit = defineEmits<{
    renew: [];
}>();

// 是否为免费用户
const isFreeUser = computed(() => {
    return (
        !props.membership ||
        props.membership.levelName === "免费版" ||
        props.membership.levelId === 0
    );
});
</script>

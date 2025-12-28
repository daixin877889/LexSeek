<template>
    <!-- 兑换码信息区域（仅在查询后显示） -->
    <div class="w-full" v-if="codeInfo">
        <!-- 有效兑换码信息 -->
        <div v-if="codeInfo.status === RedemptionCodeStatus.ACTIVE"
            class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
            <h3 class="text-lg font-semibold mb-4">兑换码信息</h3>
            <div class="space-y-4">
                <div class="grid grid-cols-1 gap-4">
                    <!-- 兑换类型 -->
                    <div class="flex justify-between items-center py-2 border-b border-gray-200">
                        <span class="text-muted-foreground">兑换类型</span>
                        <Badge variant="outline" class="font-semibold">{{ getCodeTypeName(codeInfo.type) }}</Badge>
                    </div>
                    <!-- 会员等级（如果有） -->
                    <div v-if="codeInfo.levelName"
                        class="flex justify-between items-center py-2 border-b border-gray-200">
                        <span class="text-muted-foreground">会员等级</span>
                        <Badge variant="outline" class="font-semibold">{{ codeInfo.levelName }}</Badge>
                    </div>
                    <!-- 有效期（如果有） -->
                    <div v-if="codeInfo.duration"
                        class="flex justify-between items-center py-2 border-b border-gray-200">
                        <span class="text-muted-foreground">会员有效期</span>
                        <span class="font-semibold">{{ codeInfo.duration }} 天</span>
                    </div>
                    <!-- 赠送积分（如果有） -->
                    <div v-if="codeInfo.pointAmount"
                        class="flex justify-between items-center py-2 border-b border-gray-200">
                        <span class="text-muted-foreground">赠送积分</span>
                        <span class="font-semibold">{{ codeInfo.pointAmount }} 积分</span>
                    </div>
                    <!-- 过期时间（如果有） -->
                    <div v-if="codeInfo.expiredAt"
                        class="flex justify-between items-center py-2 border-b border-gray-200">
                        <span class="text-muted-foreground">兑换码有效期至</span>
                        <span class="font-semibold">{{ codeInfo.expiredAt }}</span>
                    </div>
                    <!-- 状态 -->
                    <div class="flex justify-between items-center py-2 border-b border-gray-200">
                        <span class="text-muted-foreground">状态</span>
                        <Badge variant="default" class="bg-green-100 text-green-800 hover:bg-green-100">
                            可用
                        </Badge>
                    </div>
                </div>

                <!-- 确认兑换按钮 -->
                <AlertDialog>
                    <AlertDialogTrigger as-child>
                        <Button class="w-full" :disabled="loading">确认兑换</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>确认兑换</AlertDialogTitle>
                            <AlertDialogDescription>
                                <span v-if="codeInfo.levelName">
                                    您确定要兑换 {{ codeInfo.levelName }} 会员吗？
                                </span>
                                <span v-else-if="codeInfo.pointAmount">
                                    您确定要兑换 {{ codeInfo.pointAmount }} 积分吗？
                                </span>
                                <span v-else>
                                    您确定要使用此兑换码吗？
                                </span>
                                兑换后不可撤销。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction :disabled="loading" @click="handleRedeem">
                                <Loader2 v-if="loading" class="w-4 h-4 mr-2 animate-spin" />
                                确认兑换
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>

        <!-- 无效兑换码提示 -->
        <div v-else class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
            <div class="text-center py-8">
                <IconsIconAlert class="mx-auto h-12 w-12 text-yellow-500 mb-4" />
                <h3 class="text-lg font-medium">无效的兑换码</h3>
                <p class="text-sm text-muted-foreground mt-2">{{ getStatusText(codeInfo.status) }}</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";
import { RedemptionCodeType, RedemptionCodeStatus, type RedemptionCodeInfo } from "#shared/types/redemption";

// 定义 props
defineProps<{
    codeInfo: RedemptionCodeInfo | null;
    loading: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    redeem: [];
}>();

// 获取兑换码类型名称
const getCodeTypeName = (type: RedemptionCodeType): string => {
    switch (type) {
        case RedemptionCodeType.MEMBERSHIP_ONLY:
            return "会员兑换";
        case RedemptionCodeType.POINTS_ONLY:
            return "积分兑换";
        case RedemptionCodeType.MEMBERSHIP_AND_POINTS:
            return "会员+积分";
        default:
            return "未知类型";
    }
};

// 获取兑换码状态文本
const getStatusText = (status: RedemptionCodeStatus): string => {
    switch (status) {
        case RedemptionCodeStatus.ACTIVE:
            return "可用";
        case RedemptionCodeStatus.USED:
            return "兑换码已被使用";
        case RedemptionCodeStatus.EXPIRED:
            return "兑换码已过期";
        case RedemptionCodeStatus.INVALID:
            return "兑换码已作废";
        default:
            return "未知状态";
    }
};

// 确认兑换
const handleRedeem = () => {
    emit("redeem");
};
</script>

<script setup lang="ts">
/**
 * 403 无权限页面
 */
definePageMeta({
    layout: 'blank',
    title: '无权限访问',
})

const router = useRouter()

const goHome = () => {
    router.push('/')
}

const goBack = () => {
    router.back()
}
</script>

<template>
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
        <div class="text-center">
            <h1 class="text-9xl font-bold text-gray-200">403</h1>
            <h2 class="mt-4 text-2xl font-semibold text-gray-800">无权限访问</h2>
            <p class="mt-2 text-gray-600">抱歉，您没有权限访问此页面</p>
            <div class="mt-8 flex justify-center gap-4">
                <Button variant="outline" @click="goBack">
                    返回上页
                </Button>
                <Button @click="goHome">
                    返回首页
                </Button>
            </div>
        </div>
    </div>
</template>

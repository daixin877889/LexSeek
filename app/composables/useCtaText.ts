import { computed } from 'vue'
import { useAuthStore } from '~/store/auth'

// 营销页主按钮文案：未登录引导注册体验，已登录直接进入分析
export function useCtaText() {
  const authStore = useAuthStore()
  return computed(() => (authStore.isAuthenticated ? '开始分析' : '免费体验'))
}

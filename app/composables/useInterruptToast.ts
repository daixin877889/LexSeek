import type { Ref } from 'vue'
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { InterruptType } from '#shared/types/case'

interface InterruptLike {
  type?: string
  [key: string]: unknown
}

/**
 * 监听 interrupt 数据，需要独立提示的类型弹 toast。
 *
 * 为什么需要：小索/模块对话浮窗内的中断 Dialog 即使正确展示，
 * 用户也可能被全屏浮窗的视觉焦点带走（Dialog Overlay 被浮窗遮住没有变暗背景），
 * 没有 toast 时用户会误以为 UI 卡死。
 *
 * 同类型 interrupt 连续出现（prev.type === next.type）不再重复提示，
 * 避免消息刷新导致的重复 toast 骚扰。
 */
export function useInterruptToast(
  interruptData: Readonly<Ref<InterruptLike | null | undefined>>,
) {
  watch(interruptData, (next, prev) => {
    if (!next || prev?.type === next.type) return

    if (next.type === InterruptType.INSUFFICIENT_POINTS) {
      toast.warning('积分不足，请在弹窗中完成充值后继续')
    }
  })
}

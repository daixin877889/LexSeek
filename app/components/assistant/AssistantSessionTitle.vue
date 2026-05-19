<script setup lang="ts">
/**
 * 通用问答 · 会话标题展示
 *
 * 标题从「无」变为「有」时以打字机效果逐字渲染，让标题看起来像被即时生成。
 * 页面加载 / 切换会话 / 重命名等场景直接整段展示——靠组件挂载后的一段静默期
 * （GRACE_MS）区分「初次加载已有数据」与「会话进行中实时生成」：静默期内的
 * 标题变化一律视为初始数据加载，不走动画。
 */
const props = withDefaults(defineProps<{
    /** 会话标题，无标题时传 null/undefined */
    title?: string | null
    /** 无标题时的占位文案 */
    placeholder?: string
    /** 每字间隔（毫秒） */
    speed?: number
}>(), {
    title: null,
    placeholder: '未命名对话',
    speed: 40,
})

/** 挂载后静默期：此窗口内的标题变化视为初始数据加载，不走动画 */
const GRACE_MS = 1500

/** 当前已渲染出的文本（打字机过程中逐步增长） */
const displayed = ref(props.title ?? '')
/** 是否正在打字（控制光标显隐） */
const typing = ref(false)
let charTimer: ReturnType<typeof setTimeout> | null = null
/** 静默期是否已过——过后标题从无到有才触发打字机 */
let settled = false
const settleTimer = setTimeout(() => { settled = true }, GRACE_MS)

function stop() {
    if (charTimer) {
        clearTimeout(charTimer)
        charTimer = null
    }
    typing.value = false
}

function typewrite(target: string) {
    stop()
    typing.value = true
    let i = 0
    const step = () => {
        i += 1
        displayed.value = target.slice(0, i)
        if (i >= target.length) {
            stop()
            return
        }
        charTimer = setTimeout(step, props.speed)
    }
    // 立即出首字，避免占位文案闪烁
    step()
}

watch(() => props.title, (next, prev) => {
    const nextVal = next ?? ''
    const prevVal = prev ?? ''
    // 静默期后、标题从无到有 → 打字机；其余（初次加载、切换、重命名）直接整段展示
    if (settled && !prevVal && nextVal) {
        typewrite(nextVal)
    } else {
        stop()
        displayed.value = nextVal
    }
})

onBeforeUnmount(() => {
    clearTimeout(settleTimer)
    stop()
})
</script>

<template>
    <span>{{ displayed || placeholder }}<span v-if="typing" class="title-caret" aria-hidden="true" /></span>
</template>

<style scoped>
.title-caret {
    display: inline-block;
    width: 3px;
    height: 1em;
    margin-left: 3px;
    vertical-align: -0.14em;
    border-radius: 2px;
    background: var(--brand-sky, currentColor);
    box-shadow: 0 0 5px var(--brand-sky, transparent);
    animation: title-caret-blink 0.6s step-end infinite;
}
@keyframes title-caret-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
</style>

import { ref, onMounted, getCurrentInstance } from 'vue'
import { useApiFetch } from '~/composables/useApiFetch'

interface SkillLabel {
    name: string
    label: string
}

/**
 * 模块级 Promise 缓存：多个组件同时挂载共享同一个请求。
 * 单次会话内不重取——管理员改完中文名后，用户刷新页面才看到新值。
 * 请求失败不缓存结果，下次调用会重试。
 */
let cache: Promise<Record<string, string>> | null = null

async function ensureLoaded(): Promise<Record<string, string>> {
    if (!cache) {
        cache = useApiFetch<SkillLabel[]>('/api/v1/skills/labels')
            .then((list) => {
                if (!Array.isArray(list)) return {} as Record<string, string>
                return Object.fromEntries(list.map(s => [s.name, s.label]))
            })
            .catch((err) => {
                cache = null
                throw err
            })
    }
    return cache.catch(() => ({} as Record<string, string>))
}

/**
 * 在组件中获取 skill 英文名 → 中文展示名的映射。
 * 首次挂载时触发请求；后续挂载共享缓存。
 *
 * 调用时机：
 *  - `<script setup>` 顶层（同步阶段）：用 onMounted 注册回调
 *  - 非 setup 阶段（已挂载组件的事件回调里）：onMounted 不会再触发，
 *    通过 getCurrentInstance 兜底，立即触发 ensureLoaded
 *
 * @returns
 *  - `map`: ref，加载完成后包含 name→label 映射
 *  - `label(name)`: 同步查表，未命中或映射未加载时兜底返回原 name
 */
export function useSkillLabels() {
    const map = ref<Record<string, string>>({})
    const load = async () => {
        map.value = await ensureLoaded()
    }
    if (getCurrentInstance()) {
        // 在 setup 阶段调用：等组件挂载完再取值
        onMounted(load)
    } else {
        // 非 setup 阶段（如已挂载组件的事件回调里）调用：立即触发
        load()
    }
    return {
        map,
        label: (name: string) => map.value[name] ?? name,
    }
}

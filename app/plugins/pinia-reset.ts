/**
 * Pinia 插件：为 setup store 自动添加 $reset 方法
 * @description 通过克隆初始状态，实现自动重置功能，无需手动维护
 */
import { getActivePinia, type PiniaPluginContext } from 'pinia'
import cloneDeep from 'lodash-es/cloneDeep'

export default defineNuxtPlugin(({ $pinia }) => {
    const pinia = $pinia as ReturnType<typeof getActivePinia>
    if (!pinia) return

    pinia.use(({ store }: PiniaPluginContext) => {
        // 克隆初始状态
        const initialState = cloneDeep(store.$state)

        // 添加 $reset 方法
        store.$reset = () => {
            store.$patch(cloneDeep(initialState))
        }
    })
})

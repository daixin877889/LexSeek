/**
 * ai-elements 组件库第三方依赖的 ambient 类型声明
 *
 * 这些依赖未在 package.json 中声明（ai-elements 是从 upstream 复制的组件集合，
 * 其中部分组件从未在项目中实际使用）。为了避免 `npx nuxi typecheck` 因为
 * 这些未使用组件的 import 而报错，这里提供最小化的模块声明。
 *
 * 如果未来项目真的启用这些组件，应安装对应 npm 包以获取完整类型。
 */

declare module 'media-chrome' {
    // media-chrome 为原生 Web Components，运行时注册 custom element。
    // 这里只声明模块存在，具体类型由组件使用方通过 any 兜底。
    const mediaChrome: any
    export default mediaChrome
    export const MediaController: any
    export const MediaControlBar: any
    export const MediaTimeDisplay: any
    export const MediaTimeRange: any
    export const MediaMuteButton: any
    export const MediaPlayButton: any
    export const MediaSeekBackwardButton: any
    export const MediaSeekForwardButton: any
    export const MediaVolumeRange: any
    export const MediaDurationDisplay: any
}

declare module '@rive-app/webgl2' {
    // Rive 动画运行时
    export class Rive {
        constructor(options: any)
        play(...args: any[]): any
        pause(...args: any[]): any
        stop(...args: any[]): any
        stateMachineInputs(...args: any[]): any
        on(...args: any[]): any
        cleanup(...args: any[]): any
        [key: string]: any
    }
    export const Layout: any
    export const Fit: any
    export const Alignment: any
    export const EventType: any
    export const RiveEventType: any
    export type EventCallback = (event: any) => void
    const riveApp: any
    export default riveApp
}

declare module 'ansi-to-vue3' {
    // ANSI escape code 转 Vue 3 的库
    import type { DefineComponent } from 'vue'
    const AnsiToVue3: DefineComponent<any, any, any>
    export default AnsiToVue3
}

declare module '@repo/shadcn-vue/components/ui/spinner' {
    // 项目未安装 spinner 组件，ai-elements 中的 SpeechInput / VoiceSelectorPreview 是死代码
    import type { DefineComponent } from 'vue'
    export const Spinner: DefineComponent<any, any, any>
    const component: DefineComponent<any, any, any>
    export default component
}

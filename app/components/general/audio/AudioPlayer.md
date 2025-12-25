# AudioPlayer - 音频播放器组件

## 组件简介
一个功能完整的音频播放器组件，提供播放控制、进度显示、音量调节和键盘快捷键等基础音频播放功能。

## 主要功能
- 🎵 音频播放/暂停控制
- ⏱️ 实时播放进度显示
- 🔊 音量调节控制
- ⏭️ 进度条拖拽跳转
- ⌨️ 键盘快捷键支持
- 🎯 智能输入检测
- 🚫 禁用状态支持
- 📱 响应式设计
- 🎨 shadcn/ui 风格设计

## 键盘快捷键

AudioPlayer 支持以下键盘快捷键，让用户能够快速控制音频播放：

- `空格键` - 播放/暂停切换
- `左箭头` - 快退5秒
- `右箭头` - 快进5秒

**智能输入检测**：当用户在输入框、文本域或其他可编辑元素中时，快捷键会自动禁用，避免干扰正常的文本输入。

## 使用方法

### 基础用法
```vue
<template>
  <div>
    <AudioPlayer 
      :audio-url="audioFileUrl" 
      @play="handlePlay"
      @pause="handlePause"
      @ended="handleEnded"
    />
  </div>
</template>

<script setup>
import { AudioPlayer } from '@/components/general/Audio'

const audioFileUrl = 'https://example.com/audio.mp3'

const handlePlay = () => {
  console.log('音频开始播放')
}

const handlePause = () => {
  console.log('音频暂停播放')
}

const handleEnded = () => {
  console.log('音频播放结束')
}
</script>
```

### 禁用状态
```vue
<template>
  <div>
    <AudioPlayer 
      :audio-url="audioFileUrl" 
      :disabled="isLoading"
    />
    <p v-if="isLoading">正在加载音频...</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { AudioPlayer } from '@/components/general/Audio'

const audioFileUrl = 'https://example.com/audio.mp3'
const isLoading = ref(true)

// 模拟加载完成
setTimeout(() => {
  isLoading.value = false
}, 2000)
</script>
```

### 自动播放
```vue
<template>
  <AudioPlayer 
    :audio-url="audioFileUrl" 
    :autoplay="true"
  />
</template>
```

### 获取播放器实例并使用方法
```vue
<template>
  <div>
    <AudioPlayer ref="playerRef" :audio-url="audioFileUrl" />
    <div class="mt-4 space-x-2">
      <Button @click="playAudio">播放</Button>
      <Button @click="pauseAudio">暂停</Button>
      <Button @click="resetPlayer">重置</Button>
      <Button @click="seekTo30">跳转到30秒</Button>
      <Button @click="setHalfVolume">50%音量</Button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { AudioPlayer } from '@/components/general/Audio'

const playerRef = ref(null)

const playAudio = () => {
  playerRef.value?.play()
}

const pauseAudio = () => {
  playerRef.value?.pause()
}

const resetPlayer = () => {
  playerRef.value?.reset()
}

const seekTo30 = () => {
  playerRef.value?.setCurrentTime(30)
}

const setHalfVolume = () => {
  playerRef.value?.setVolume(0.5)
}
</script>
```

### 监听时间更新
```vue
<template>
  <div>
    <AudioPlayer 
      :audio-url="audioFileUrl" 
      @timeupdate="onTimeUpdate"
    />
    <p>当前播放时间: {{ currentTimeDisplay }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { AudioPlayer } from '@/components/general/Audio'

const audioFileUrl = 'https://example.com/audio.mp3'
const currentTimeDisplay = ref('0:00')

const onTimeUpdate = (currentTime) => {
  const minutes = Math.floor(currentTime / 60)
  const seconds = Math.floor(currentTime % 60)
  currentTimeDisplay.value = `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>
```

## Props

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| audioUrl | String | - | 是 | 音频文件的 URL |
| autoplay | Boolean | false | 否 | 是否自动播放 |
| disabled | Boolean | false | 否 | 是否禁用播放器 |
| disableKeyboard | Boolean | false | 否 | 是否禁用键盘快捷键 |

## Events

| 事件名 | 参数 | 说明 |
|--------|------|------|
| play | - | 音频开始播放时触发 |
| pause | - | 音频暂停时触发 |
| ended | - | 音频播放结束时触发 |
| timeupdate | `currentTime: Number` | 播放时间更新时触发 |

## Methods

通过 `ref` 可以调用以下方法：

| 方法名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| play | - | - | 播放音频 |
| pause | - | - | 暂停音频 |
| reset | - | - | 重置播放器状态 |
| setCurrentTime | `time: Number` | - | 设置播放时间（秒） |
| setVolume | `volume: Number` | - | 设置音量（0-1） |
| seekBackward | - | - | 快退5秒 |
| seekForward | - | - | 快进5秒 |
| isPlaying | - | `Boolean` | 获取播放状态 |
| getCurrentTime | - | `Number` | 获取当前播放时间 |
| getDuration | - | `Number` | 获取音频总时长 |

## 技术实现

### 核心功能
- 使用原生 HTML5 `<audio>` 元素
- Vue 3 组合式 API
- 响应式状态管理
- 事件监听和处理

### 播放控制
- 播放/暂停切换
- 进度条点击跳转
- 音量滑块调节
- 播放状态同步

### 键盘控制
- 全局键盘事件监听
- 智能输入元素检测
- 防止页面滚动等副作用
- 自动移除焦点效果

### 用户体验
- 实时进度显示
- 时间格式化显示
- 音量面板弹出控制
- 点击外部自动关闭
- 无障碍支持

## 样式定制

组件使用 Tailwind CSS 和 shadcn/ui 组件库，可以通过以下方式定制样式：

```vue
<template>
  <div class="custom-audio-player">
    <AudioPlayer :audio-url="audioUrl" />
  </div>
</template>

<style scoped>
.custom-audio-player {
  /* 自定义容器样式 */
  max-width: 600px;
  margin: 0 auto;
}

/* 覆盖内部样式 */
.custom-audio-player :deep(.audio-player) {
  background: #f8f9fa;
  border-radius: 12px;
}
</style>
```

## 注意事项

1. **音频格式支持**: 依赖浏览器对音频格式的支持
2. **跨域问题**: 确保音频文件URL支持跨域访问
3. **自动播放限制**: 现代浏览器对自动播放有限制，需要用户交互
4. **内存管理**: 组件卸载时会自动清理资源
5. **事件监听**: 音量面板的外部点击监听会在组件卸载时自动移除
6. **键盘快捷键**: 只在非输入元素中生效，避免干扰正常输入
7. **禁用状态**: 当disabled为true或无audioUrl时，所有交互功能被禁用

## 浏览器兼容性

- Chrome 4+
- Firefox 3.5+
- Safari 4+
- Edge 12+
- IE 9+

## 与 AudioVisualization 的区别

| 特性 | AudioPlayer | AudioVisualization |
|------|-------------|-------------------|
| 主要用途 | 基础音频播放 | 音频播放 + 可视化分析 |
| 功能复杂度 | 简单 | 复杂 |
| 键盘快捷键 | 播放控制 | 播放控制 + 句子导航 |
| 文件大小 | 小 | 大 |
| 性能开销 | 低 | 高 |
| 适用场景 | 一般音频播放 | 音频分析和可视化 |
| 上一句/下一句 | ❌ | ✅ |
| 全屏模式 | ❌ | ✅ |
| 音频可视化 | ❌ | ✅ | 
# AudioVisualization 音频可视化组件

## 概述

音频可视化组件用于播放音频文件并显示对应的ASR语音识别结果，支持音频播放控制和根据播放时间高亮对应的说话内容。

## 功能特性

### 1. 音频播放器
- **播放控制**：播放/暂停按钮
- **进度控制**：可点击的进度条，支持拖拽跳转
- **时间显示**：当前播放时间和总时长
- **音量控制**：音量滑块调节
- **响应式设计**：适配不同屏幕尺寸

### 2. ASR对话记录
- **多说话人支持**：不同说话人用不同颜色区分，支持自定义说话人姓名
- **说话人显示**：头像中显示说话人姓名简写，时间标签前显示完整姓名
- **编辑说话人**：点击说话人头像可编辑姓名，支持实时更新
- **时间同步高亮**：根据音频播放时间自动高亮对应句子
- **点击跳转**：点击任意句子可跳转到对应音频时间
- **对话式布局**：类似聊天界面的对话显示
- **统计信息**：显示总句数和说话人数量

### 3. 交互功能
- **时间同步**：音频播放时自动高亮对应文本
- **点击跳转**：点击句子可跳转到对应音频时间
- **自动播放**：点击句子后自动开始播放（如果未播放）
- **滚动支持**：对话记录支持滚动查看

## 组件属性

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| asrData | Object | {} | ASR识别结果数据 |
| audioUrl | String | '' | 音频文件URL |
| materialTitle | String | '音频材料' | 材料标题（全屏模式下显示） |
| asrRecordId | String/Number | null | ASR记录ID（用于编辑说话人信息） |

### Events

| 事件名 | 参数 | 说明 |
|--------|------|------|
| speakerUpdated | - | 说话人信息更新后触发，通知父组件刷新数据 |

### ASR数据格式

```javascript
{
  "id": 2,
  "status": 2,
  "result": [
    {
      "text": "识别的文本内容",
      "begin_time": 0,      // 开始时间(毫秒)
      "end_time": 8103,     // 结束时间(毫秒)
      "speaker_id": 0,      // 说话人ID
      "sentence_id": 1      // 句子ID
    },
    {
      "text": "另一段识别内容",
      "begin_time": 8103,
      "end_time": 12581,
      "speaker_id": 1,      // 不同的说话人
      "sentence_id": 2
    }
  ],
  "audioDuration": 18593,
  "speakers": [            // 说话人信息列表
    {
      "id": 0,
      "name": "余华"
    },
    {
      "id": 1,
      "name": "主持人"
    }
  ],
  "updatedAt": "2025-05-30T03:52:25.094Z"
}
```

## 使用示例

```vue
<template>
  <AudioVisualization 
    :asr-data="asrData"
    :audio-url="audioUrl"
    :material-title="materialTitle"
    :asr-record-id="asrRecordId"
    @speaker-updated="handleSpeakerUpdated"
  />
</template>

<script setup>
import { AudioVisualization } from '@/components/cases/AudioVisualization';

const asrData = {
  id: 1,
  status: 2,
  result: [
    {
      text: "这是一段语音识别的内容",
      begin_time: 0,
      end_time: 3000,
      speaker_id: 0,
      sentence_id: 1
    },
    {
      text: "这是第二段识别内容",
      begin_time: 3000,
      end_time: 6000,
      speaker_id: 1,
      sentence_id: 2
    }
  ],
  audioDuration: 6000,
  speakers: [
    {
      id: 0,
      name: "用户"
    },
    {
      id: 1,
      name: "客服"
    }
  ],
  updatedAt: "2025-05-30T03:52:25.094Z"
};

const audioUrl = "https://example.com/audio.mp3";

const materialTitle = "重要会议录音";
const asrRecordId = 456; // ASR记录的ID

// 说话人信息更新后的处理
const handleSpeakerUpdated = () => {
  // 重新获取 ASR 数据以更新说话人信息
  console.log('说话人信息已更新，需要刷新数据');
};
</script>
```

## 样式定制

组件使用shadcn/vue的设计系统，支持以下CSS变量自定义：

- `--primary`：主色调
- `--muted`：静音色调
- `--muted-foreground`：静音前景色
- `--foreground`：前景色

## 技术实现

### 核心功能
- **Vue 3 Composition API**：使用现代Vue语法
- **音频控制**：原生HTML5 Audio API
- **时间同步**：通过timeupdate事件实现
- **响应式数据**：Vue响应式系统管理状态

### 性能优化
- **计算属性缓存**：合理使用computed缓存计算结果
- **事件清理**：组件卸载时清理音频资源
- **条件渲染**：仅在有数据时渲染内容

## 注意事项

1. **音频格式支持**：依赖浏览器的音频支持能力
2. **CORS问题**：确保音频文件支持跨域访问
3. **数据格式**：ASR数据必须符合指定格式
4. **时间精度**：时间同步精度依赖于timeupdate事件频率

## 依赖项

- Vue 3
- lucide-vue-next（图标）
- shadcn/vue UI组件库 
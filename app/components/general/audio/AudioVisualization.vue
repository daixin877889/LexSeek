<template>
  <div class="audio-visualization w-full flex flex-col transition-all duration-500 ease-out"
    :class="isFullscreen ? 'fixed inset-0 z-9999 bg-background px-4 pb-4' : ''" ref="audioVisualizationRef">
    <!-- 全屏模式下的头部标题栏 -->
    <div v-if="isFullscreen" class="flex items-center justify-between p-4 border-b bg-background fullscreen-header">
      <h3 class="text-lg font-semibold">{{ materialTitle }}</h3>
      <Button @click="toggleFullscreen" size="sm" variant="outline" class="h-8 px-2">
        <x-icon class="h-4 w-4 mr-1" />
        退出全屏
      </Button>
    </div>

    <!-- 音频播放器（sticky 固定在顶部） -->
    <div class="content-scale-transition shrink-0 sticky top-0 z-10 bg-background" :class="{ 'mt-0': isFullscreen }">
      <AudioPlayer ref="audioPlayerRef" :audio-url="audioUrl" :disabled="false" :disable-keyboard="true" @play="onPlay"
        @pause="onPause" @ended="onAudioEnded" @timeupdate="onTimeUpdate" />
    </div>

    <!-- ASR对话记录 -->
    <div class="asr-content bg-background border rounded-lg content-scale-transition mt-4 flex flex-col" :class="isFullscreen ? 'flex-1' : 'max-h-[60vh] overflow-hidden'">
      <div class="p-4 border-b shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold">语音识别结果</h3>
            <div class="text-sm text-muted-foreground mt-1">共识别到 {{ totalSentences }} 句话，{{ speakerCount }} 个说话人</div>
          </div>

          <!-- 全屏控制按钮 -->
          <div class="flex items-center gap-2">
            <!-- 使用说明按钮 -->
            <Button @click="toggleHelpDialog" size="sm" variant="outline" class="h-8 w-8 rounded-full p-0" title="使用说明">
              <info-icon class="h-4 w-4" />
            </Button>

            <!-- 下载文档按钮 -->
            <Button @click="downloadDocument" size="sm" variant="outline" class="h-8 w-8 rounded-full p-0" title="下载文档"
              :disabled="isDownloading">
              <download-icon v-if="!isDownloading" class="h-4 w-4" />
              <loader-2-icon v-else class="h-4 w-4 animate-spin" />
            </Button>

            <!-- 全屏控制按钮 -->
            <Button @click="toggleFullscreen" size="sm" variant="outline" class="h-8 w-8 rounded-full p-0"
              title="全屏/退出全屏">
              <maximize-icon v-if="!isFullscreen" class="h-4 w-4" />
              <minimize-icon v-else class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div class="p-4 space-y-4 overflow-y-auto flex-1" :class="isFullscreen ? 'max-h-[calc(100vh-280px)]' : ''"
        ref="asrContainerRef">
        <!-- 按说话人分组显示对话 -->
        <div v-if="processedTranscripts.length > 0 && props.asrData?.status === 2">
          <div v-for="(item, index) in processedTranscripts" :key="index" class="flex gap-3 mb-4" :ref="(el) => {
            if (isSelected(item)) highlightedRef = el;
          }
            ">
            <!-- 说话人头像 -->
            <div class="shrink-0">
              <div class="relative group">
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium cursor-pointer transition-all duration-200 group-hover:scale-110"
                  :class="getSpeakerColor(item.speaker_id)" @click="openEditSpeakerDialog(item.speaker_id)"
                  :title="`点击编辑说话人：${getSpeakerName(item.speaker_id)}`">
                  {{ getSpeakerAvatarText(item.speaker_id) }}
                </div>
                <!-- 编辑图标 -->
                <div
                  class="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <edit-icon class="w-2.5 h-2.5 text-muted-foreground" />
                </div>
              </div>
            </div>

            <!-- 对话内容 -->
            <div class="flex-1 rounded-lg p-3 cursor-pointer transition-all duration-200"
              :class="['bg-muted text-left', isSelected(item) ? `ring-2 ring-opacity-50 shadow-md ${getSpeakerRingColor(item.speaker_id)}` : '']"
              @click="seekToSentence(item)">
              <div class="text-sm leading-relaxed">
                {{ item.text }}
              </div>
              <div class="text-xs mt-1 opacity-70 text-muted-foreground">{{ getSpeakerName(item.speaker_id) }} · {{
                formatTime(item.begin_time) }} - {{ formatTime(item.end_time) }}</div>
            </div>
          </div>
        </div>

        <!-- 无数据提示 -->
        <div v-else class="text-center py-8 text-muted-foreground">
          <mic-icon class="h-12 w-12 mx-auto mb-2 opacity-50" />

          <!-- 根据ASR状态显示不同提示 -->
          <div v-if="props.asrData?.status === 0">
            <p class="mb-4">语音识别待处理，请稍后...</p>
          </div>
          <div v-else-if="props.asrData?.status === 1">
            <p class="mb-4">语音识别处理中，请稍后...</p>
          </div>
          <div v-else-if="props.asrData?.status === 3">
            <p class="mb-4">语音识别失败！</p>
            <p v-if="props.asrData?.errorMessage || props.asrData?.failureReason" class="text-sm text-red-500 mb-4">
              {{ props.asrData?.errorMessage || props.asrData?.failureReason }}
            </p>
            <!-- <Button @click="retryRecognition" size="sm" class="mt-2">
              重新识别
            </Button> -->
          </div>
          <div v-else>
            <p>暂无语音识别结果</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 使用说明对话框 -->
    <Dialog v-model:open="showHelpDialog">
      <DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <info-icon class="h-5 w-5" />
            音频可视化 - 使用说明
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-6 py-4">
          <!-- 基本操作 -->
          <div>
            <h3 class="text-lg font-semibold mb-3">🎵 基本操作</h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>说话人标注</span>
                <span class="text-muted-foreground">点击头像可编辑说话人姓名</span>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>播放/暂停音频</span>
                <span class="text-muted-foreground">点击播放按钮或按空格键</span>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>调整播放进度</span>
                <span class="text-muted-foreground">点击进度条或拖拽</span>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>音量控制</span>
                <span class="text-muted-foreground">点击音量图标调节</span>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>跳转到指定句子</span>
                <span class="text-muted-foreground">点击任意识别结果</span>
              </div>
            </div>
          </div>

          <!-- 键盘快捷键 -->
          <div>
            <h3 class="text-lg font-semibold mb-3">⌨️ 键盘快捷键</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>播放/暂停</span>
                <kbd class="px-2 py-1 bg-background border rounded">空格</kbd>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>快退5秒</span>
                <kbd class="px-2 py-1 bg-background border rounded">←</kbd>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>快进5秒</span>
                <kbd class="px-2 py-1 bg-background border rounded">→</kbd>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>上一句</span>
                <kbd class="px-2 py-1 bg-background border rounded">↑</kbd>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>下一句</span>
                <kbd class="px-2 py-1 bg-background border rounded">↓</kbd>
              </div>
              <div class="flex justify-between items-center p-2 bg-muted rounded">
                <span>退出全屏</span>
                <kbd class="px-2 py-1 bg-background border rounded">ESC</kbd>
              </div>
            </div>
          </div>

          <!-- 功能特性 -->
          <!-- <div>
            <h3 class="text-lg font-semibold mb-3">✨ 功能特性</h3>
            <div class="space-y-2 text-sm">
              <div class="p-3 bg-muted rounded">
                <div class="font-medium mb-1">🎯 智能高亮</div>
                <div class="text-muted-foreground">播放时自动高亮当前句子，点击句子后保持选中状态</div>
              </div>
              <div class="p-3 bg-muted rounded">
                <div class="font-medium mb-1">🔄 自动滚动</div>
                <div class="text-muted-foreground">播放时自动滚动到当前位置，确保重要内容不错过</div>
              </div>
              <div class="p-3 bg-muted rounded">
                <div class="font-medium mb-1">🎬 全屏模式</div>
                <div class="text-muted-foreground">支持全屏播放，提供沉浸式的音频分析体验</div>
              </div>
              <div class="p-3 bg-muted rounded">
                <div class="font-medium mb-1">👥 多说话人</div>
                <div class="text-muted-foreground">不同颜色标识说话人，清晰展示对话结构</div>
              </div>
            </div>
          </div> -->

          <!-- 使用技巧 -->
          <!-- <div>
            <h3 class="text-lg font-semibold mb-3">💡 使用技巧</h3>
            <div class="space-y-2 text-sm">
              <div class="flex items-start gap-2 p-2">
                <div class="w-2 h-2 bg-primary rounded-full mt-2 shrink-0"></div>
                <div>
                  <div class="font-medium">精确定位</div>
                  <div class="text-muted-foreground">使用左右箭头键进行5秒精确跳转，快速定位关键内容</div>
                </div>
              </div>
              <div class="flex items-start gap-2 p-2">
                <div class="w-2 h-2 bg-primary rounded-full mt-2 shrink-0"></div>
                <div>
                  <div class="font-medium">逐句分析</div>
                  <div class="text-muted-foreground">使用上下箭头键逐句浏览，便于详细分析对话内容</div>
                </div>
              </div>
              <div class="flex items-start gap-2 p-2">
                <div class="w-2 h-2 bg-primary rounded-full mt-2 shrink-0"></div>
                <div>
                  <div class="font-medium">无干扰操作</div>
                  <div class="text-muted-foreground">在输入框中输入时，快捷键自动禁用，避免误操作</div>
                </div>
              </div>
            </div>
          </div> -->
        </div>

        <DialogFooter>
          <Button @click="showHelpDialog = false" variant="outline"> 关闭 </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 编辑说话人对话框 -->
    <Dialog v-model:open="showEditSpeakerDialog">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <edit-icon class="h-5 w-5" />
            编辑说话人信息
          </DialogTitle>
          <DialogDescription> 修改该说话人的显示名称 </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-4">
          <div class="flex items-center gap-3">
            <!-- 说话人头像预览 -->
            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
              :class="getSpeakerColor(editingSpeakerId)">
              {{ getSpeakerAvatarText(editingSpeakerId) }}
            </div>

            <div class="flex-1">
              <label class="text-sm font-medium text-muted-foreground mb-1 block"> 说话人姓名 </label>
              <Input v-model="editingSpeakerName" placeholder="请输入说话人姓名" :disabled="isEditingSpeaker"
                @keydown.enter="handleEnterKeyDown" class="w-full" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button @click="cancelEditSpeaker" variant="outline" :disabled="isEditingSpeaker"> 取消 </Button>
          <Button @click="saveSpeakerName" :disabled="isEditingSpeaker || !editingSpeakerName.trim()">
            {{ isEditingSpeaker ? "保存中..." : "保存" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayIcon, PauseIcon, Volume2Icon, MicIcon, MaximizeIcon, MinimizeIcon, XIcon, InfoIcon, EditIcon, DownloadIcon, Loader2Icon } from "lucide-vue-next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import AudioPlayer from "./AudioPlayer.vue";

/**
 * Props定义
 */
const props = defineProps({
  /**
   * ASR识别结果数据
   */
  asrData: {
    type: Object,
    default: () => ({}),
  },
  /**
   * 音频文件URL
   */
  audioUrl: {
    type: String,
    default: "",
  },
  /**
   * 材料标题
   */
  materialTitle: {
    type: String,
    default: "音频材料",
  },
  /**
   * ASR记录ID，用于编辑说话人信息
   */
  asrRecordId: {
    type: [String, Number],
    default: null,
  },
});

/**
 * 事件定义
 */
const emit = defineEmits(["speakerUpdated"]);

// 音频播放器引用
const audioPlayerRef = ref(null);

// 音频相关状态（由 AudioPlayer 管理，这里只做同步）
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);

// 滚动相关状态
const highlightedRef = ref(null);
const asrContainerRef = ref(null);

// 选中状态管理
const selectedSentenceId = ref(null);

// 全屏状态
const isFullscreen = ref(false);

// 使用说明对话框状态
const showHelpDialog = ref(false);

// 编辑说话人相关状态
const showEditSpeakerDialog = ref(false);
const editingSpeakerId = ref(null);
const editingSpeakerName = ref("");
const isEditingSpeaker = ref(false);

// 本地说话人状态，用于在 API 更新后立即反映界面变化
const localSpeakers = ref({});

// 动画状态
const isAnimating = ref(false);
const audioVisualizationRef = ref(null);

// Toast 提示
// const toastStore = useToastStore();

// 下载状态
const isDownloading = ref(false);

// 计算属性

/**
 * 处理识别结果数据
 */
const processedTranscripts = computed(() => {
  if (!props.asrData?.result?.length) return [];

  // 新的数据结构直接在 result 数组中包含句子数据
  // 按开始时间排序
  return props.asrData.result.sort((a, b) => a.begin_time - b.begin_time);
});

/**
 * 统计信息
 */
const totalSentences = computed(() => processedTranscripts.value.length);

const speakerCount = computed(() => {
  const speakers = new Set(processedTranscripts.value.map((item) => item.speaker_id));
  return speakers.size;
});

// 播放器事件处理

/**
 * 播放开始事件
 */
const onPlay = () => {
  isPlaying.value = true;
  // 开始播放时清除手动选中状态，让自动高亮生效
  selectedSentenceId.value = null;
};

/**
 * 播放暂停事件
 */
const onPause = () => {
  isPlaying.value = false;
};

/**
 * 时间更新事件
 */
const onTimeUpdate = (time) => {
  currentTime.value = time;
};

/**
 * 播放结束事件
 */
const onAudioEnded = () => {
  isPlaying.value = false;
  currentTime.value = 0;
  // 播放结束时清除手动选中状态
  selectedSentenceId.value = null;
};

// 播放器控制方法

/**
 * 播放/暂停切换
 */
const togglePlayPause = () => {
  if (!audioPlayerRef.value) return;

  if (isPlaying.value) {
    audioPlayerRef.value.pause();
  } else {
    audioPlayerRef.value.play();
  }
};

/**
 * 跳转到指定句子
 * @param {Object} sentence - 句子对象
 */
const seekToSentence = (sentence) => {
  if (!audioPlayerRef.value) return;

  const newTime = sentence.begin_time / 1000;
  audioPlayerRef.value.setCurrentTime(newTime);
  currentTime.value = newTime;

  // 设置短暂的选中状态，然后清除以便播放时高亮生效
  selectedSentenceId.value = sentence.sentence_id;

  // 只有在音频正在播放时才保持播放状态，否则不自动开始播放
  if (isPlaying.value) {
    // 播放中：延迟清除手动选中状态，让播放时高亮生效
    setTimeout(() => {
      selectedSentenceId.value = null;
    }, 500); // 500ms后清除，给用户足够的视觉反馈时间
  }
  // 如果没有播放，保持选中状态，不自动开始播放
};

/**
 * 快退5秒
 */
const seekBackward = () => {
  if (!audioPlayerRef.value) return;

  audioPlayerRef.value.seekBackward();
  // 延迟更新时间，等待播放器内部更新
  setTimeout(() => {
    currentTime.value = audioPlayerRef.value.getCurrentTime();
  }, 50);

  // 清除手动选中状态，让自动高亮生效
  selectedSentenceId.value = null;
};

/**
 * 快进5秒
 */
const seekForward = () => {
  if (!audioPlayerRef.value) return;

  audioPlayerRef.value.seekForward();
  // 延迟更新时间，等待播放器内部更新
  setTimeout(() => {
    currentTime.value = audioPlayerRef.value.getCurrentTime();
  }, 50);

  // 清除手动选中状态，让自动高亮生效
  selectedSentenceId.value = null;
};

/**
 * 导航到上一句
 */
const navigateToPreviousSentence = () => {
  if (processedTranscripts.value.length === 0) return;

  let currentSentenceIndex = -1;

  // 如果有手动选中的句子，基于选中的句子
  if (selectedSentenceId.value) {
    currentSentenceIndex = processedTranscripts.value.findIndex((sentence) => sentence.sentence_id === selectedSentenceId.value);
  } else {
    // 否则基于当前播放时间找到当前句子
    const currentTimeMs = currentTime.value * 1000;
    currentSentenceIndex = processedTranscripts.value.findIndex((sentence) => currentTimeMs >= sentence.begin_time && currentTimeMs <= sentence.end_time);
  }

  // 如果找到了当前句子，导航到上一句
  if (currentSentenceIndex > 0) {
    const previousSentence = processedTranscripts.value[currentSentenceIndex - 1];
    seekToSentence(previousSentence);
  } else if (currentSentenceIndex === -1 && processedTranscripts.value.length > 0) {
    // 如果没有找到当前句子，导航到第一句
    seekToSentence(processedTranscripts.value[0]);
  }
};

/**
 * 导航到下一句
 */
const navigateToNextSentence = () => {
  if (processedTranscripts.value.length === 0) return;

  let currentSentenceIndex = -1;

  // 如果有手动选中的句子，基于选中的句子
  if (selectedSentenceId.value) {
    currentSentenceIndex = processedTranscripts.value.findIndex((sentence) => sentence.sentence_id === selectedSentenceId.value);
  } else {
    // 否则基于当前播放时间找到当前句子
    const currentTimeMs = currentTime.value * 1000;
    currentSentenceIndex = processedTranscripts.value.findIndex((sentence) => currentTimeMs >= sentence.begin_time && currentTimeMs <= sentence.end_time);
  }

  // 如果找到了当前句子，导航到下一句
  if (currentSentenceIndex >= 0 && currentSentenceIndex < processedTranscripts.value.length - 1) {
    const nextSentence = processedTranscripts.value[currentSentenceIndex + 1];
    seekToSentence(nextSentence);
  } else if (currentSentenceIndex === -1 && processedTranscripts.value.length > 0) {
    // 如果没有找到当前句子，导航到第一句
    seekToSentence(processedTranscripts.value[0]);
  }
};

// 工具方法

/**
 * 格式化时间显示
 * @param {number} timeInMs - 毫秒时间
 * @returns {string} 格式化的时间字符串
 */
const formatTime = (timeInMs) => {
  const seconds = Math.floor(timeInMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

/**
 * 获取说话人颜色
 * @param {number} speakerId - 说话人ID
 * @returns {string} CSS类名
 */
const getSpeakerColor = (speakerId) => {
  const colors = ["bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500", "bg-pink-500", "bg-indigo-500"];
  return colors[speakerId % colors.length];
};

/**
 * 获取说话人名称
 * @param {number} speakerId - 说话人ID
 * @returns {string} 说话人名称
 */
const getSpeakerName = (speakerId) => {
  // 优先使用本地更新的说话人信息
  if (localSpeakers.value[speakerId]) {
    return localSpeakers.value[speakerId];
  }

  // 然后使用 props 中的说话人信息
  if (props.asrData?.speakers && Array.isArray(props.asrData.speakers)) {
    const speaker = props.asrData.speakers.find((s) => s.id === speakerId);
    if (speaker && speaker.name) {
      return speaker.name;
    }
  }
  // 如果没有找到对应的说话人信息，返回默认格式
  return `说话人${speakerId + 1}`;
};

/**
 * 获取说话人头像显示文本
 * @param {number} speakerId - 说话人ID
 * @returns {string} 头像显示文本
 */
const getSpeakerAvatarText = (speakerId) => {
  const fullName = getSpeakerName(speakerId);

  // 如果是默认格式（说话人1、说话人2等），返回数字
  // 使用正则表达式精确匹配"说话人"后跟数字的格式
  if (/^说话人\d+$/.test(fullName)) {
    return `${speakerId + 1}`;
  }

  // 如果是中文姓名，返回最后一个字
  if (/[\u4e00-\u9fa5]/.test(fullName)) {
    return fullName.slice(-1);
  }

  // 如果是英文或其他，返回首字母
  return fullName.charAt(0).toUpperCase();
};

/**
 * 判断句子是否应该高亮
 * @param {Object} sentence - 句子对象
 * @returns {boolean} 是否高亮
 */
const isHighlighted = (sentence) => {
  const currentTimeMs = currentTime.value * 1000;
  return currentTimeMs >= sentence.begin_time && currentTimeMs <= sentence.end_time;
};

/**
 * 判断句子是否被选中（播放时高亮或手动选中）
 * @param {Object} sentence - 句子对象
 * @returns {boolean} 是否应该显示选中状态
 */
const isSelected = (sentence) => {
  // 手动选中优先级更高
  if (selectedSentenceId.value === sentence.sentence_id) {
    return true;
  }
  // 如果没有手动选中，则显示播放时高亮
  return !selectedSentenceId.value && isHighlighted(sentence);
};

/**
 * 获取说话人边框颜色
 * @param {number} speakerId - 说话人ID
 * @returns {string} CSS类名
 */
const getSpeakerRingColor = (speakerId) => {
  const colors = ["ring-blue-500", "ring-green-500", "ring-purple-500", "ring-orange-500", "ring-pink-500", "ring-indigo-500"];
  return colors[speakerId % colors.length];
};

// 键盘事件处理

/**
 * 检查是否在输入元素中
 */
const isInputElement = (element) => {
  const inputElements = ["INPUT", "TEXTAREA", "SELECT"];
  return inputElements.includes(element.tagName) || element.contentEditable === "true" || element.closest('[contenteditable="true"]');
};

/**
 * 处理键盘按下事件
 */
const handleKeyPress = (event) => {
  // 只在不在输入框等元素中且有音频URL时响应
  if (!isInputElement(event.target) && props.audioUrl) {
    switch (event.code) {
      case "Space":
        event.preventDefault(); // 防止页面滚动
        // 主动移除焦点，避免显示焦点边框
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        togglePlayPause();
        break;
      case "ArrowLeft":
        event.preventDefault();
        seekBackward();
        break;
      case "ArrowRight":
        event.preventDefault();
        seekForward();
        break;
      case "ArrowUp":
        event.preventDefault();
        navigateToPreviousSentence();
        break;
      case "ArrowDown":
        event.preventDefault();
        navigateToNextSentence();
        break;
      case "Escape":
        if (isFullscreen.value) {
          event.preventDefault();
          toggleFullscreen();
        }
        break;
    }
  }
};

// 全屏相关方法

/**
 * 切换全屏状态 - 使用浏览器原生全屏API
 */
const toggleFullscreen = async () => {
  if (isAnimating.value) return;

  isAnimating.value = true;

  try {
    if (!isFullscreen.value) {
      // 进入全屏 - 使用原生全屏API
      if (audioVisualizationRef.value?.requestFullscreen) {
        await audioVisualizationRef.value.requestFullscreen();
        isFullscreen.value = true;
      } else if (audioVisualizationRef.value?.webkitRequestFullscreen) {
        // Safari兼容
        await audioVisualizationRef.value.webkitRequestFullscreen();
        isFullscreen.value = true;
      } else {
        // 降级到CSS模拟全屏
        if (audioVisualizationRef.value) {
          audioVisualizationRef.value.classList.add("fullscreen-enter");
        }
        isFullscreen.value = true;
        document.body.style.overflow = "hidden";

        setTimeout(() => {
          if (audioVisualizationRef.value) {
            audioVisualizationRef.value.classList.remove("fullscreen-enter");
          }
          isAnimating.value = false;
        }, 500);
        return;
      }
    } else {
      // 退出全屏
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        isFullscreen.value = false;
      } else if (document.webkitExitFullscreen) {
        // Safari兼容
        await document.webkitExitFullscreen();
        isFullscreen.value = false;
      } else {
        // 降级到CSS模拟全屏
        if (audioVisualizationRef.value) {
          audioVisualizationRef.value.classList.add("fullscreen-exit");
        }

        setTimeout(() => {
          isFullscreen.value = false;
          document.body.style.overflow = "";

          if (audioVisualizationRef.value) {
            audioVisualizationRef.value.classList.remove("fullscreen-exit");
          }
          isAnimating.value = false;
        }, 500);
        return;
      }
    }

    isAnimating.value = false;
  } catch (error) {
    console.error("全屏切换失败:", error);
    // 发生错误时降级到CSS模拟
    if (!isFullscreen.value) {
      if (audioVisualizationRef.value) {
        audioVisualizationRef.value.classList.add("fullscreen-enter");
      }
      isFullscreen.value = true;
      document.body.style.overflow = "hidden";
    } else {
      if (audioVisualizationRef.value) {
        audioVisualizationRef.value.classList.add("fullscreen-exit");
      }
      setTimeout(() => {
        isFullscreen.value = false;
        document.body.style.overflow = "";
        if (audioVisualizationRef.value) {
          audioVisualizationRef.value.classList.remove("fullscreen-exit");
        }
      }, 500);
    }
    isAnimating.value = false;
  }

  // 移除按钮焦点
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
};

/**
 * 监听全屏状态变化
 */
const handleFullscreenChange = () => {
  const isCurrentlyFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);

  // 同步状态
  if (isFullscreen.value !== isCurrentlyFullscreen) {
    isFullscreen.value = isCurrentlyFullscreen;

    if (!isCurrentlyFullscreen) {
      // 退出全屏时恢复滚动
      document.body.style.overflow = "";
    }
  }
};

/**
 * 切换帮助对话框
 */
const toggleHelpDialog = () => {
  showHelpDialog.value = true;
};

// 说话人编辑相关方法

/**
 * 打开编辑说话人对话框
 * @param {number} speakerId - 说话人ID
 */
const openEditSpeakerDialog = (speakerId) => {
  if (!props.asrRecordId) {
    console.warn("无法编辑说话人：缺少 asrRecordId");
    return;
  }

  editingSpeakerId.value = speakerId;
  editingSpeakerName.value = getSpeakerName(speakerId);
  showEditSpeakerDialog.value = true;
};

/**
 * 处理编辑说话人输入框中的回车键事件
 */
const handleEnterKeyDown = (event) => {
  // 阻止默认行为
  event.preventDefault();
  event.stopPropagation();

  // 立即保存说话人信息
  saveSpeakerName();
};

/**
 * 取消编辑说话人
 */
const cancelEditSpeaker = () => {
  showEditSpeakerDialog.value = false;
  editingSpeakerId.value = null;
  editingSpeakerName.value = "";
  isEditingSpeaker.value = false;

  // 确保移除所有焦点，避免出现黑框
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
};

/**
 * 保存说话人名称
 */
const saveSpeakerName = async () => {
  if (!editingSpeakerName.value.trim()) {
    toast.error("说话人名称不能为空");
    return;
  }

  if (editingSpeakerName.value.trim() === getSpeakerName(editingSpeakerId.value)) {
    // 名称没有变化，直接关闭对话框
    cancelEditSpeaker();
    return;
  }

  try {
    isEditingSpeaker.value = true;

    // 构建完整的 speakers 数组（保留现有说话人，更新目标说话人）
    const currentSpeakers = props.asrData?.speakers || [];
    const updatedSpeakers = currentSpeakers.map(speaker => {
      if (speaker.id === editingSpeakerId.value) {
        return { ...speaker, name: editingSpeakerName.value.trim() };
      }
      return speaker;
    });

    // 如果目标说话人不在现有列表中，添加新的
    if (!currentSpeakers.find(s => s.id === editingSpeakerId.value)) {
      updatedSpeakers.push({
        id: editingSpeakerId.value,
        name: editingSpeakerName.value.trim(),
      });
    }

    // 直接调用 API 更新说话人信息
    const result = await useApiFetch(`/api/v1/recognition/audio/${props.asrRecordId}`, {
      method: 'PUT',
      body: { speakers: updatedSpeakers },
    });

    if (!result) {
      throw new Error("更新失败");
    }

    // 保存名称用于后续的 Toast 消息
    const savedName = editingSpeakerName.value.trim();

    // 立即更新本地状态，提供即时反馈
    localSpeakers.value[editingSpeakerId.value] = savedName;

    // 发出事件通知父组件刷新数据
    emit("speakerUpdated");

    cancelEditSpeaker();
    toast.success(`说话人名称已更新为 "${savedName}"`);
  } catch (error) {
    console.error("更新说话人名称失败:", error);
    toast.error(error.message || "更新失败，请稍后重试");
  } finally {
    isEditingSpeaker.value = false;
  }
};

/**
 * 下载文档
 */
const downloadDocument = async () => {
  if (!props.audioUrl || !processedTranscripts.value.length) {
    toast.error("缺少音频文件或识别结果");
    return;
  }

  isDownloading.value = true;

  try {
    // 动态导入 JSZip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // 1. 下载音频文件并添加到ZIP
    const audioResponse = await fetch(props.audioUrl);
    const audioBlob = await audioResponse.blob();

    // 从音频URL推断文件扩展名
    let fileExtension = ".mp3"; // 默认扩展名
    try {
      const url = new URL(props.audioUrl);
      const pathname = url.pathname;
      const lastDotIndex = pathname.lastIndexOf(".");
      if (lastDotIndex !== -1) {
        fileExtension = pathname.substring(lastDotIndex);
      }
    } catch (error) {
      console.warn("无法从URL推断文件扩展名，使用默认扩展名:", error);
    }

    // 生成音频文件名：材料标题 + 原始后缀名
    const audioFileName = `${props.materialTitle}${fileExtension}`;
    zip.file(audioFileName, audioBlob);

    // 2. 生成识别结果TXT文件内容
    let txtContent = "";
    processedTranscripts.value.forEach((item) => {
      const speakerName = getSpeakerName(item.speaker_id);
      txtContent += `${speakerName}：${item.text}\n`;
    });

    // 生成TXT文件名：材料标题.txt
    const txtFileName = `${props.materialTitle}.txt`;
    zip.file(txtFileName, txtContent);

    // 3. 生成ZIP文件并下载
    const zipBlob = await zip.generateAsync({ type: "blob" });

    // 创建下载链接
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.materialTitle}_文档包.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 使用 toast 提示成功
    toast.success("文档下载成功");
  } catch (error) {
    console.error("下载文档失败:", error);
    // 使用 toast 显示错误提示
    toast.error(error.message || "下载文档失败，请稍后重试");
  } finally {
    isDownloading.value = false;
  }
};

// 监听器

/**
 * 监听 ASR 数据变化，同步更新本地说话人状态
 */
watch(
  () => props.asrData?.speakers,
  (newSpeakers) => {
    if (newSpeakers && Array.isArray(newSpeakers)) {
      // 清空本地状态
      localSpeakers.value = {};
      // 将 props 中的 speakers 数据同步到本地状态
      newSpeakers.forEach((speaker) => {
        if (speaker.id !== undefined && speaker.name) {
          localSpeakers.value[speaker.id] = speaker.name;
        }
      });
    }
  },
  { deep: true, immediate: true }
);

/**
 * 监听播放时间变化，实现自动滚动
 */
watch(currentTime, () => {
  if (isPlaying.value && highlightedRef.value && asrContainerRef.value) {
    // 延迟执行以确保DOM更新完成
    nextTick(() => {
      const highlightedElement = highlightedRef.value;
      const container = asrContainerRef.value;

      if (highlightedElement && container) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = highlightedElement.getBoundingClientRect();

        // 检查元素是否在容器的可视区域内
        const isElementVisible = elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;

        // 如果元素不在可视区域内，则滚动到该元素
        if (!isElementVisible) {
          highlightedElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
          });
        }
      }
    });
  }
});

/**
 * 监听音频URL变化
 */
watch(
  () => props.audioUrl,
  (newUrl) => {
    if (audioPlayerRef.value) {
      // AudioPlayer 内部会处理 URL 变化
      isPlaying.value = false;
      currentTime.value = 0;
      duration.value = 0;
      // 音频切换时清除选中状态
      selectedSentenceId.value = null;
    }
  }
);

// 生命周期钩子

/**
 * 组件挂载时添加键盘监听和全屏事件
 */
onMounted(() => {
  // 添加键盘事件监听
  document.addEventListener("keydown", handleKeyPress);

  // 添加全屏状态变化监听
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("mozfullscreenchange", handleFullscreenChange);
  document.addEventListener("MSFullscreenChange", handleFullscreenChange);
});

/**
 * 组件卸载时清理
 */
onUnmounted(() => {
  if (audioPlayerRef.value) {
    audioPlayerRef.value.pause();
  }

  // 清理全屏状态
  if (isFullscreen.value) {
    document.body.style.overflow = "";
    // 确保退出全屏
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  // 清理键盘事件监听
  document.removeEventListener("keydown", handleKeyPress);

  // 清理全屏事件监听
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
  document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
});
</script>

<style scoped>
/* 自定义音量滑块样式 */
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  height: 16px;
  width: 16px;
  border-radius: 50%;
  background: hsl(var(--primary));
  cursor: pointer;
  box-shadow: 0 0 2px 0 rgba(0, 0, 0, 0.2);
}

input[type="range"]::-webkit-slider-track {
  width: 100%;
  height: 8px;
  cursor: pointer;
  background: hsl(var(--muted));
  border-radius: 4px;
}

input[type="range"]::-moz-range-thumb {
  border: none;
  height: 16px;
  width: 16px;
  border-radius: 50%;
  background: hsl(var(--primary));
  cursor: pointer;
  box-shadow: 0 0 2px 0 rgba(0, 0, 0, 0.2);
}

input[type="range"]::-moz-range-track {
  width: 100%;
  height: 8px;
  cursor: pointer;
  background: hsl(var(--muted));
  border-radius: 4px;
  border: none;
}

/* 滚动条样式 */
.asr-content .overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.asr-content .overflow-y-auto::-webkit-scrollbar-track {
  background: hsl(var(--muted));
  border-radius: 3px;
}

.asr-content .overflow-y-auto::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground));
  border-radius: 3px;
}

.asr-content .overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground));
}

/* 移除焦点边框，避免按空格键时出现边框 */
.audio-visualization *:focus {
  outline: none !important;
  box-shadow: none !important;
}

.audio-visualization *:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}

/* 移除所有可能的焦点样式 */
.audio-visualization div:focus,
.audio-visualization span:focus,
.audio-visualization p:focus,
.audio-visualization .asr-content:focus,
.audio-visualization .asr-content *:focus {
  outline: none !important;
  box-shadow: none !important;
  border: none !important;
}

/* 移除 Dialog 相关的焦点样式 */
.audio-visualization [role="dialog"] *:focus,
.audio-visualization [role="dialog"] *:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  border: none !important;
}

/* 保持按钮的可访问性，使用自定义焦点样式，但仅在需要时显示 */
.audio-visualization button:focus-visible {
  outline: 1px solid hsl(var(--ring));
  outline-offset: 1px;
}

/* 全屏动画效果 */
.audio-visualization.fullscreen-enter {
  animation: fullscreenEnter 0.5s ease-out;
}

.audio-visualization.fullscreen-exit {
  animation: fullscreenExit 0.5s ease-out;
}

/* 原生全屏模式下的样式优化 */
.audio-visualization:fullscreen {
  background: hsl(var(--background));
  z-index: 2147483647;
  /* 最高层级 */
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: auto;
}

.audio-visualization:-webkit-full-screen {
  background: hsl(var(--background));
  z-index: 2147483647;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: auto;
}

.audio-visualization:-moz-full-screen {
  background: hsl(var(--background));
  z-index: 2147483647;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: auto;
}

.audio-visualization:-ms-fullscreen {
  background: hsl(var(--background));
  z-index: 2147483647;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: auto;
}

/* 原生全屏下的ASR内容容器高度 */
.audio-visualization:fullscreen .asr-content .overflow-y-auto,
.audio-visualization:-webkit-full-screen .asr-content .overflow-y-auto,
.audio-visualization:-moz-full-screen .asr-content .overflow-y-auto,
.audio-visualization:-ms-fullscreen .asr-content .overflow-y-auto {
  max-height: calc(100vh - 200px) !important;
}

@keyframes fullscreenEnter {
  0% {
    transform: scale(0.9) translateY(20px);
    opacity: 0;
  }

  50% {
    transform: scale(1.02) translateY(-5px);
    opacity: 0.8;
  }

  100% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

@keyframes fullscreenExit {
  0% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }

  50% {
    transform: scale(1.02) translateY(-10px);
    opacity: 0.8;
  }

  100% {
    transform: scale(0.9) translateY(20px);
    opacity: 0;
  }
}

/* 全屏标题栏淡入动画 */
.fullscreen-header {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  0% {
    transform: translateY(-20px);
    opacity: 0;
  }

  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 内容区域缩放动画 */
.content-scale-transition {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>

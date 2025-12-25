<template>
  <div class="audio-player bg-white border rounded-lg p-4">
    <div class="flex items-center gap-4">
      <!-- 播放/暂停按钮 -->
      <Button @click="togglePlayPause" size="sm" class="h-10 w-10 rounded-full p-0" :disabled="!audioUrl || disabled">
        <PlayIcon v-if="!isPlaying" class="h-5 w-5" />
        <PauseIcon v-else class="h-5 w-5" />
      </Button>

      <!-- 时间显示和进度条 -->
      <div class="flex-1">
        <div class="flex items-center justify-between text-sm text-muted-foreground mb-1">
          <span>{{ formatAudioTime(currentTime) }}</span>
          <span>{{ formatAudioTime(duration) }}</span>
        </div>
        <div class="w-full bg-muted rounded-full h-2 cursor-pointer" @click="seekTo" ref="progressBarRef" :class="{ 'cursor-not-allowed opacity-50': !audioUrl || disabled }">
          <div class="bg-primary h-2 rounded-full transition-all duration-100" :style="{ width: progressPercentage + '%' }"></div>
        </div>
      </div>

      <!-- 音量控制 -->
      <div class="relative" ref="volumeControlRef">
        <Button @click="toggleVolumePanel" size="sm" variant="outline" class="h-8 w-8 rounded-full p-0" title="音量控制" :disabled="!audioUrl || disabled">
          <Volume2Icon class="h-4 w-4" />
        </Button>

        <!-- 音量调节面板 -->
        <div v-if="showVolumePanel" class="absolute right-0 bottom-full mb-2 bg-white border rounded-lg shadow-lg p-3 min-w-[120px]">
          <div class="flex items-center gap-2">
            <Volume2Icon class="h-4 w-4 text-muted-foreground shrink-0" />
            <input type="range" min="0" max="1" step="0.1" v-model="volume" @input="updateVolume" class="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
          </div>
          <div class="text-xs text-muted-foreground text-center mt-1">{{ Math.round(volume * 100) }}%</div>
        </div>
      </div>
    </div>

    <!-- 隐藏的音频元素 -->
    <audio ref="audioRef" @loadedmetadata="onAudioLoaded" @timeupdate="onTimeUpdate" @ended="onAudioEnded" :src="audioUrl" preload="metadata"></audio>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";
import { Button } from "@/components/ui/button";
import { PlayIcon, PauseIcon, Volume2Icon } from "lucide-vue-next";

// Props
const props = defineProps({
  // 音频文件URL
  audioUrl: {
    type: String,
    required: true,
  },
  // 是否自动播放
  autoplay: {
    type: Boolean,
    default: false,
  },
  // 是否禁用播放器
  disabled: {
    type: Boolean,
    default: false,
  },
  // 是否禁用键盘快捷键
  disableKeyboard: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["play", "pause", "ended", "timeupdate"]);

// 响应式数据
const audioRef = ref(null);
const progressBarRef = ref(null);
const volumeControlRef = ref(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(1);
const showVolumePanel = ref(false);

// 计算属性
const progressPercentage = computed(() => {
  if (!duration.value) return 0;
  return (currentTime.value / duration.value) * 100;
});

// 方法
/**
 * 格式化音频播放器时间显示(输入为秒)
 * @param {number} timeInSeconds - 秒时间
 * @returns {string} 格式化的时间字符串
 */
const formatAudioTime = (timeInSeconds) => {
  if (!timeInSeconds || isNaN(timeInSeconds)) return "0:00";

  const seconds = Math.floor(timeInSeconds);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

/**
 * 播放/暂停切换
 */
const togglePlayPause = () => {
  if (!audioRef.value || props.disabled) return;

  if (isPlaying.value) {
    audioRef.value.pause();
    emit("pause");
  } else {
    audioRef.value.play();
    emit("play");
  }
  isPlaying.value = !isPlaying.value;
};

/**
 * 跳转到指定时间
 * @param {Event} event - 点击事件
 */
const seekTo = (event) => {
  if (!audioRef.value || !progressBarRef.value || props.disabled) return;

  const rect = progressBarRef.value.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percentage = clickX / rect.width;
  const newTime = percentage * duration.value;

  audioRef.value.currentTime = newTime;
  currentTime.value = newTime;
};

/**
 * 快退5秒
 */
const seekBackward = () => {
  if (!audioRef.value || props.disabled) return;

  const newTime = Math.max(0, currentTime.value - 5);
  audioRef.value.currentTime = newTime;
  currentTime.value = newTime;
};

/**
 * 快进5秒
 */
const seekForward = () => {
  if (!audioRef.value || props.disabled) return;

  const newTime = Math.min(duration.value || 0, currentTime.value + 5);
  audioRef.value.currentTime = newTime;
  currentTime.value = newTime;
};

/**
 * 更新音量
 */
const updateVolume = () => {
  if (audioRef.value) {
    audioRef.value.volume = volume.value;
  }
};

/**
 * 音频加载完成
 */
const onAudioLoaded = () => {
  if (audioRef.value) {
    duration.value = audioRef.value.duration;
    currentTime.value = audioRef.value.currentTime;

    // 如果设置了自动播放
    if (props.autoplay) {
      togglePlayPause();
    }
  }
};

/**
 * 音频时间更新
 */
const onTimeUpdate = () => {
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime;
    emit("timeupdate", currentTime.value);
  }
};

/**
 * 音频播放结束
 */
const onAudioEnded = () => {
  isPlaying.value = false;
  currentTime.value = 0;
  emit("ended");
};

/**
 * 切换音量控制面板
 */
const toggleVolumePanel = () => {
  if (props.disabled) return;

  showVolumePanel.value = !showVolumePanel.value;

  if (showVolumePanel.value) {
    // 添加点击外部关闭的监听
    nextTick(() => {
      document.addEventListener("click", closeVolumePanel);
    });
  } else {
    // 移除监听
    document.removeEventListener("click", closeVolumePanel);
  }

  // 移除按钮焦点，避免保持选中样式
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
};

/**
 * 关闭音量控制面板
 */
const closeVolumePanel = (event) => {
  // 检查点击是否在音量控制区域外
  if (volumeControlRef.value && !volumeControlRef.value.contains(event.target)) {
    showVolumePanel.value = false;
    document.removeEventListener("click", closeVolumePanel);
  }
};

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
  // 如果禁用键盘快捷键，直接返回
  if (props.disableKeyboard) return;

  // 只在不在输入框等元素中且有音频URL且未禁用时响应
  if (!isInputElement(event.target) && props.audioUrl && !props.disabled) {
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
    }
  }
};

/**
 * 重置播放器状态
 */
const reset = () => {
  if (audioRef.value) {
    audioRef.value.pause();
  }
  isPlaying.value = false;
  currentTime.value = 0;
  duration.value = 0;
  showVolumePanel.value = false;
  // 移除事件监听
  document.removeEventListener("click", closeVolumePanel);
};

/**
 * 播放音频
 */
const play = () => {
  if (audioRef.value && !isPlaying.value && !props.disabled) {
    audioRef.value.play();
    isPlaying.value = true;
    emit("play");
  }
};

/**
 * 暂停音频
 */
const pause = () => {
  if (audioRef.value && isPlaying.value) {
    audioRef.value.pause();
    isPlaying.value = false;
    emit("pause");
  }
};

/**
 * 设置播放时间
 * @param {number} time - 时间（秒）
 */
const setCurrentTime = (time) => {
  if (audioRef.value && !props.disabled) {
    audioRef.value.currentTime = time;
    currentTime.value = time;
  }
};

/**
 * 设置音量
 * @param {number} vol - 音量（0-1）
 */
const setVolume = (vol) => {
  volume.value = Math.max(0, Math.min(1, vol));
  updateVolume();
};

// 暴露方法给父组件
defineExpose({
  reset,
  play,
  pause,
  setCurrentTime,
  setVolume,
  seekBackward,
  seekForward,
  isPlaying: () => isPlaying.value,
  getCurrentTime: () => currentTime.value,
  getDuration: () => duration.value,
});

// 生命周期钩子
onMounted(() => {
  // 添加键盘事件监听
  document.addEventListener("keydown", handleKeyPress);
});

onUnmounted(() => {
  // 清理资源和事件监听
  reset();
  document.removeEventListener("keydown", handleKeyPress);
});
</script>

<style scoped>
/* 音频播放器音量滑块样式 */
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

/* 移除音频播放器焦点边框 */
.audio-player *:focus {
  outline: none !important;
  box-shadow: none !important;
}

.audio-player *:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}

/* 保持按钮的可访问性，使用自定义焦点样式 */
.audio-player button:focus-visible {
  outline: 1px solid hsl(var(--ring));
  outline-offset: 1px;
}
</style>

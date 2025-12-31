<template>
  <div class="landing-page">
    <!-- 导航栏 -->
    <header class="nav-header" :class="{ 'nav-scrolled': scrolled }">
      <div class="nav-container">
        <div class="nav-logo">
          <img src="/logo.svg" alt="logo" class="logo-img" />
          <span class="logo-text" :class="{ 'text-dark': scrolled }">LexSeek | 法索 AI</span>
        </div>
        <button @click="goToRegister" class="nav-btn" :class="{ 'nav-btn-scrolled': scrolled }">
          免费注册
        </button>
      </div>
    </header>

    <!-- Hero 区域 -->
    <section class="hero-section">
      <!-- 背景层 -->
      <div class="hero-bg"></div>
      <div class="hero-gradient-1"></div>
      <div class="hero-gradient-2"></div>
      <div class="hero-grid"></div>
      <div class="hero-glow-1"></div>
      <div class="hero-glow-2"></div>

      <div class="hero-content">
        <!-- 邀请标签 -->
        <div class="invite-badge">
          <Gift class="badge-icon" />
          <span>专属邀请 · 限时福利</span>
        </div>

        <!-- 主标题 -->
        <h1 class="hero-title">
          让 AI 处理繁琐<br />
          <span class="hero-title-gradient">您专注判断</span>
        </h1>

        <!-- 副标题 -->
        <p class="hero-subtitle">
          您的好友邀请您体验法索 AI — 专为法律人打造的智能案件分析助手，
          数秒内完成案件梳理，让您聚焦高阶策略。
        </p>

        <!-- CTA 按钮 -->
        <div class="hero-cta">
          <button @click="goToRegister" class="cta-primary">
            立即免费体验
            <ArrowRight class="cta-icon" />
          </button>
          <a href="#features" class="cta-secondary">
            了解更多
            <ChevronDown class="cta-icon-bounce" />
          </a>
        </div>

        <!-- 福利卡片 -->
        <div class="benefit-cards">
          <div class="benefit-card">
            <div class="benefit-icon benefit-icon-green">
              <Coins class="icon-sm" />
            </div>
            <div class="benefit-value">300</div>
            <div class="benefit-label">积分奖励</div>
          </div>
          <div class="benefit-card">
            <div class="benefit-icon benefit-icon-blue">
              <Clock class="icon-sm" />
            </div>
            <div class="benefit-value">7 天</div>
            <div class="benefit-label">免费试用</div>
          </div>
          <div class="benefit-card">
            <div class="benefit-icon benefit-icon-purple">
              <Users class="icon-sm" />
            </div>
            <div class="benefit-value">1v1</div>
            <div class="benefit-label">专属客服</div>
          </div>
        </div>
      </div>

      <!-- 滚动指示 -->
      <div class="scroll-indicator">
        <div class="scroll-mouse">
          <div class="scroll-dot"></div>
        </div>
      </div>
    </section>

    <!-- 视频展示区 -->
    <section class="video-section">
      <div class="section-container">
        <div class="section-header">
          <h2 class="section-title">看看法索 AI 如何工作</h2>
          <p class="section-desc">5分钟了解如何提升您的办案效率</p>
        </div>
        <div class="video-wrapper">
          <video src="https://lexseek.cn/video/vcr.mp4" webkit-playsinline playsinline
            poster="https://lexseek.cn/video/cover.png" controls class="video-player">
          </video>
        </div>
        <p class="video-tagline">"你的 Dirty Work，我们包了！"</p>
      </div>
    </section>

    <!-- 功能特性 -->
    <section id="features" class="features-section">
      <div class="section-container">
        <div class="section-header">
          <div class="section-badge">
            <Sparkles class="badge-icon-sm" />
            核心功能
          </div>
          <h2 class="section-title-lg">一个真正理解法律的 AI</h2>
          <p class="section-desc">专为法律人设计，从案件梳理到策略分析，全方位提升您的工作效率</p>
        </div>

        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon feature-icon-blue">
              <FileText class="icon-md" />
            </div>
            <h3 class="feature-title">案件概要生成</h3>
            <p class="feature-desc">无论是非结构化文本还是语音转录稿，数秒内生成结构清晰、要点突出的案件概要。</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon feature-icon-purple">
              <Calendar class="icon-md" />
            </div>
            <h3 class="feature-title">案件大事记</h3>
            <p class="feature-desc">自动生成表格版案件大事记，按时间顺序清晰梳理，复杂案件进程一目了然。</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon feature-icon-orange">
              <Target class="icon-md" />
            </div>
            <h3 class="feature-title">战略分析</h3>
            <p class="feature-desc">预判请求权基础，预测对方抗辩，基于法律法规提供有力应对策略。</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon feature-icon-green">
              <ClipboardList class="icon-md" />
            </div>
            <h3 class="feature-title">证据清单</h3>
            <p class="feature-desc">从海量材料中生成清晰证据列表，识别关键证据，指导证据准备方向。</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon feature-icon-pink">
              <Wrench class="icon-md" />
            </div>
            <h3 class="feature-title">办案工具库</h3>
            <p class="feature-desc">内置利息、诉讼费、赔偿金等十余款高频法律计算工具，精准快速完成计算。</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon feature-icon-cyan">
              <FileDown class="icon-md" />
            </div>
            <h3 class="feature-title">自定义导出</h3>
            <p class="feature-desc">拖拽调整模块顺序，一键导出完全符合您要求的专业报告，可自由编辑。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 使用流程 -->
    <section class="steps-section">
      <div class="section-container">
        <div class="section-header">
          <h2 class="section-title-light">三步开启高效办案</h2>
          <p class="section-desc-light">简单易用，即刻上手</p>
        </div>

        <div class="steps-grid">
          <div class="step-item">
            <div class="step-number">1</div>
            <div class="step-content">
              <h3 class="step-title">输入案件信息</h3>
              <p class="step-desc">选择案件类型，粘贴案件笔记、文档或音频转录稿，无需特殊格式处理。</p>
            </div>
          </div>

          <div class="step-item">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3 class="step-title">一键启动分析</h3>
              <p class="step-desc">轻轻一点，专属分析模型立即启动，片刻间完成深入、多维度智能分析。</p>
            </div>
          </div>

          <div class="step-item">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3 class="step-title">使用并优化</h3>
              <p class="step-desc">获得完整结构化报告，直接采纳或迭代优化，导出精良文书。</p>
            </div>
          </div>
        </div>

        <div class="steps-cta">
          <button @click="goToRegister" class="btn-white">立即开始使用</button>
        </div>
      </div>
    </section>

    <!-- 核心理念 -->
    <section class="philosophy-section">
      <div class="section-container-sm">
        <div class="philosophy-badge">
          <Heart class="badge-icon-sm" />
          我们的理念
        </div>
        <h2 class="philosophy-title">让专业的人，做专业的事</h2>
        <p class="philosophy-text">
          我们坚信，技术不应试图模仿或取代法律人那份无可替代的法律智慧与专业判断。
          我们的使命是打造能真正尊重您的专业、解放您的精力、提供精准辅助的工具，
          让您能聚焦于案件本身、客户沟通和高阶法律策略这些真正重要的事。
        </p>
        <div class="philosophy-slogan">让 LexSeek 成为您驱动卓越的智能引擎</div>
      </div>
    </section>

    <!-- 最终 CTA -->
    <section class="final-cta-section">
      <div class="final-cta-bg"></div>
      <div class="section-container-sm final-cta-content">
        <h2 class="final-cta-title">准备好革新您的办案模式了吗？</h2>
        <p class="final-cta-desc">加入日益壮大的法律精英社群，体验更智能、更高效的工作方式。</p>
        <div class="final-cta-badge">
          <Gift class="badge-icon" />
          注册即送 300 积分 + 7天免费试用 + 专属客服指导
        </div>
        <button @click="goToRegister" class="btn-gradient">免费注册，即刻体验</button>
      </div>
    </section>

    <!-- 页脚 -->
    <footer class="footer-section">
      <p class="footer-text">© 2025 LexSeek | 法索 AI. 版权所有 — 法律科技的未来，已然到来。</p>
    </footer>

    <!-- 移动端固定注册按钮 -->
    <div class="mobile-cta">
      <button @click="goToRegister" class="mobile-cta-btn">免费注册，即刻体验</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Gift, Clock, Coins, Users, Wrench, FileDown,
  ArrowRight, ChevronDown, Sparkles, FileText,
  Calendar, Target, ClipboardList, Heart
} from "lucide-vue-next";

// 设置页面不使用默认 layout
definePageMeta({
  layout: false,
  title: "邀请注册",
});

const route = useRoute();
const router = useRouter();

const invitedBy = ref("");
const scrolled = ref(false);

/**
 * 跳转到注册页面
 */
const goToRegister = () => {
  if (invitedBy.value) {
    router.push(`/register?invitedBy=${invitedBy.value}`);
  } else {
    router.push("/register");
  }
};

/**
 * 存储邀请码到 localStorage
 */
const storeInvitedBy = (code: string) => {
  try {
    localStorage.setItem("invitedBy", code);
    console.log("邀请码已存储到 localStorage:", code);
  } catch (error) {
    console.error("存储邀请码失败:", error);
  }
};

/**
 * 监听滚动事件
 */
const handleScroll = () => {
  scrolled.value = window.scrollY > 50;
};

onMounted(() => {
  // 获取路由参数中的邀请码
  const inviteCode = route.params.invitedBy as string;

  if (inviteCode) {
    invitedBy.value = inviteCode;
    storeInvitedBy(inviteCode);
    console.log("邀请注册落地页加载，邀请码:", inviteCode);
  } else {
    console.warn("未检测到邀请码参数");
  }

  // 添加滚动监听
  window.addEventListener("scroll", handleScroll);
});

onUnmounted(() => {
  // 移除滚动监听
  window.removeEventListener("scroll", handleScroll);
});
</script>

<style scoped>
/* ========== 基础重置 ========== */
.landing-page {
  background-color: #ffffff !important;
  color: #18181b !important;
  min-height: 100vh;
  overflow-x: hidden;
}

/* ========== 导航栏 ========== */
.nav-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  transition: all 0.3s ease;
  background: transparent;
}

.nav-scrolled {
  background: rgba(255, 255, 255, 0.95) !important;
  backdrop-filter: blur(12px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo-img {
  width: 36px;
  height: 36px;
}

.logo-text {
  font-size: 1.125rem;
  font-weight: 700;
  color: #ffffff;
  transition: color 0.3s ease;
}

.logo-text.text-dark {
  color: #18181b !important;
}

.nav-btn {
  padding: 0.625rem 1.5rem;
  border-radius: 9999px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.nav-btn-scrolled {
  background: #18181b !important;
  color: #ffffff !important;
  border: none !important;
}

.nav-btn-scrolled:hover {
  background: #27272a !important;
}

/* ========== Hero 区域 ========== */
.hero-section {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 6rem 1.5rem 4rem;
}

.hero-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom right, #18181b, #27272a, #000000);
}

.hero-gradient-1 {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at top right, rgba(59, 130, 246, 0.2), transparent 50%);
}

.hero-gradient-2 {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at bottom left, rgba(147, 51, 234, 0.2), transparent 50%);
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 60px 60px;
}

.hero-glow-1 {
  position: absolute;
  top: 25%;
  left: 25%;
  width: 16rem;
  height: 16rem;
  background: rgba(59, 130, 246, 0.3);
  border-radius: 50%;
  filter: blur(100px);
  animation: pulse 4s ease-in-out infinite;
}

.hero-glow-2 {
  position: absolute;
  bottom: 25%;
  right: 25%;
  width: 20rem;
  height: 20rem;
  background: rgba(147, 51, 234, 0.2);
  border-radius: 50%;
  filter: blur(120px);
  animation: pulse 4s ease-in-out infinite 1s;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

.hero-content {
  position: relative;
  z-index: 10;
  max-width: 1000px;
  margin: 0 auto;
  text-align: center;
}

/* ========== 邀请标签 ========== */
.invite-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-bottom: 2rem;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.875rem;
  font-weight: 500;
}

.badge-icon {
  width: 1rem;
  height: 1rem;
  color: #facc15;
}

/* ========== Hero 标题 ========== */
.hero-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 1.5rem;
  line-height: 1.2;
}

@media (min-width: 768px) {
  .hero-title {
    font-size: 3.75rem;
  }
}

@media (min-width: 1024px) {
  .hero-title {
    font-size: 4.5rem;
  }
}

.hero-title-gradient {
  background: linear-gradient(to right, #60a5fa, #a78bfa, #f472b6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero-subtitle {
  font-size: 1.125rem;
  color: rgba(255, 255, 255, 0.7);
  max-width: 640px;
  margin: 0 auto 2.5rem;
  line-height: 1.75;
}

@media (min-width: 768px) {
  .hero-subtitle {
    font-size: 1.25rem;
  }
}

/* ========== CTA 按钮 ========== */
.hero-cta {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  justify-content: center;
  align-items: center;
  margin-bottom: 4rem;
}

@media (min-width: 640px) {
  .hero-cta {
    flex-direction: row;
  }
}

.cta-primary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 2rem;
  background: #ffffff;
  color: #18181b;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 1.125rem;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.cta-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 25px 50px -12px rgba(255, 255, 255, 0.2);
}

.cta-icon {
  width: 1.25rem;
  height: 1.25rem;
  transition: transform 0.3s ease;
}

.cta-primary:hover .cta-icon {
  transform: translateX(4px);
}

.cta-secondary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 2rem;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
  transition: color 0.3s ease;
  text-decoration: none;
}

.cta-secondary:hover {
  color: #ffffff;
}

.cta-icon-bounce {
  width: 1.25rem;
  height: 1.25rem;
  animation: bounce 1s infinite;
}

@keyframes bounce {

  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(4px);
  }
}

/* ========== 福利卡片 ========== */
.benefit-cards {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 1rem;
  max-width: 720px;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .benefit-cards {
    grid-template-columns: repeat(3, 1fr);
  }
}

.benefit-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 1rem;
  padding: 1.25rem;
  text-align: center;
}

.benefit-icon {
  width: 3rem;
  height: 3rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.75rem;
}

.benefit-icon-green {
  background: rgba(34, 197, 94, 0.2);
}

.benefit-icon-green .icon-sm {
  color: #4ade80;
}

.benefit-icon-blue {
  background: rgba(59, 130, 246, 0.2);
}

.benefit-icon-blue .icon-sm {
  color: #60a5fa;
}

.benefit-icon-purple {
  background: rgba(147, 51, 234, 0.2);
}

.benefit-icon-purple .icon-sm {
  color: #a78bfa;
}

.icon-sm {
  width: 1.5rem;
  height: 1.5rem;
}

.benefit-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 0.25rem;
}

.benefit-label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
}

/* ========== 滚动指示器 ========== */
.scroll-indicator {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
}

.scroll-mouse {
  width: 1.5rem;
  height: 2.5rem;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 9999px;
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
}

.scroll-dot {
  width: 0.375rem;
  height: 0.75rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 9999px;
  animation: bounce 1s infinite;
}

/* ========== 视频区域 ========== */
.video-section {
  padding: 5rem 0;
  background: #f9fafb;
}

.section-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.section-header {
  text-align: center;
  margin-bottom: 3rem;
}

.section-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #18181b;
  margin-bottom: 1rem;
}

@media (min-width: 768px) {
  .section-title {
    font-size: 2.25rem;
  }
}

.section-desc {
  font-size: 1.125rem;
  color: #71717a;
}

.video-wrapper {
  border-radius: 1rem;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.video-player {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.video-tagline {
  text-align: center;
  font-size: 1.25rem;
  color: #71717a;
  font-weight: 500;
  margin-top: 2rem;
}

/* ========== 功能特性 ========== */
.features-section {
  padding: 6rem 0;
  background: #ffffff;
}

.section-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 9999px;
  background: #f4f4f5;
  color: #52525b;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.badge-icon-sm {
  width: 1rem;
  height: 1rem;
}

.section-title-lg {
  font-size: 1.875rem;
  font-weight: 700;
  color: #18181b;
  margin-bottom: 1rem;
}

@media (min-width: 768px) {
  .section-title-lg {
    font-size: 3rem;
  }
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .features-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.feature-card {
  padding: 2rem;
  border-radius: 1rem;
  border: 1px solid #e4e4e7;
  background: #ffffff;
  transition: all 0.3s ease;
}

.feature-card:hover {
  border-color: #d4d4d8;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.feature-icon {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  transition: transform 0.3s ease;
}

.feature-card:hover .feature-icon {
  transform: scale(1.1);
}

.feature-icon-blue {
  background: linear-gradient(to bottom right, #3b82f6, #2563eb);
}

.feature-icon-purple {
  background: linear-gradient(to bottom right, #8b5cf6, #7c3aed);
}

.feature-icon-orange {
  background: linear-gradient(to bottom right, #f97316, #ea580c);
}

.feature-icon-green {
  background: linear-gradient(to bottom right, #22c55e, #16a34a);
}

.feature-icon-pink {
  background: linear-gradient(to bottom right, #ec4899, #db2777);
}

.feature-icon-cyan {
  background: linear-gradient(to bottom right, #06b6d4, #0891b2);
}

.icon-md {
  width: 1.75rem;
  height: 1.75rem;
  color: #ffffff;
}

.feature-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #18181b;
  margin-bottom: 0.75rem;
}

.feature-desc {
  color: #52525b;
  line-height: 1.625;
}

/* ========== 使用流程 ========== */
.steps-section {
  padding: 6rem 0;
  background: #18181b;
  color: #ffffff;
}

.section-title-light {
  font-size: 1.875rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 1rem;
}

@media (min-width: 768px) {
  .section-title-light {
    font-size: 3rem;
  }
}

.section-desc-light {
  font-size: 1.125rem;
  color: #a1a1aa;
}

.steps-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 2rem;
  margin-top: 3rem;
}

@media (min-width: 768px) {
  .steps-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.step-item {
  position: relative;
}

.step-number {
  font-size: 6rem;
  font-weight: 700;
  color: #27272a;
  position: absolute;
  top: -1rem;
  left: -0.5rem;
  line-height: 1;
}

.step-content {
  position: relative;
  z-index: 10;
  padding-top: 3rem;
}

.step-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 1rem;
}

.step-desc {
  color: #a1a1aa;
  line-height: 1.625;
}

.steps-cta {
  text-align: center;
  margin-top: 4rem;
}

.btn-white {
  padding: 1rem 2.5rem;
  background: #ffffff;
  color: #18181b;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 1.125rem;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.btn-white:hover {
  transform: translateY(-2px);
  box-shadow: 0 25px 50px -12px rgba(255, 255, 255, 0.2);
}

/* ========== 核心理念 ========== */
.philosophy-section {
  padding: 6rem 0;
  background: linear-gradient(to bottom right, #f9fafb, #ffffff);
}

.section-container-sm {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 1.5rem;
  text-align: center;
}

.philosophy-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 9999px;
  background: #18181b;
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 2rem;
}

.philosophy-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #18181b;
  margin-bottom: 2rem;
}

@media (min-width: 768px) {
  .philosophy-title {
    font-size: 2.25rem;
  }
}

.philosophy-text {
  font-size: 1.25rem;
  color: #52525b;
  line-height: 1.75;
  margin-bottom: 2rem;
}

.philosophy-slogan {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(to right, #18181b, #52525b, #18181b);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* ========== 最终 CTA ========== */
.final-cta-section {
  position: relative;
  padding: 6rem 0;
  background: #18181b;
  overflow: hidden;
}

.final-cta-bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(59, 130, 246, 0.1), transparent 70%);
}

.final-cta-content {
  position: relative;
  z-index: 10;
}

.final-cta-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 1.5rem;
}

@media (min-width: 768px) {
  .final-cta-title {
    font-size: 3rem;
  }
}

.final-cta-desc {
  font-size: 1.25rem;
  color: #a1a1aa;
  margin-bottom: 1rem;
}

.final-cta-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: 9999px;
  background: linear-gradient(to right, rgba(234, 179, 8, 0.2), rgba(249, 115, 22, 0.2));
  border: 1px solid rgba(234, 179, 8, 0.3);
  color: #facc15;
  font-weight: 500;
  margin-bottom: 2.5rem;
}

.btn-gradient {
  padding: 1.25rem 3rem;
  background: linear-gradient(to right, #3b82f6, #8b5cf6);
  color: #ffffff;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 1.25rem;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.btn-gradient:hover {
  transform: translateY(-2px);
  box-shadow: 0 25px 50px -12px rgba(139, 92, 246, 0.3);
}

/* ========== 页脚 ========== */
.footer-section {
  padding: 2rem 0;
  background: #09090b;
}

.footer-text {
  text-align: center;
  color: #71717a;
}

/* ========== 移动端固定按钮 ========== */
.mobile-cta {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(12px);
  border-top: 1px solid #e4e4e7;
  display: block;
}

@media (min-width: 768px) {
  .mobile-cta {
    display: none;
  }
}

.mobile-cta-btn {
  width: 100%;
  padding: 1rem;
  background: linear-gradient(to right, #18181b, #27272a);
  color: #ffffff;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 1rem;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.mobile-cta-btn:active {
  transform: scale(0.98);
}
</style>

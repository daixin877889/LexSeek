<template>
  <footer class="border-t py-6 bg-muted/30">
    <div class="max-w-[1280px] mx-auto px-4">
      <div class="flex flex-col md:flex-row justify-between items-center gap-4">
        <p class="text-sm text-muted-foreground text-center md:text-left">
          © 2025 上海盛熙律泓教育科技有限公司｜
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-foreground transition-colors"
          >沪ICP备2025118451号</a>
        </p>
        <div class="flex flex-wrap justify-center md:justify-end gap-4">
          <NuxtLink
            to="/privacy-agreement"
            class="text-sm text-muted-foreground hover:text-primary transition-colors"
          >隐私政策</NuxtLink>
          <NuxtLink
            to="/terms-of-use"
            class="text-sm text-muted-foreground hover:text-primary transition-colors"
          >使用条款</NuxtLink>
          <NuxtLink
            to="/about/#contact"
            class="text-sm text-muted-foreground hover:text-primary transition-colors"
          >联系我们</NuxtLink>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts"></script>

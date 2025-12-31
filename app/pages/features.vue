<template>
  <div>
    <!-- 页面标题 -->
    <section class="bg-primary/5 py-12 md:py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center">
          <h1 class="text-4xl font-bold mb-4">产品功能</h1>
          <p class="text-xl text-muted-foreground max-w-3xl mx-auto">了解LexSeek如何通过AI技术赋能法律分析，提升您的工作效率</p>
        </div>
      </div>
    </section>

    <!-- 主要功能板块 -->
    <section class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-16">
          <h2 class="text-3xl font-bold mb-4">全方位法律分析工具</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">LexSeek为律师提供全面的案件分析工具，帮助您更高效地处理法律案件</p>
        </div>

        <div class="grid md:grid-cols-2 gap-12 mb-16">
          <!-- 案情概要功能 -->
          <div class="flex flex-col">
            <div class="bg-primary/5 rounded-lg p-6 mb-6 grow">
              <div class="flex items-start gap-4">
                <div class="bg-primary/10 text-primary p-3 rounded-md">
                  <file-text-icon class="h-6 w-6" />
                </div>
                <div>
                  <h3 class="text-xl font-semibold mb-2">案情概要生成</h3>
                  <p class="text-muted-foreground mb-4">AI技术自动分析案件材料，提取关键信息并生成简洁明了的案情概要，帮助您快速把握案件要点。</p>
                  <ul class="space-y-2">
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>自动识别关键案情要素</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>结构化呈现案件事实与争议</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>突出案件中的关键证据</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <img src="@/assets/features/summary.jpg" alt="案情概要示例" class="rounded-lg shadow-md w-full" />
          </div>

          <!-- 案件大事记功能 -->
          <div class="flex flex-col">
            <div class="bg-primary/5 rounded-lg p-6 mb-6 grow">
              <div class="flex items-start gap-4">
                <div class="bg-primary/10 text-primary p-3 rounded-md">
                  <calendar-icon class="h-6 w-6" />
                </div>
                <div>
                  <h3 class="text-xl font-semibold mb-2">案件大事记</h3>
                  <p class="text-muted-foreground mb-4">自动整理案件中的重要时间点和事件，按时间顺序呈现关键事件，便于您全面了解案件发展过程。</p>
                  <ul class="space-y-2">
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>精准提取时间信息</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>清晰的时间线显示</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>关联事件与证据材料</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <img src="@/assets/features/timeline.jpg" alt="案件大事记示例" class="rounded-lg shadow-md w-full" />
          </div>

          <!-- 案由确认功能 -->
          <div class="flex flex-col">
            <div class="bg-primary/5 rounded-lg p-6 mb-6 grow">
              <div class="flex items-start gap-4">
                <div class="bg-primary/10 text-primary p-3 rounded-md">
                  <gavel-icon class="h-6 w-6" />
                </div>
                <div>
                  <h3 class="text-xl font-semibold mb-2">案由确认</h3>
                  <p class="text-muted-foreground mb-4">智能识别案件类型和案由，提供法律依据和典型案件参考，帮助您准确定位案件性质。</p>
                  <ul class="space-y-2">
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>准确识别案件类型和案由</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>提供相关法条参考</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>匹配类似案件判例</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <img src="@/assets/features/cause.jpg" alt="案由确认示例" class="rounded-lg shadow-md w-full" />
          </div>

          <!-- 请求权生成与分析功能 -->
          <div class="flex flex-col">
            <div class="bg-primary/5 rounded-lg p-6 mb-6 grow">
              <div class="flex items-start gap-4">
                <div class="bg-primary/10 text-primary p-3 rounded-md">
                  <clipboard-list-icon class="h-6 w-6" />
                </div>
                <div>
                  <h3 class="text-xl font-semibold mb-2">请求权生成与分析</h3>
                  <p class="text-muted-foreground mb-4">根据案情自动生成可能的请求权，并提供详细分析和法律依据，帮助您制定更有力的诉讼策略。</p>
                  <ul class="space-y-2">
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>智能推荐适用请求权</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>分析构成要件的事实支持</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                      <span>提供法条和判例支持</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <img src="@/assets/features/rights.jpg" alt="请求权分析示例" class="rounded-lg shadow-md w-full" />
          </div>
        </div>

        <!-- 扩展功能 -->
        <div class="grid md:grid-cols-2 gap-8">
          <!-- 对方抗辩预测 -->
          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-start gap-4">
              <div class="bg-primary/10 text-primary p-3 rounded-md">
                <shield-icon class="h-6 w-6" />
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-2">对方抗辩预测</h3>
                <p class="text-muted-foreground">预测对方可能的抗辩理由和策略，帮助您提前准备应对方案，针对性地加强自身案件准备。</p>
              </div>
            </div>
          </div>

          <!-- 证据清单 -->
          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-start gap-4">
              <div class="bg-primary/10 text-primary p-3 rounded-md">
                <layers-icon class="h-6 w-6" />
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-2">证据清单</h3>
                <p class="text-muted-foreground">析并整理案件所需证据清单建议，让您胸有成竹。</p>
              </div>
            </div>
          </div>

          <!-- 法律合理性审查和判决趋势预测 -->
          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-start gap-4">
              <div class="bg-primary/10 text-primary p-3 rounded-md">
                <users-icon class="h-6 w-6" />
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-2">法律合理性审查和判决趋势预测</h3>
                <p class="text-muted-foreground">案件法律合理性审查、预测判决趋势，助您及时调整诉讼策略。</p>
              </div>
            </div>
          </div>

          <!-- 分析历史记录 -->
          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-start gap-4">
              <div class="bg-primary/10 text-primary p-3 rounded-md">
                <history-icon class="h-6 w-6" />
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-2">分析历史记录</h3>
                <p class="text-muted-foreground">保存所有分析结果，随时查阅和比较，持续跟踪案件进展，支持团队协作共享。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 技术优势 -->
    <section class="py-16 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">技术优势</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">基于最新的AI技术，LexSeek提供行业领先的法律分析能力</p>
        </div>

        <div class="grid md:grid-cols-3 gap-8">
          <div class="bg-card rounded-lg p-6 shadow-sm">
            <cpu-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">大语言模型</h3>
            <p class="text-muted-foreground">采用最新的大语言模型技术，深度理解法律语言，准确把握案件细节和法律概念。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <database-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">法律知识库</h3>
            <p class="text-muted-foreground">内置丰富的法律知识库，涵盖法条、判例和专业文献，为分析提供权威支持。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <key-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">安全可靠</h3>
            <p class="text-muted-foreground">采用端到端加密技术，确保您的案件数据安全，符合法律职业保密要求。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 客户案件 -->
    <section class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">客户案件</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">众多律师事务所和法律团队正在使用LexSeek提升工作效率</p>
        </div>

        <div class="grid md:grid-cols-3 gap-8">
          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-center gap-3 mb-4">
              <div class="bg-primary/10 text-primary p-2 rounded-full">
                <building-icon class="h-5 w-5" />
              </div>
              <h3 class="font-semibold">某知名律师事务所</h3>
            </div>
            <p class="text-muted-foreground mb-4">"LexSeek帮助我们节省了大量整理和分析案件的时间，让律师可以更专注于策略制定和客户沟通。"</p>
            <p class="text-sm">— 张律师，合伙人</p>
          </div>

          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-center gap-3 mb-4">
              <div class="bg-primary/10 text-primary p-2 rounded-full">
                <building-2-icon class="h-5 w-5" />
              </div>
              <h3 class="font-semibold">某企业法务部</h3>
            </div>
            <p class="text-muted-foreground mb-4">"通过LexSeek的分析，我们能够更快速地评估法律风险，为公司决策提供更及时的法律支持。"</p>
            <p class="text-sm">— 李总监，法务负责人</p>
          </div>

          <div class="bg-card rounded-lg p-6 border">
            <div class="flex items-center gap-3 mb-4">
              <div class="bg-primary/10 text-primary p-2 rounded-full">
                <user-icon class="h-5 w-5" />
              </div>
              <h3 class="font-semibold">独立执业律师</h3>
            </div>
            <p class="text-muted-foreground mb-4">"作为独立律师，LexSeek就像我的虚拟助手，帮助我处理更多案件，提供专业水准的分析支持。"</p>
            <p class="text-sm">— 王律师，专职律师</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 行动号召 -->
    <section class="py-16 bg-primary text-primary-foreground px-4">
      <div class="max-w-[1200px] mx-auto text-center">
        <h2 class="text-3xl font-bold mb-4">体验LexSeek的强大功能</h2>
        <p class="text-xl mb-8 max-w-2xl mx-auto opacity-90">立即注册并获得免费试用机会，亲身体验AI如何提升您的法律工作效率</p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <NuxtLink to="/dashboard/analysis"
            class="inline-flex items-center justify-center px-6 py-3 bg-background text-foreground font-medium rounded-md hover:bg-background/90 transition-colors">
            开始分析 </NuxtLink>
          <NuxtLink to="/pricing"
            class="inline-flex items-center justify-center px-6 py-3 bg-white/15 text-primary-foreground border border-white/30 font-medium rounded-md hover:bg-white/25 transition-colors">
            查看价格方案 </NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: "base-layout",
});
import { FileTextIcon, CalendarIcon, ClipboardListIcon, ShieldIcon, HistoryIcon, CheckIcon, CpuIcon, DatabaseIcon, KeyIcon, BuildingIcon, Building2Icon, UserIcon, LayersIcon, UsersIcon } from "lucide-vue-next";
import { GavelIcon } from "@/components/icons/GavelIcon";

onMounted(() => {
  window.scrollTo(0, 0);
});
</script>

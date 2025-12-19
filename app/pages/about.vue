<template>
  <div>
    <!-- 页面标题 -->
    <section class="bg-primary/5 py-12 md:py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center">
          <h1 class="text-4xl font-bold mb-4">关于我们</h1>
          <p class="text-xl text-muted-foreground max-w-3xl mx-auto">了解LexSeek的使命和团队，我们致力于通过AI技术革新法律服务</p>
        </div>
      </div>
    </section>

    <!-- 我们的使命 -->
    <section class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 class="text-3xl font-bold mb-6">我们的使命</h2>
            <p class="text-lg mb-4">LexSeek致力于将人工智能技术与法律专业知识相结合，为法律从业者提供高效、准确的案件分析工具， 帮助律师节省时间，提高工作效率，让法律服务更加普惠。</p>
            <p class="text-lg mb-4">我们相信，通过技术创新，可以简化法律工作中的繁琐任务，让律师能够更专注于创造性思维和客户服务， 从而提供更高质量的法律服务。</p>
            <p class="text-lg">同时，我们也致力于通过技术降低法律服务的门槛，让更多人能够获得专业、高效的法律帮助。</p>
          </div>
          <div class="bg-primary/5 rounded-lg p-8">
            <quote-icon class="h-12 w-12 text-primary mb-4" />
            <blockquote class="text-xl italic mb-6">"我们的愿景是打造一个智能法律助手，它不仅能够理解法律语言，还能够像经验丰富的律师一样思考和分析案件。"</blockquote>
            <div class="flex items-center gap-3">
              <div class="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <user-icon class="h-6 w-6 text-primary" />
              </div>
              <div>
                <p class="font-medium">程子洋</p>
                <p class="text-sm text-muted-foreground">LexSeek 创始人 & CEO</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 我们的价值观 -->
    <section class="py-16 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">我们的价值观</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">这些核心价值观指引着我们产品开发和团队文化的每一个决策</p>
        </div>

        <div class="grid md:grid-cols-3 gap-8">
          <div class="bg-card rounded-lg p-6 shadow-sm">
            <zap-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">科技创新</h3>
            <p class="text-muted-foreground">我们不断探索最新的AI技术，将其应用于法律领域，创造前所未有的分析能力和用户体验。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <shield-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">专业可靠</h3>
            <p class="text-muted-foreground">我们的产品建立在深厚的法律专业知识基础上，确保分析结果专业、准确、可靠。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <lock-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">安全保密</h3>
            <p class="text-muted-foreground">我们将用户数据安全和隐私保护视为最高优先级，采用严格的安全措施保护用户信息。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <users-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">协作共赢</h3>
            <p class="text-muted-foreground">我们相信技术与人的协作，致力于打造辅助工具而非替代品，帮助法律从业者取得更好的成果。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <sparkles-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">卓越体验</h3>
            <p class="text-muted-foreground">我们注重产品细节和用户体验，力求每一次交互都简单、高效、愉悦。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm">
            <heart-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">普惠法律</h3>
            <p class="text-muted-foreground">我们希望通过技术降低法律服务门槛，让更多人能够获得专业的法律帮助。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 我们的团队 -->
    <section class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">我们的团队</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">LexSeek由法律专家、AI研究人员和产品设计师组成的多元化团队，致力于创造最好的法律AI产品</p>
        </div>

        <!-- <div class="grid md:grid-cols-3 gap-8">
          <div class="bg-card rounded-lg overflow-hidden shadow-sm">
            <div class="aspect-[3/2] bg-primary/10 flex items-center justify-center">
              <user-icon class="h-24 w-24 text-primary/30" />
            </div>
            <div class="p-6">
              <h3 class="text-xl font-semibold mb-1">张明</h3>
              <p class="text-muted-foreground mb-4">创始人 & CEO</p>
              <p class="text-sm">
                前知名律所合伙人，拥有15年法律实务经验和计算机科学背景，致力于探索AI与法律的结合点。
              </p>
            </div>
          </div>

          <div class="bg-card rounded-lg overflow-hidden shadow-sm">
            <div class="aspect-[3/2] bg-primary/10 flex items-center justify-center">
              <user-icon class="h-24 w-24 text-primary/30" />
            </div>
            <div class="p-6">
              <h3 class="text-xl font-semibold mb-1">李晓华</h3>
              <p class="text-muted-foreground mb-4">首席技术官</p>
              <p class="text-sm">
                人工智能专家，曾在顶级科技公司负责NLP项目，擅长大语言模型的应用和优化。
              </p>
            </div>
          </div>

          <div class="bg-card rounded-lg overflow-hidden shadow-sm">
            <div class="aspect-[3/2] bg-primary/10 flex items-center justify-center">
              <user-icon class="h-24 w-24 text-primary/30" />
            </div>
            <div class="p-6">
              <h3 class="text-xl font-semibold mb-1">王梦琪</h3>
              <p class="text-muted-foreground mb-4">法律研究主管</p>
              <p class="text-sm">
                资深律师，专注于民商事案件，负责产品的法律知识库建设和案件分析算法的验证。
              </p>
            </div>
          </div>
        </div> -->
      </div>
    </section>

    <!-- 公司历程 -->
    <!-- <section class="py-16 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">公司历程</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">
            从创意到实现，LexSeek一路成长
          </p>
        </div>

        <div class="max-w-3xl mx-auto">
          <div class="space-y-12">
            <div class="flex gap-6">
              <div class="flex flex-col items-center">
                <div class="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <calendar-icon class="h-6 w-6" />
                </div>
                <div class="flex-1 w-px bg-primary/20 my-2"></div>
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-1">2023年1月</h3>
                <p class="text-lg text-primary font-medium mb-2">创意诞生</p>
                <p class="text-muted-foreground">
                  LexSeek的概念在一次法律科技创新研讨会上形成，创始人张明意识到AI技术可以极大提升法律工作效率。
                </p>
              </div>
            </div>

            <div class="flex gap-6">
              <div class="flex flex-col items-center">
                <div class="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <calendar-icon class="h-6 w-6" />
                </div>
                <div class="flex-1 w-px bg-primary/20 my-2"></div>
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-1">2023年5月</h3>
                <p class="text-lg text-primary font-medium mb-2">公司成立</p>
                <p class="text-muted-foreground">
                  LexSeek正式注册成立，汇集了一批对法律和AI技术充满热情的专业人才，开始产品研发。
                </p>
              </div>
            </div>

            <div class="flex gap-6">
              <div class="flex flex-col items-center">
                <div class="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <calendar-icon class="h-6 w-6" />
                </div>
                <div class="flex-1 w-px bg-primary/20 my-2"></div>
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-1">2023年9月</h3>
                <p class="text-lg text-primary font-medium mb-2">产品内测</p>
                <p class="text-muted-foreground">
                  LexSeek的第一个内测版本发布，邀请了30家律师事务所参与测试，收集反馈并持续优化产品。
                </p>
              </div>
            </div>

            <div class="flex gap-6">
              <div class="flex flex-col items-center">
                <div class="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <calendar-icon class="h-6 w-6" />
                </div>
                <div class="flex-1 w-px bg-primary/20 my-2"></div>
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-1">2024年1月</h3>
                <p class="text-lg text-primary font-medium mb-2">融资完成</p>
                <p class="text-muted-foreground">
                  获得A轮融资，加速产品开发和市场推广，扩大团队规模。
                </p>
              </div>
            </div>

            <div class="flex gap-6">
              <div class="flex flex-col items-center">
                <div class="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <calendar-icon class="h-6 w-6" />
                </div>
              </div>
              <div>
                <h3 class="text-xl font-semibold mb-1">2024年3月</h3>
                <p class="text-lg text-primary font-medium mb-2">正式上线</p>
                <p class="text-muted-foreground">
                  LexSeek平台正式上线，提供全面的案件分析服务，开始为法律从业者提供AI辅助工具。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section> -->

    <!-- 联系我们 -->
    <section id="contact" class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 class="text-3xl font-bold mb-6">联系我们</h2>
            <p class="text-lg mb-8">无论您是有产品疑问、合作意向，还是想加入我们的团队，都欢迎通过以下方式与我们联系。</p>

            <div class="space-y-4">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <mail-icon class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p class="font-medium">电子邮件</p>
                  <p class="text-muted-foreground">lexseek@lvhong-lawer.com</p>
                </div>
              </div>

              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <phone-icon class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p class="font-medium">电话</p>
                  <p class="text-muted-foreground">18116032042</p>
                </div>
              </div>

              <!-- <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <map-pin-icon class="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p class="font-medium">地址</p>
                  <p class="text-muted-foreground">北京市海淀区中关村科技园区</p>
                </div>
              </div> -->
            </div>
          </div>

          <div class="bg-card rounded-lg p-8 border text-center">
            <h3 class="text-xl font-semibold mb-6">扫描下方二维码添加客服微信，获取即时帮助</h3>

            <img class="mx-auto max-w-[200px]" src="/images/mpwxcode.jpg" alt="" />
            <!-- <form class="space-y-4">
              <div>
                <label for="name" class="block text-sm font-medium mb-1">姓名</label>
                <input id="name" type="text" class="w-full px-3 py-2 border rounded-md bg-background" placeholder="请输入您的姓名" />
              </div>

              <div>
                <label for="email" class="block text-sm font-medium mb-1">电子邮箱</label>
                <input id="email" type="email" class="w-full px-3 py-2 border rounded-md bg-background" placeholder="请输入您的电子邮箱" />
              </div>

              <div>
                <label for="subject" class="block text-sm font-medium mb-1">主题</label>
                <input id="subject" type="text" class="w-full px-3 py-2 border rounded-md bg-background" placeholder="请输入消息主题" />
              </div>

              <div>
                <label for="message" class="block text-sm font-medium mb-1">消息</label>
                <textarea id="message" rows="4" class="w-full px-3 py-2 border rounded-md bg-background resize-none" placeholder="请输入您的消息内容"></textarea>
              </div>

              <button type="submit" class="w-full py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
                发送消息
              </button>
            </form> -->
          </div>
        </div>
      </div>
    </section>

    <!-- 加入我们 -->
    <section class="py-16 bg-primary text-primary-foreground px-4">
      <div class="max-w-[1200px] mx-auto text-center">
        <h2 class="text-3xl font-bold mb-4">加入LexSeek团队</h2>
        <p class="text-xl mb-8 max-w-2xl mx-auto opacity-90">我们正在寻找对法律科技充满热情的人才加入我们的团队，一起打造未来的法律AI工具</p>
        <!-- <a href="mailto:careers@lexseek.com" class="inline-flex items-center justify-center px-6 py-3 bg-white text-primary font-medium rounded-md hover:bg-white/90 transition-colors">
          查看职位机会
        </a> -->
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: "base-layout",
});
import { onMounted } from "vue";
import { UserIcon, QuoteIcon, ZapIcon, ShieldIcon, LockIcon, UsersIcon, SparklesIcon, HeartIcon, CalendarIcon, MailIcon, PhoneIcon, MapPinIcon } from "lucide-vue-next";

onMounted(() => {
  window.scrollTo(0, 0);
  // const contactSection = document.getElementById('contact');
  // if (contactSection) {
  //   contactSection.scrollIntoView({ behavior: 'smooth' });
  // }
});
</script>

<template>
  <div class="container mx-auto py-8 px-4 sm:px-6">
    <div class="space-y-6">
      <!-- 标题部分 -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold mb-2">LexSeek（法索 AI ）使用条款</h1>
        <div class="text-sm text-gray-500">
          <p>生效日期：2025年4月1日</p>
          <p>最后更新日期：2025年6月8日</p>
        </div>
      </div>

      <!-- 目录导航 -->
      <div class="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
        <h2 class="text-lg font-semibold mb-3">目录</h2>
        <ul class="space-y-1">
          <li v-for="(section, index) in sections" :key="index">
            <a :href="`#section-${index + 1}`" class="text-primary hover:text-primary-800 hover:underline">
              {{ section }}
            </a>
          </li>
        </ul>
      </div>

      <!-- 介绍部分 -->
      <div class="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
        <p class="mb-4">欢迎使用LexSeek（中文名：法索 AI，“本平台”），一个由上海盛熙律泓教育科技有限公司运营的 AI 驱动的法律案件分析工具网站（域名：www.lexseek.cn）。</p>
        <p class="mb-4">
          在使用本服务前，请您务必仔细阅读并充分理解本《LexSeek（法索 AI） 使用条款》（下称"本条款"）的全部内容，特别是免除或者限制责任的条款、法律适用和争议解决条款。
          <strong>除非您已阅读并接受本条款所有条款，否则您无权使用本服务。您通过网络页面点击确认、实际使用本服务、或以其他任何方式明示或默示接受本条款的行为，即视为您已阅读并同意签署本条款，本条款即在您与我们之间产生法律效力，成为对双方均具有约束力的法律文件。</strong>
        </p>
        <p>如果您代表一个组织（如律师事务所、公司法务部等）使用本服务，即表示您声明并保证您拥有约束该组织的法律授权，并且该组织接受本条款的约束。在此情况下，"您"将指代该组织。</p>
      </div>

      <!-- 条款内容 -->
      <div class="space-y-8">
        <!-- 1. 服务描述 -->
        <section id="section-1" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">1. 服务描述</h2>
          <div class="pl-4 space-y-3">
            <p>1.1 LexSeek
              是一个利用人工智能技术，旨在协助注册用户（主要为法律专业人士，如律师、法务等）分析法律案件信息的工具。其功能包括但不限于：根据用户上传或输入的案件材料（事实描述、证据等）生成案情概要、大事记、辅助判断案由、提供潜在请求权分析及对方可能抗辩的预测等。
            </p>
            <p>1.2 <span class="font-semibold">重要提示：</span> LexSeek 提供的所有分析结果、概要、建议或预测，均是基于用户提供的信息和我们当前的 AI
              模型算法生成，<strong>仅供参考和辅助决策，不能替代、也不应被视为专业的法律意见、法律建议或律师的独立判断。</strong> 您作为专业的法律人士，有责任独立核实、评估和判断 LexSeek
              生成内容的准确性、完整性和适用性，并对基于这些内容作出的任何决策或行动独立承担全部责任。</p>
            <p>1.3 我们保留随时修改、暂停或终止部分或全部服务内容的权利，无需事先通知您。对于服务的修改、暂停或终止，我们不承担任何责任，除非法律有明确规定。</p>
          </div>
        </section>

        <!-- 2. 用户账户 -->
        <section id="section-2" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">2. 用户账户</h2>
          <div class="pl-4 space-y-3">
            <p>2.1 您需要注册一个 LexSeek 账户才能使用本服务。您同意提供准确、最新及完整的注册信息，并及时更新。</p>
            <p>2.2 您有责任妥善保管您的账户名和密码，并对通过您账户发生的所有活动承担责任。如您发现账户存在安全风险（如未经授权的使用），请立即通知我们。</p>
            <p>2.3 您不得将账户转让、出租、出借或以其他方式许可给第三方使用。</p>
            <p>2.4 我们有权根据运营需要或安全考虑，暂停或终止您的账户使用。</p>
          </div>
        </section>

        <!-- 3. 用户内容与数据 -->
        <section id="section-3" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">3. 用户内容与数据</h2>
          <div class="pl-4 space-y-3">
            <p>3.1 您通过 LexSeek 输入、上传或传输的所有案件材料、事实描述、证据文件及其他相关信息（下称"用户内容"）的知识产权归您或原始权利人所有。</p>
            <p>3.2
              为了向您提供本服务（包括但不限于分析、处理、生成结果、改进服务质量），您特此授予我们一项全球性的、非独占的、免许可费的、可分许可的、可转让的许可，允许我们根据本条款和我们的《隐私政策》使用、复制、修改、处理、存储、传输和展示您的用户内容。此许可仅限于运营、提供和改进
              LexSeek 服务的目的。</p>
            <p>3.3 您声明并保证：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>您拥有或已获得所有必要的权利、许可和授权，可以提交用户内容，并授予我们本条款所述的许可；</li>
              <li>您的用户内容及我们对其的使用不会侵犯任何第三方的知识产权、隐私权、商业秘密或其他合法权益；</li>
              <li>您的用户内容不包含任何非法、诽谤、淫秽、威胁、或令人反感的内容；</li>
              <li>您提交用户内容的行为符合所有适用的法律法规以及律师执业规范（包括但不限于客户保密义务）。您有责任对上传至本服务的数据进行必要的匿名化或脱敏处理，以符合相关法律法规和保密要求。</li>
            </ul>
            <p>3.4 <span class="font-semibold">保密性：</span> 我们理解您用户内容的敏感性。我们将按照我们的<a
                class="text-blue-600 hover:underline" href="/privacy-agreement"
                target="_blank">《隐私政策》</a>处理和保护您的用户内容，并采取合理的物理、技术和管理措施来保护其安全性和保密性。但是，互联网传输和电子存储并非绝对安全，我们无法保证绝对安全。</p>
            <p>3.5 <span class="font-semibold">AI 输出内容：</span> 由 LexSeek 基于您的用户内容生成的分析结果、概要、大事记、预测等内容（下称"AI
              输出内容"），在您遵守本条款的前提下，您可以为您处理相关法律事务所之目的使用。请注意，AI 输出内容的准确性、完整性和可靠性受限于输入数据和算法模型，您需要自行判断和负责任地使用。我们保留对 AI
              输出内容的底层生成逻辑、模型和方法的知识产权。</p>
          </div>
        </section>

        <!-- 4. 可接受的使用行为 -->
        <section id="section-4" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">4. 可接受的使用行为</h2>
          <div class="pl-4 space-y-3">
            <p>4.1 您同意仅为合法目的并按照本条款使用 LexSeek 服务。</p>
            <p>4.2 您不得进行以下活动：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>尝试规避、禁用或干扰 LexSeek 的安全特性；</li>
              <li>对本服务进行反向工程、反编译、反汇编或试图发现源代码或底层算法；</li>
              <li>使用任何自动化手段（如机器人、爬虫）访问、监控或复制本服务的任何部分，除非获得我们明确书面许可；</li>
              <li>上传或传播任何病毒、木马或其他恶意代码；</li>
              <li>从事任何可能对本服务的服务器、网络或基础设施造成不合理负担或干扰其正常运行的行为；</li>
              <li>冒充他人或实体，或虚假陈述您与某人或实体的关系；</li>
              <li>将 LexSeek 服务或其输出用于任何非法目的，或违反任何适用的法律法规或执业规范；</li>
              <li>未经授权，将 LexSeek 生成的内容用于公开出版、学术研究或其他非直接处理相关案件的目的；</li>
              <li>规避任何使用限制或访问控制。</li>
            </ul>
          </div>
        </section>

        <!-- 5. 知识产权 -->
        <section id="section-5" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">5. 知识产权</h2>
          <div class="pl-4 space-y-3">
            <p>5.1 LexSeek 平台本身，包括但不限于其网站设计、文字、图形、用户界面、视觉界面、照片、商标、徽标、声音、音乐、美术作品、计算机代码、AI
              模型、算法以及所有相关软件和技术（不包括用户内容），其所有权利、所有权和利益（包括所有知识产权）均归 上海盛熙律泓教育科技有限公司或其许可方所有。</p>
            <p>5.2 本条款未授予您除明确许可之外的任何关于 LexSeek 平台或其内容的权利。您不得复制、修改、传播、销售、出租或以其他方式利用 LexSeek 的任何部分，除非获得我们明确书面许可。</p>
          </div>
        </section>

        <!-- 6. 费用与支付 -->
        <section id="section-6" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">6. 费用与支付</h2>
          <div class="pl-4 space-y-3">
            <p>6.1 LexSeek 可能提供免费试用、专业版、旗舰版或其他付费订阅服务。具体的服务内容和费用标准将在网站相关页面公示。</p>
            <p>6.2 如果您选择付费服务，您同意按照公示的价格和支付条款支付相应费用。</p>
            <p>6.3 我们保留调整费用标准的权利，并将提前在网站进行通知。</p>
          </div>
        </section>

        <!-- 7. 免责声明 -->
        <section id="section-7" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">7. 免责声明</h2>
          <div class="pl-4 space-y-3">
            <p>7.1
              <strong>本服务按"现状"和"现有"基础提供。在法律允许的最大范围内，我们明确排除所有明示或默示的保证，包括但不限于对适销性、特定用途适用性、非侵权性、准确性、完整性、可靠性或及时性的保证。</strong>
            </p>
            <p>7.2 我们不保证：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>LexSeek 服务将满足您的所有特定要求；</li>
              <li>服务将不间断、及时、安全或无错误；</li>
              <li>通过服务获得的任何信息（包括 AI 输出内容）将是准确、完整或可靠的；</li>
              <li>任何服务中的错误都将得到纠正。</li>
            </ul>
            <p>7.3 <strong>LexSeek 不是法律顾问，不提供法律意见。</strong> AI 输出内容仅为辅助信息，不能替代您的专业判断和尽职调查。您对使用本服务及其输出结果的所有决定和行为负全部责任。因依赖
              LexSeek 生成的内容而导致的任何损失或损害，我们不承担任何责任。</p>
            <p>7.4 对于因不可抗力、第三方服务故障、网络问题、黑客攻击、病毒入侵等非我们可控因素导致的服务中断或数据丢失，我们不承担责任。</p>
          </div>
        </section>

        <!-- 8. 责任限制 -->
        <section id="section-8" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">8. 责任限制</h2>
          <div class="pl-4 space-y-3">
            <p>8.1
              <strong>在法律允许的最大范围内，对于因您使用或无法使用本服务而引起的任何间接性、偶然性、特殊性、后果性或惩罚性损害（包括但不限于利润损失、数据丢失、商誉损失、业务中断），无论基于何种法律理论（保证、合同、侵权或其他），也无论我们是否已被告知该等损害的可能性，我们均不承担任何责任。</strong>
            </p>
            <p>8.2 <strong>在任何情况下，我们就本条款或您使用本服务所承担的累计赔偿责任总额，不超过在导致索赔的事件发生前十二（12）个月内您就该服务向我们支付的总金额（如有）。</strong></p>
            <p>8.3 某些司法管辖区不允许排除某些保证或限制或排除某些类型的损害赔偿责任。因此，上述某些限制可能不适用于您。</p>
          </div>
        </section>

        <!-- 9. 赔偿 -->
        <section id="section-9" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">9. 赔偿</h2>
          <div class="pl-4 space-y-3">
            <p>您同意，对于因以下原因引起的任何及所有索赔、责任、损害、损失、成本和费用（包括合理的律师费），您将向我们、我们的关联公司、管理人员、董事、员工和代理人进行赔偿，为其辩护并使其免受损害：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>您对本服务的访问或使用；</li>
              <li>您违反本条款的任何规定；</li>
              <li>您侵犯任何第三方权利，包括但不限于任何知识产权、隐私权或保密义务；</li>
              <li>您提交的用户内容；</li>
              <li>您违反任何适用的法律法规或律师执业规范。</li>
            </ul>
          </div>
        </section>

        <!-- 10. 条款的修改 -->
        <section id="section-10" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">10. 条款的修改</h2>
          <div class="pl-4">
            <p>
              我们保留随时自行决定修改本条款的权利。如果我们对本条款进行重大修改，我们将通过在网站上发布通知或向您注册时提供的电子邮件地址发送邮件等方式通知您。修改后的条款将在发布或通知中指定的日期生效。您在修改生效后继续使用本服务，即表示您接受修改后的条款。如果您不同意修改，您应停止使用本服务。
            </p>
          </div>
        </section>

        <!-- 11. 终止 -->
        <section id="section-11" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">11. 终止</h2>
          <div class="pl-4 space-y-3">
            <p>11.1 您可以随时停止使用本服务并注销您的账户。</p>
            <p>11.2 如果我们认为您违反了本条款的任何规定，或您的行为对我们或其他用户造成风险或可能的法律责任，或根据法律要求，我们有权自行决定，在通知或不通知的情况下，立即暂停或终止您对本服务的访问权和您的账户。</p>
            <p>11.3
              终止后，您访问和使用本服务的权利将立即终止。我们通常会允许您在一段合理时间内导出您的用户内容（具体时长由我们决定），但我们没有义务无限期保留您的用户内容，并可能在终止后根据我们的数据保留政策删除这些内容。</p>
            <p>11.4 本条款中依其性质应在终止后继续有效的条款（包括但不限于知识产权、免责声明、责任限制、赔偿、法律适用和争议解决）应继续有效。</p>
          </div>
        </section>

        <!-- 12. 法律适用与争议解决 -->
        <section id="section-12" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">12. 法律适用与争议解决</h2>
          <div class="pl-4 space-y-3">
            <p>12.1 本条款的订立、效力、解释、履行和争议解决均适用中华人民共和国大陆地区法律，<strong>不考虑其冲突法规则。</strong></p>
            <p><strong>12.2 因本条款引起的或与本条款有关的任何争议、纠纷或索赔，双方应首先尝试通过友好协商解决。</strong></p>
            <p>12.3 <strong>如果协商不成，任何一方均有权将争议提交至乙方</strong>所在地有管辖权的人民法院诉讼解决。</p>
          </div>
        </section>

        <!-- 13. 其他条款 -->
        <section id="section-13" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">13. 其他条款</h2>
          <div class="pl-4 space-y-3">
            <p>13.1 <span class="font-semibold">完整协议：</span> 本条款及引用的《隐私政策》构成您与我们之间关于本服务的完整协议，取代先前或同期的任何口头或书面沟通、陈述或协议。
            </p>
            <p>13.2 <span class="font-semibold">可分割性：</span>
              如果本条款的任何规定被具有管辖权的法院或仲裁机构认定为无效或不可执行，该规定应在最大允许范围内予以执行，其余规定应继续保持完全效力。</p>
            <p>13.3 <span class="font-semibold">弃权：</span> 我们未能行使或执行本条款项下的任何权利或规定，不构成对该权利或规定的放弃。</p>
            <p>13.4 <span class="font-semibold">转让：</span> 未经我们事先书面同意，您不得转让本条款项下的任何权利或义务。我们有权转让我们在本条款项下的任何或所有权利和义务。</p>
            <p>13.5 <span class="font-semibold">通知：</span> 我们向您发送的通知可以通过电子邮件、网站公告或常规信件等方式进行。</p>
            <p>13.6 <span class="font-semibold">标题：</span> 本条款中的章节标题仅为方便阅读而设，不具有法律或合同效力。</p>
          </div>
        </section>

        <!-- 14. 联系我们 -->
        <section id="section-14" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">14. 联系我们</h2>
          <div class="pl-4">
            <p>如果您对本条款有任何疑问，请通过以下方式联系我们：</p>
            <p class="mt-2">电子邮件：<a href="mailto:lexseek@lvhong-lawyer.com"
                class="text-blue-600 hover:underline">lexseek@lvhong-lawyer.com</a></p>
          </div>
        </section>
      </div>

      <!-- 页脚 -->
      <!-- <div class="mt-10 pt-6 border-t border-gray-200 text-center text-sm text-gray-500">
        <p>© 2025 上海盛熙律泓教育科技有限公司. 版权所有</p>
      </div> -->
    </div>

    <!-- 返回顶部按钮 -->
    <button @click="scrollToTop"
      class="fixed bottom-20 right-8 bg-primary hover:bg-primary-700 text-white rounded-full p-3 shadow-lg transition-all duration-300 z-50"
      :class="{ 'opacity-0 invisible': !showBackToTop, 'opacity-100 visible': showBackToTop }">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    </button>
  </div>
</template>

<script setup>
definePageMeta({
  layout: "base-layout",
  title: "使用条款",
});

// 章节标题数组，用于生成目录
const sections = ["1. 服务描述", "2. 用户账户", "3. 用户内容与数据", "4. 可接受的使用行为", "5. 知识产权", "6. 费用与支付", "7. 免责声明", "8. 责任限制", "9. 赔偿", "10. 条款的修改", "11. 终止", "12. 法律适用与争议解决", "13. 其他条款", "14. 联系我们"];

// 控制返回顶部按钮的显示
const showBackToTop = ref(false);

// 监听滚动事件
const handleScroll = () => {
  showBackToTop.value = window.scrollY > 300;
};

// 返回顶部函数
const scrollToTop = () => {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
};

// 组件挂载时添加滚动监听
onMounted(() => {
  window.addEventListener("scroll", handleScroll);
});

// 组件卸载时移除滚动监听
onUnmounted(() => {
  window.removeEventListener("scroll", handleScroll);
});
</script>

<style scoped>
/* 平滑滚动 */
html {
  scroll-behavior: smooth;
}

/* 按钮过渡效果 */
button {
  transition:
    opacity 0.3s,
    visibility 0.3s;
}

/* 锚点跳转时的偏移，避免标题被固定导航遮挡 */
.scroll-mt-16 {
  scroll-margin-top: 4rem;
}
</style>

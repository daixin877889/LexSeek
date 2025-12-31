<template>
  <div class="container mx-auto py-8 px-4 sm:px-6 md:max-w-4xl">
    <div class="space-y-6">
      <!-- 标题部分 -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold mb-2">LexSeek（法索 AI ）服务购买协议</h1>
        <div class="text-sm text-gray-500">
          <p>生效日期：2025年6月19日</p>
          <p>最后更新日期：2025年6月18日</p>
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
        <p class="mb-4">欢迎您使用 LexSeek（中文名：法索 AI ，"本平台"）提供的会员服务及相关产品。本《LexSeek（法索 AI ）
          服务购买协议》（"本协议"）是您（"用户"或"您"）与上海盛熙律泓教育科技有限公司（"我们"或"LexSeek"）之间关于您购买、使用本平台会员服务、积分及相关功能的法律协议。</p>
        <p>
          <strong>请您在购买或使用本平台任何付费服务前，仔细阅读并充分理解本协议的全部内容，特别是免除或者限制责任的条款、法律适用和争议解决条款。除非您已阅读并接受本协议所有条款，否则您无权购买或使用本平台的相关服务。您的购买、支付、使用行为即视为您已阅读并同意本协议的约束。</strong>
        </p>
      </div>

      <!-- 条款内容 -->
      <div class="space-y-8">
        <!-- 1. 定义 -->
        <section id="section-1" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">1. 定义</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">1.1 LexSeek平台/本平台/法索 AI ：</span>
              指由上海盛熙律泓科技有限公司开发并运营的，旨在为法律专业人士提供AI驱动的法律案件分析工具及相关服务的网站（英文名：LexSeek，中文名：法索 AI ，域名为
              www.lexseek.cn）及可能推出的其他形式的服务载体。在本协议中，"LexSeek"、"法索 AI "、"本平台"可互换使用，均指代同一服务。</div>
            <div><span class="font-semibold">1.2 会员服务：</span> 指本平台根据不同的会员等级（如免费版、基础版、专业版、旗舰版）向用户提供的特定功能权限和存储空间等权益。</div>
            <div><span class="font-semibold">1.3 积分：</span> 指用户在本平台用于消耗特定功能使用次数的虚拟凭证。积分可通过购买会员赠送、单独购买或参与平台活动等方式获得。</div>
            <div><span class="font-semibold">1.4 办案工具：</span>
              指本平台提供的，独立于核心案件分析功能之外的，旨在辅助用户日常法律工作的计算器、查询工具等。其中部分工具可能对所有注册用户永久免费开放。</div>
            <div><span class="font-semibold">1.5 用户信息：</span>
              指您在注册、使用本平台服务过程中主动提供或因使用服务而产生的信息，包括但不限于您的注册信息、上传的案件材料、生成的分析结果等。</div>
          </div>
        </section>

        <!-- 2. 服务内容与会员体系 -->
        <section id="section-2" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">2. 服务内容与会员体系</h2>
          <div class="pl-4 space-y-3">
            <h3 class="font-semibold">2.1 会员等级及权益：</h3>
            <div class="pl-4 space-y-3">
              <div><span class="font-semibold">2.1.1</span>
                本平台提供多种会员等级，包括但不限于免费版、基础版、专业版、旗舰版。不同会员等级享有不同的功能权限、服务时长、存储空间和初始赠送积分数量。</div>
              <div><span class="font-semibold">2.1.2</span>
                各会员等级的具体权益（包括但不限于可使用的功能模块、服务时长、存储空间、赠送积分数量等）以及对应的售价，以您购买时本平台相关会员购买页面或产品详情页实际展示并经您确认的会员方案为准。请您在购买前仔细阅读并确认。
              </div>
              <div><span class="font-semibold">2.1.3 办案工具：</span>
                本平台提供的部分办案工具（如利息计算工具、诉讼费用计算工具等）可能对所有注册用户永久免费开放使用，不消耗积分。具体哪些办案工具免费以及免费政策的调整，以平台当时有效的公告或相关页面说明为准。</div>
            </div>

            <h3 class="font-semibold mt-4">2.2 积分机制：</h3>
            <div class="pl-4 space-y-3">
              <div><span class="font-semibold">2.2.1 积分的性质：</span>
                积分是您在本平台使用特定功能（主要是"案件分析"模块中的各项功能）时所需消耗的虚拟凭证。会员级别控制您能使用的功能，积分控制您各项功能的用量。</div>
              <div>
                <span class="font-semibold">2.2.2 积分获取：</span>
                <ul class="list-disc pl-6 mt-2 space-y-2">
                  <li><strong>购买积分：</strong> 包括购买会员时按会员等级赠送的积分，以及用户单独付费购买的积分。</li>
                  <li><strong>赠送积分：</strong> 包括但不限于新用户注册赠送（例如：新用户注册赠送3天会员及300积分）、推荐新用户注册赠送、参与平台后续举办的各类活动赠送等。</li>
                </ul>
              </div>
              <div><span class="font-semibold">2.2.3 积分定价：</span>
                单独购买积分时，其具体价格（例如1元人民币对应的积分数量）以您购买时本平台相关积分购买页面或产品详情页实际展示并经您确认的价格为准。</div>
              <div>
                <span class="font-semibold">2.2.4 积分消耗：</span>
                <ul class="list-disc pl-6 mt-2 space-y-2">
                  <li>户在使用本平台的特定功能时需要消耗相应积分。<strong>各项功能具体消耗的积分数量以本平台相关功能页面、购买详情页或当时有效的消耗标准为准。</strong></li>
                  <li><strong>消耗规则：</strong> 积分的消耗规则为优先消耗最先到期的积分。</li>
                  <li>积分的最小计量与使用单位为1（一）分，不可分割或以小数形式使用。</li>
                  <li>在进行任何形式的积分兑换、消费抵扣或参与积分折扣活动时，若根据计算规则产生的需扣减积分值为非整数（即包含小数部分），则实际执行扣减时，将按向上取整的原则处理，扣减取整后的整数积分。</li>
                </ul>
              </div>
              <div>
                <span class="font-semibold">2.2.5 积分有效期：</span>
                <ul class="list-disc pl-6 mt-2 space-y-2">
                  <li>通过购买会员赠送的积分，其有效期与该会员服务的有效期一致。</li>
                  <li>单独购买的积分，其有效期自购买之日起计算1年。</li>
                  <li>通过活动赠送的积分，其有效期以活动规则说明为准。</li>
                  <li>积分到期后将自动清零，不可恢复。</li>
                </ul>
              </div>
              <div><span class="font-semibold">2.2.6 积分退费：</span>
                由于LexSeek付费服务及权益为虚拟消费商品，除因法定情形、本协议约定情形或因LexSeek服务及功能存在重大瑕疵导致您无法正常使用所购服务、权益等公司违约情形外，您在完成相应购买和支付行为后，原则上不可进行转让或要求退费，请您在购买相应付费服务之前，仔细核对服务及权益信息、价格、使用期限及本协议相关使用规则，并注意仔细核实您购买服务的用户账号信息。
              </div>
            </div>
          </div>
        </section>

        <!-- 3. 服务费用与支付 -->
        <section id="section-3" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">3. 服务费用与支付</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">3.1</span>
              您理解并同意，本平台提供的部分会员服务及积分是收费服务。具体收费标准以本平台公布的价格政策为准。我们保留根据业务发展需要调整价格政策的权利，任何价格调整将在本平台进行公示，并自公示之日起生效。对于您在价格调整前已购买的服务，其价格不受后续调整的影响。
            </div>
            <div><span class="font-semibold">3.2</span> 您应通过本平台指定的支付方式支付相关费用。支付完成后，相应的会员权益和/或积分将开通或计入您的账户。</div>
            <div><span class="font-semibold">3.3</span> 除本协议另有约定或法律法规另有规定外，您已支付的费用不予退还。</div>
          </div>
        </section>

        <!-- 4. 用户的权利与义务 -->
        <section id="section-4" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">4. 用户的权利与义务</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">4.1</span> 您有权根据您购买的会员等级和拥有的积分数量，在本协议及平台规则允许的范围内使用本平台提供的各项服务。</div>
            <div><span class="font-semibold">4.2</span> 您应自行负责妥善保管您的账户信息（包括用户名、密码等），并对您账户下的所有活动承担责任。</div>
            <div>
              <span class="font-semibold">4.3</span>
              您在使用本平台服务时，应遵守中国法律法规、本协议及本平台发布的相关规则，不得利用本平台从事任何违法违规或侵犯第三方合法权益的行为，包括但不限于：
              <ul class="list-disc pl-6 mt-2 space-y-2">
                <li><span class="font-semibold">4.3.1</span> 上传、存储、分析任何包含反动、色情、暴力、恐怖、诽谤、侵犯隐私、侵犯知识产权等违法违规内容的信息；</li>
                <li><span class="font-semibold">4.3.2</span> 危害计算机网络安全，或试图破解、攻击本平台系统；</li>
                <li><span class="font-semibold">4.3.3</span> 将您的会员账户或积分转让、出借、出租或以其他方式提供给第三方使用（经我们书面同意的除外）；</li>
                <li><span class="font-semibold">4.3.4</span> 从事任何可能对本平台服务的正常运行造成不利影响的行为。</li>
              </ul>
            </div>
            <div><span class="font-semibold">4.4</span>
              您应对您上传至本平台的案件材料及其他信息的真实性、合法性、准确性、完整性负责，并确保拥有处理这些信息的合法权利。因您上传或处理的信息内容产生的任何法律责任，由您自行承担。</div>
            <div><span class="font-semibold">4.5</span>
              您理解并同意，<strong>本平台提供的AI分析结果、办案指引、计算结果等仅供您参考，不构成任何具有约束力的法律意见、裁判结论或决策建议</strong>。您应基于自身的专业判断独立做出决策，并对您的决策行为及后果承担全部责任。本平台不对AI分析结果的绝对准确性、完整性或特定场景下的适用性作任何明示或暗示的保证。
            </div>
          </div>
        </section>

        <!-- 5. LexSeek（法索 AI ）的权利与义务 -->
        <section id="section-5" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">5. LexSeek（法索 AI ）的权利与义务</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">5.1</span>
              我们有权根据业务发展需要，不时更新、修改本平台的功能、服务内容、会员体系、积分规则等，并将通过平台公告、站内信或您提供的联系方式通知您。如您在相关变更生效后继续使用本平台服务，即视为您已接受该等变更。</div>
            <div><span class="font-semibold">5.2</span>
              我们致力于为您提供稳定、可靠的服务，但由于互联网的固有特性及不可抗力等因素，我们不对服务的持续不中断作任何保证。对于因系统维护、升级、故障、网络攻击、不可抗力等原因导致的服务中断或数据丢失，我们将尽商业上合理的努力进行恢复，并在法律允许的范围内免除责任。
            </div>
            <div><span class="font-semibold">5.3</span> 我们高度重视您的数据安全和隐私保护。我们将按照本平台的<a href="/privacy-agreement"
                target="_blank" class="text-blue-600 hover:underline">《LexSeek（法索 AI ）隐私政策》</a> 收集、使用、存储和保护您的用户信息。</div>
            <div><span class="font-semibold">5.4</span>
              如我们发现或收到他人举报您违反本协议约定或相关法律法规，我们有权独立判断并采取包括但不限于警告、限制或暂停部分或全部功能使用、扣除积分、终止会员服务、封禁账户等措施，且无需承担任何责任。因此给您造成的损失，由您自行承担。如您的行为给我们造成损失的，我们有权向您追偿。
            </div>
          </div>
        </section>

        <!-- 6. 知识产权 -->
        <section id="section-6" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">6. 知识产权</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">6.1</span>
              本平台（包括但不限于网站、软件、技术、AI模型、算法、数据库、文字、图片、音频、视频、图表、界面设计、版面框架、数据等，无论以LexSeek或法索 AI
              名义呈现）的知识产权归上海盛熙律泓科技有限公司或相关权利人所有。</div>
            <div><span class="font-semibold">6.2</span>
              您在使用本平台服务过程中上传、存储、处理的案件材料及相关信息，其知识产权仍归您或原始权利人所有。您授予我们一项非排他的、全球性的、免费的、可再许可的许可，允许我们在为您提供服务的目的范围内（包括但不限于AI分析、模型训练优化、技术支持等）使用这些信息。我们将严格遵守<a
                href="/privacy-agreement" target="_blank" class="text-blue-600 hover:underline">《LexSeek（法索 AI
                ）隐私政策》</a>的规定保护您的数据。</div>
            <div><span class="font-semibold">6.3</span>
              您通过本平台生成的案情概要、大事记、分析报告等成果，在您遵守本协议的前提下，您拥有其使用权。但未经我们书面许可，您不得将本平台提供的核心技术、算法、模型或未公开的商业信息用于任何商业目的的复制、模仿、反编译或二次开发。
            </div>
          </div>
        </section>

        <!-- 7. 责任限制与免责 -->
        <section id="section-7" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">7. 责任限制与免责</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">7.1</span> 在法律允许的最大范围内，LexSeek（法索 AI
              ）按"现状"和"现有"提供服务。我们不作任何明示或暗示的保证，包括但不限于对服务的适销性、特定用途适用性、不侵权、准确性、完整性、可靠性或及时性的保证。</div>
            <div><span class="font-semibold">7.2</span>
              您明确理解并同意，使用本平台服务的风险由您自行承担。在任何情况下，我们对因您使用或无法使用本平台服务而导致的任何直接、间接、偶然、特殊、后果性或惩罚性损害（包括但不限于利润损失、数据丢失、商誉损失、业务中断等），均不承担责任，即使我们已被告知该等损害发生的可能性。
            </div>
            <div><span class="font-semibold">7.3</span>
              我们在本协议项下的全部责任，无论因何原因或何种行为方式引起，均不超过您在索赔事由发生前十二（12）个月内就引起索赔的具体服务向我们支付的费用总额（如有）。</div>
          </div>
        </section>

        <!-- 8. 协议的变更与终止 -->
        <section id="section-8" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">8. 协议的变更与终止</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">8.1</span>
              我们有权根据需要不时修订本协议，修订后的协议条款将在本平台公布。您应定期查阅本协议的最新版本。如您在协议修订生效后继续使用本平台服务，即表示您已接受修订后的协议。</div>
            <div>
              <span class="font-semibold">8.2</span> 发生下列任一情形时，我们有权立即终止向您提供服务，无需事先通知，且不承担任何责任：
              <ul class="list-disc pl-6 mt-2 space-y-2">
                <li><span class="font-semibold">8.2.1</span> 您严重违反本协议的任何约定；</li>
                <li><span class="font-semibold">8.2.2</span> 您利用本平台从事违法犯罪活动；</li>
                <li><span class="font-semibold">8.2.3</span> 根据法律法规或主管部门的要求；</li>
                <li><span class="font-semibold">8.2.4</span> 其他我们认为需要终止服务的情形。</li>
              </ul>
            </div>
            <div><span class="font-semibold">8.3</span>
              协议终止后，您账户内的剩余会员时长和积分（除可按约定退费的部分外）将失效。我们没有义务为您保留账户中的任何信息或数据，但会根据法律法规和<a href="/privacy-agreement"
                target="_blank" class="text-blue-600 hover:underline">《LexSeek（法索 AI ）隐私政策》</a>的要求处理您的个人信息。</div>
          </div>
        </section>

        <!-- 9. 法律适用与争议解决 -->
        <section id="section-9" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">9. 法律适用与争议解决</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">9.1</span> 本协议的订立、效力、解释、履行和争议解决均适用中华人民共和国大陆地区法律。</div>
            <div><span class="font-semibold">9.2</span>
              因本协议引起的或与本协议有关的任何争议，双方应首先友好协商解决；协商不成的，任何一方均有权将争议提交至上海盛熙律泓教育科技有限公司所在地有管辖权的人民法院通过诉讼解决。</div>
          </div>
        </section>

        <!-- 10. 其他 -->
        <section id="section-10" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">10. 其他</h2>
          <div class="pl-4 space-y-3">
            <div><span class="font-semibold">10.1</span> 本协议构成双方之间就本协议项下服务达成的完整协议，取代双方此前就相同主题达成的一切口头或书面协议、谅解和陈述。</div>
            <div><span class="font-semibold">10.2</span> 如果本协议中的任何条款无论因何种原因完全或部分无效或不具有执行力，本协议的其余条款仍应有效并且有约束力。</div>
            <div><span class="font-semibold">10.3</span> 我们未行使或延迟行使本协议项下的任何权利、权力或特权，不应视为对该等权利、权力或特权的放弃。</div>
            <div><span class="font-semibold">10.4</span> 本协议中的标题仅为方便阅读而设，不影响本协议任何条款的含义或解释。</div>
            <div>
              <span class="font-semibold">10.5</span> 如您对本协议或本平台服务有任何疑问、意见或建议，请通过以下方式与我们联系：
              <a href="mailto:lexseek@lvhong-lawyer.com"
                class="text-blue-600 hover:underline">lexseek@lvhong-lawyer.com</a>
            </div>
          </div>
        </section>

        <!-- 署名 -->
        <!-- <div class="mt-8 pt-6 border-t border-gray-200 text-center">
          <p class="font-semibold">上海盛熙律泓教育科技有限公司</p>
        </div> -->
      </div>
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
  title: "服务购买协议",
});

// 章节标题数组，用于生成目录
const sections = ["1. 定义", "2. 服务内容与会员体系", "3. 服务费用与支付", "4. 用户的权利与义务", "5. LexSeek（法索 AI ）的权利与义务", "6. 知识产权", "7. 责任限制与免责", "8. 协议的变更与终止", "9. 法律适用与争议解决", "10. 其他"];

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

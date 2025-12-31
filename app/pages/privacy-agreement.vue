<template>
  <div class="container mx-auto py-8 px-4 sm:px-6">
    <div class="space-y-6">
      <!-- 标题部分 -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold mb-2">LexSeek （法索 AI ）隐私政策</h1>
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
        <p class="mb-4">LexSeek（中文名：法索 AI
          ，“本服务”），由上海盛熙律泓教育科技有限公司运营。我们深知个人信息对您的重要性，并会尽全力保护您的个人信息安全可靠。我们致力于维持您对我们的信任，恪守以下原则，保护您的个人信息：权责一致原则、目的明确原则、选择同意原则、最少够用原则、确保安全原则、主体参与原则、公开透明原则等。
        </p>
        <p class="mb-4">本《LexSeek（法索 AI ）
          隐私政策》"本政策"）旨在向您说明我们如何收集、使用、存储、共享、转让和保护您的个人信息，以及您如何管理您的个人信息权利。<strong>本政策与您使用我们的服务关系紧密，我们建议您仔细阅读并理解本政策全部内容，作出您认为适当的选择。我们努力用通俗易懂、简明扼要的文字表达，并对本政策中与您的权益存在重大关系的条款，采用粗体字进行标注，以便您重点查阅。</strong>
        </p>
        <p><strong>在使用 LexSeek 服务前，请您务必仔细阅读并透彻理解本政策，在确认充分理解并同意后使用相关产品或服务。一旦您开始使用 LexSeek 服务，即表示您已充分理解并同意本政策。</strong>
        </p>
      </div>

      <!-- 条款内容 -->
      <div class="space-y-8">
        <!-- 1. 我们如何收集和使用您的个人信息 -->
        <section id="section-1" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">1. 我们如何收集和使用您的个人信息</h2>
          <div class="pl-4 space-y-3">
            <p>个人信息是指以电子或者其他方式记录的能够单独或者与其他信息结合识别特定自然人身份或者反映特定自然人活动情况的各种信息。</p>
            <p>我们会遵循正当、合法、必要的原则，出于本政策所述的以下目的，收集和使用您在使用服务过程中主动提供或因使用服务而产生的个人信息：</p>

            <h3 class="font-semibold mt-4">1.1 您向我们提供的信息</h3>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 账户注册与登录信息：</span> 当您注册 LexSeek
                账户时，您需要提供您的姓名、手机号码或电子邮箱地址，并创建账户密码。我们收集这些信息是为了帮助您完成注册，并保障您的账户安全。如果您仅需使用浏览、搜索等基本服务，您不需要注册成为我们的用户及提供上述信息。
              </li>
              <li>
                <span class="font-semibold">(b) 用户内容（核心业务功能）：</span> 为了实现 LexSeek 的核心功能——AI
                法律案件分析，您需要输入或上传案件相关的材料，这可能包括<strong>事实描述、证据文件、时间线信息、当事人信息、诉讼请求、争议焦点等（统称"用户内容"）</strong>。这些信息是执行案件分析所必需的。
                <div class="mt-2 pl-4">
                  <p class="font-semibold">请特别注意：</p>
                  <ul class="list-disc pl-6 space-y-2">
                    <li>
                      您上传的用户内容可能包含您客户的个人信息、商业秘密或其他敏感信息。<strong>您有责任确保您有合法的权利（包括但不限于获得相关主体的充分授权同意）收集并向我们提供这些信息用于分析目的，并且您已采取了必要的措施（如匿名化、脱敏处理）以遵守相关的法律法规和职业道德规范（如律师保密义务）</strong>。
                    </li>
                    <li><strong>我们仅在为您提供案件分析服务的目的范围内处理这些用户内容。除非获得您的明确同意或根据法律法规的强制性要求，我们不会将您的特定案件的用户内容用于任何其他目的，例如用于我们通用
                        AI 模型的训练或改进（除非该等数据已被有效匿名化且无法重新识别特定个人或案件）。</strong></li>
                  </ul>
                </div>
              </li>
              <li><span class="font-semibold">(c) 支付信息：</span> 如果 LexSeek
                提供付费服务，当您购买时，我们可能会收集您的<strong>支付信息</strong>，如银行卡信息或第三方支付账户信息。这些信息通常由第三方支付机构直接处理，我们仅获取与交易相关的确认信息。</li>
              <li><span class="font-semibold">(d) 联系与客服：</span>
                当您与我们联系或使用客服功能时，您可能会提供您的<strong>联系方式（如姓名、电话、邮箱）、您与我们的沟通记录、以及为解决问题所需的其他必要信息</strong>。</li>
            </ul>

            <h3 class="font-semibold mt-4">1.2 我们在您使用服务过程中自动收集的信息</h3>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 设备与日志信息：</span>
                当您使用我们的服务时，我们会自动收集您的设备信息（如设备型号、操作系统版本、唯一设备标识符）、浏览器类型、IP
                地址、服务日志信息（如访问日期和时间、浏览或点击记录、服务故障信息）。收集这些信息是为了保障服务的正常运行、优化服务体验以及保障您的账户安全。</li>
              <li><span class="font-semibold">(b) 使用情况信息：</span> 我们会收集您使用 LexSeek
                功能的情况信息，例如您使用了哪些分析功能、操作频率等。这些信息（通常是聚合或匿名的形式）有助于我们了解用户偏好，改进产品设计和性能。</li>
            </ul>

            <h3 class="font-semibold mt-4">1.3 我们从第三方获得的信息</h3>
            <p>我们可能在您授权同意的范围内从关联公司或合作伙伴处获得您的某些信息。我们会依据与第三方的约定、以及相关法律和法规的规定，使用您的这些个人信息。</p>

            <h3 class="font-semibold mt-4">1.4 使用信息的目的总结</h3>
            <p>我们出于以下目的，使用收集到的信息：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>向您提供、维护、改进 LexSeek 服务；</li>
              <li>处理您的用户内容，生成您所请求的分析结果；</li>
              <li>身份验证、客户服务、安全防范、存档和备份，确保我们向您提供的产品和服务的安全性；</li>
              <li>向您发送服务通知、更新或与您沟通；</li>
              <li>进行数据分析，以改进我们的产品或服务（通常使用匿名化或聚合数据）；</li>
              <li>处理支付交易（如适用）；</li>
              <li>遵守法律法规的要求。</li>
            </ul>
          </div>
        </section>

        <!-- 2. 我们如何使用 Cookie 和同类技术 -->
        <section id="section-2" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">2. 我们如何使用 Cookie 和同类技术</h2>
          <div class="pl-4 space-y-3">
            <p>为确保网站正常运转、为您获得更轻松的访问体验，我们会在您的计算机或移动设备上存储名为 Cookie 的小数据文件。Cookie 通常包含标识符、站点名称以及一些号码和字符。借助于
              Cookie，网站能够存储您的偏好（如字体大小）或登录状态等数据。</p>
            <p>我们不会将 Cookie 用于本政策所述目的之外的任何用途。您可根据自己的偏好管理或删除 Cookie。您可以清除计算机上保存的所有 Cookie，大部分网络浏览器都设有阻止 Cookie
              的功能。但如果您这么做，则需要在每一次访问我们的网站时亲自更改用户设置，并且可能因为该等修改，无法正常使用部分依赖 Cookie 的功能。</p>
            <p>除 Cookie 外，我们还可能在网站上使用网站信标和像素标签等其他同类技术。</p>
          </div>
        </section>

        <!-- 3. 我们如何共享、转让、公开披露您的个人信息 -->
        <section id="section-3" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">3. 我们如何共享、转让、公开披露您的个人信息</h2>
          <div class="pl-4 space-y-3">
            <h3 class="font-semibold">3.1 共享</h3>
            <p>我们不会与您的公司（如您为代表公司使用）以外的任何公司、组织和个人共享您的个人信息，但以下情况除外：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 在获取明确同意的情况下共享：</span> 获得您的明确同意后，我们会与其他方共享您的个人信息。</li>
              <li><span class="font-semibold">(b) 在法定情形下的共享：</span> 我们可能会根据法律法规规定、诉讼争议解决需要，或按行政、司法机关依法提出的要求，对外共享您的个人信息。
              </li>
              <li><span class="font-semibold">(c) 与授权合作伙伴共享：</span>
                仅为实现本政策中声明的目的，我们的某些服务将由授权合作伙伴提供。我们可能会与合作伙伴共享您的某些个人信息，以提供更好的客户服务和用户体验。例如，我们聘请服务提供商来提供技术支持（如云存储服务）、支付服务等。我们仅会出于合法、正当、必要、特定、明确的目的共享您的个人信息，并且只会共享提供服务所必要的信息。我们的合作伙伴无权将共享的个人信息用于任何其他用途。对我们与之共享个人信息的公司、组织和个人，我们会与其签署严格的保密协定，要求他们按照我们的说明、本政策以及其他任何相关的保密和安全措施来处理个人信息。
              </li>
              <li><span class="font-semibold">(d) 保护我们或他人的权利：</span> 为了保护我们、我们的用户或公众的权利、财产或安全免遭损害而有必要共享时。</li>
            </ul>
            <p class="font-semibold mt-4">
              特别强调：对于您上传的高度敏感的用户内容（案件材料），除非获得您的明确授权、为履行法律义务所必需，或为提供您所请求的服务所绝对必要（例如，提供给处理核心分析任务的、有严格保密义务的技术服务提供商），否则我们不会与任何第三方共享其原始内容。
            </p>

            <h3 class="font-semibold mt-4">3.2 转让</h3>
            <p>我们不会将您的个人信息转让给任何公司、组织和个人，但以下情况除外：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 在获取明确同意的情况下转让：</span> 获得您的明确同意后，我们会向其他方转让您的个人信息。</li>
              <li><span class="font-semibold">(b) 在涉及合并、收购或破产清算时：</span>
                如果发生合并、收购或破产清算，涉及到个人信息转让，我们会要求新的持有您个人信息的公司、组织继续受此隐私政策的约束，否则我们将要求该公司、组织重新向您征求授权同意。</li>
            </ul>

            <h3 class="font-semibold mt-4">3.3 公开披露</h3>
            <p>我们仅会在以下情况下，公开披露您的个人信息：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>
                <span class="font-semibold">(a) 获得您明确同意后。</span>
              </li>
              <li><span class="font-semibold">(b) 基于法律的披露：</span> 在法律、法律程序、诉讼或政府主管部门强制性要求的情况下，我们可能会公开披露您的个人信息。</li>
            </ul>
          </div>
        </section>

        <!-- 4. 我们如何存储和保护您的个人信息 -->
        <section id="section-4" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">4. 我们如何存储和保护您的个人信息</h2>
          <div class="pl-4 space-y-3">
            <h3 class="font-semibold">4.1 存储</h3>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 存储地点：</span>
                原则上，我们在中华人民共和国境内收集和产生的个人信息，将存储在中华人民共和国境内。如未来需要将信息传输至境外，我们会遵守相关法律法规的要求，并确保护您的个人信息得到在境内足够同等的保护。</li>
              <li><span class="font-semibold">(b) 存储期限：</span>
                我们只会在达成本政策所述目的所需的最短期限内保留您的个人信息，除非法律有强制的留存要求。例如，《中华人民共和国网络安全法》要求相关的网络日志留存不少于六个月。在您的个人信息超出保留期限后，我们会根据适用法律的要求删除您的个人信息，或对其进行匿名化处理。当您注销账户后，我们将停止为您提供产品或服务，并依据您的要求，删除您的个人信息，法律法规另有规定的除外。
              </li>
            </ul>

            <h3 class="font-semibold mt-4">4.2 保护</h3>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 安全措施：</span>
                我们已使用符合业界标准的安全防护措施保护您提供的个人信息，防止数据遭到未经授权访问、公开披露、使用、修改、损坏或丢失。我们会采取一切合理可行的措施，保护您的个人信息。例如，我们会使用加密技术（如
                SSL）确保数据传输的保密性；我们会使用受信赖的保护机制防止数据遭到恶意攻击；我们会部署访问控制机制，确保只有授权人员才可访问个人信息；以及我们会举办安全和隐私保护培训课程，加强员工对于保护个人信息重要性的认识。
              </li>
              <li><span class="font-semibold">(b) 安全事件处置：</span>
                互联网环境并非百分之百安全，我们将尽力确保或担保您发送给我们的任何信息的安全性。在不幸发生个人信息安全事件后，我们将按照法律法规的要求，及时向您告知：安全事件的基本情况和可能的影响、我们已采取或将要采取的处置措施、您可自主防范和降低风险的建议、对您的补救措施等。我们将及时将事件相关情况以邮件、信函、电话、推送通知等方式告知您，难以逐一告知个人信息主体时，我们会采取合理、有效的方式发布公告。同时，我们还将按照监管部门要求，主动上报个人信息安全事件的处置情况。
              </li>
            </ul>
          </div>
        </section>

        <!-- 5. 您的权利 -->
        <section id="section-5" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">5. 您的权利</h2>
          <div class="pl-4 space-y-3">
            <p>按照中国相关的法律、法规、标准，以及其他国家、地区的通行做法，我们保障您对自己的个人信息行使以下权利：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li><span class="font-semibold">(a) 访问您的个人信息：</span>
                您有权访问您的个人信息，法律法规规定的例外情况除外。如果您想行使数据访问权，可以通过账户设置或联系我们进行操作。</li>
              <li><span class="font-semibold">(b) 更正您的个人信息：</span>
                当您发现我们处理的关于您的个人信息有错误时，您有权要求我们做出更正。您可以通过账户设置或联系我们提出更正申请。</li>
              <li>
                <span class="font-semibold">(c) 删除您的个人信息：</span> 在以下情形中，您可以向我们提出删除个人信息的请求：
                <ul class="list-disc pl-6 mt-2 space-y-2">
                  <li>如果我们处理个人信息的行为违反法律法规；</li>
                  <li>如果我们收集、使用您的个人信息，却未征得您的同意；</li>
                  <li>如果我们处理个人信息的行为违反了与您的约定；</li>
                  <li>如果您不再使用我们的产品或服务，或您注销了账号；</li>
                  <li>如果我们不再为您提供产品或服务。</li>
                </ul>
                <p class="mt-2">
                  若我们决定响应您的删除请求，我们还将同时通知从我们获得您的个人信息的实体，要求其及时删除，除非法律法规另有规定，或这些实体获得您的独立授权。当您从我们的服务中删除信息后，我们可能不会立即在备份系统中删除相应的信息，但会在备份更新时删除这些信息。
                </p>
              </li>
              <li><span class="font-semibold">(d) 改变您授权同意的范围：</span>
                每个业务功能需要一些基本的个人信息才能得以完成。对于额外收集的个人信息的收集和使用，您可以随时给予或收回您的授权同意。您可以通过账户设置或联系我们进行操作。当您收回同意后，我们将不再处理相应的个人信息。但您收回同意的决定，不会影响此前基于您的授权而开展的个人信息处理。
              </li>
              <li><span class="font-semibold">(e) 注销账户：</span>
                您随时可注销此前注册的账户。您可以通过账户设置中的指引或联系我们来完成注销。在注销账户之后，我们将停止为您提供产品或服务，并依据您的要求，删除您的个人信息，法律法规另有规定的除外。</li>
              <li><span class="font-semibold">(f) 获取个人信息副本：</span> 您有权获取您的个人信息副本，可以通过联系我们进行操作。</li>
              <li><span class="font-semibold">(g) 响应您的上述请求：</span>
                为保障安全，您可能需要提供书面请求，或以其他方式证明您的身份。我们可能会先要求您验证自己的身份，然后再处理您的请求。我们将在十五（15）个工作日内做出答复。对于您合理的请求，我们原则上不收取费用，但对多次重复、超出合理限度的请求，我们将视情收取一定成本费用。对于那些无端重复、需要过多技术手段（例如，需要开发新系统或从根本上改变现行惯例）、给他人合法权益带来风险或者非常不切实际的请求，我们可能会予以拒绝。
              </li>
            </ul>
          </div>
        </section>

        <!-- 6. 我们如何处理未成年人的个人信息 -->
        <section id="section-6" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">6. 我们如何处理未成年人的个人信息</h2>
          <div class="pl-4 space-y-3">
            <p>我们的产品、网站和服务主要面向成人（特别是法律专业人士）。<strong>如果没有父母或监护人的同意，未成年人（特别是未满 14 周岁的儿童）不得创建自己的用户账户。</strong></p>
            <p>对于经父母同意而收集儿童个人信息的情况，我们只会在受到法律允许、父母或监护人明确同意或者保护儿童所必要的情况下使用或公开披露此信息。</p>
            <p>如果我们发现自己在未事先获得可证实的父母同意的情况下收集了儿童的个人信息，则会设法尽快删除相关数据。</p>
          </div>
        </section>

        <!-- 7. 本政策如何更新 -->
        <section id="section-7" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">7. 本政策如何更新</h2>
          <div class="pl-4 space-y-3">
            <p>我们的隐私政策可能变更。未经您明确同意，我们不会削减您按照本隐私政策所应享有的权利。我们会在本页面上发布对本政策所做的任何变更。</p>
            <p>对于重大变更，我们还会提供更为显著的通知（例如，通过网站公示、弹窗提示或向您发送电子邮件）。</p>
            <p>本政策所指的重大变更包括但不限于：</p>
            <ul class="list-disc pl-8 space-y-2">
              <li>我们的服务模式发生重大变化。如处理个人信息的目的、处理的个人信息类型、个人信息的使用方式等；</li>
              <li>我们在所有权结构、组织架构等方面发生重大变化。如业务调整、破产并购等引起的所有者变更等；</li>
              <li>个人信息共享、转让或公开披露的主要对象发生变化；</li>
              <li>您参与个人信息处理方面的权利及其行使方式发生重大变化；</li>
              <li>我们负责处理个人信息安全的责任部门、联络方式及投诉渠道发生变化时；</li>
              <li>个人信息安全影响评估报告表明存在高风险时。</li>
            </ul>
            <p>我们还会将本政策的旧版本存档，供您查阅。</p>
          </div>
        </section>

        <!-- 8. 如何联系我们 -->
        <section id="section-8" class="space-y-3 scroll-mt-16">
          <h2 class="text-xl font-semibold pb-2 border-b border-gray-200">8. 如何联系我们</h2>
          <div class="pl-4">
            <p>如果您对本隐私政策有任何疑问、意见或建议，或想行使您的个人信息权利，请通过以下方式与我们联系：</p>
            <p class="mt-2">电子邮件：<a href="mailto:lexseek@lvhong-lawyer.com"
                class="text-blue-600 hover:underline">lexseek@lvhong-lawyer.com</a></p>
            <p class="mt-2">一般情况下，我们将在十五（15）个工作日内回复您的请求。</p>
            <p class="mt-2">如果您对我们的回复不满意，特别是我们的个人信息处理行为损害了您的合法权益，您还可以向网信、电信、公安及工商等监管部门进行投诉或举报，或向乙方所在地有管辖权的人民法院诉讼解决。</p>
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
  title: "隐私政策",
});

// 章节标题数组，用于生成目录
const sections = ["1. 我们如何收集和使用您的个人信息", "2. 我们如何使用 Cookie 和同类技术", "3. 我们如何共享、转让、公开披露您的个人信息", "4. 我们如何存储和保护您的个人信息", "5. 您的权利", "6. 我们如何处理未成年人的个人信息", "7. 本政策如何更新", "8. 如何联系我们"];

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

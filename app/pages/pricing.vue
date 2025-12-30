<template>
  <div>
    <!-- 页面标题 -->
    <section class="bg-primary/5 py-12 md:py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center">
          <h1 class="text-4xl font-bold mb-4">价格方案</h1>
          <p class="text-xl text-muted-foreground max-w-3xl mx-auto">灵活的定价方案，满足不同规模团队的需求</p>
        </div>
      </div>
    </section>

    <!-- 定价表格 -->
    <section class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="grid md:grid-cols-4 gap-8">
          <!-- 新手旗舰套餐 -->
          <div class="bg-card rounded-lg border-2 border-amber-600 overflow-hidden relative hover:shadow-md transition-shadow flex flex-col">
            <div class="absolute top-0 right-0">
              <div class="bg-amber-600 text-white px-3 py-1 text-sm font-medium">新手专享</div>
            </div>
            <div class="p-6 flex-1 flex flex-col">
              <div class="mb-4">
                <h3 class="text-3xl font-bold mt-2">新手旗舰套餐</h3>
                <p class="text-3xl font-bold mt-2">
                  ¥9.9
                  <span class="text-base font-normal text-muted-foreground">/月</span>
                  <span class="text-sm font-bold mt-2 ml-2">赠送 300 积分</span>
                </p>
              </div>
              <p class="text-muted-foreground mb-6">旗舰版会员，限购 1 次</p>
              <ul class="space-y-3 mb-8 flex-1">
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>5GB云盘存储空间</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>专业版所有功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>录音智能转写</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>全部案件可视化工具 <span class="text-sm text-muted-foreground">(即将上线)</span></span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span
                    >起诉状答辩状撰写
                    <!-- <span class="text-sm text-muted-foreground">(即将上线)</span> -->
                  </span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>案件复盘 <span class="text-sm text-muted-foreground">(即将上线)</span></span>
                </li>

                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>后续更新的的所有功能 <span class="text-sm text-muted-foreground"></span></span>
                </li>

                <li class="flex items-start gap-2">
                  <user-round-check class="h-5 w-5 text-[#eb782c] mt-0.5 shrink-0" />
                  <span>专属客服服务 <span class="text-sm text-muted-foreground"></span></span>
                </li>
              </ul>
              <button @click="buy(10)" class="w-full py-2 bg-amber-600 text-white font-medium rounded-md hover:bg-amber-700 transition-colors">立即抢购</button>
            </div>
            <div class="p-4 bg-amber-50 border-t mt-auto">
              <p class="text-sm text-center text-amber-700">每人限购一次</p>
            </div>
          </div>

          <!-- 基础方案 -->
          <div class="bg-card rounded-lg border overflow-hidden hover:shadow-md transition-shadow relative flex flex-col">
            <!-- <div class="absolute top-0 right-0">
              <div class="bg-muted-foreground text-primary-foreground px-3 py-1 text-sm font-medium">
                限时免费
              </div>
            </div> -->
            <div class="p-6 flex-1 flex flex-col">
              <div class="mb-4">
                <h3 class="text-3xl font-bold mt-2">基础版</h3>
                <!-- <h3 class="text-lg font-medium text-muted-foreground">基础版</h3> -->
                <p class="text-3xl font-bold mt-2">
                  ¥365
                  <span class="text-base font-normal text-muted-foreground"> <span class="line-through">780</span>/年</span>
                  <span class="text-sm font-bold mt-2 ml-2">赠送 3650 积分</span>
                </p>
              </div>
              <p class="text-muted-foreground mb-6">适合做简单的案件分析</p>
              <ul class="space-y-3 mb-8 flex-1">
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>100MB云盘存储空间</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>案情概要整理</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>案件大事记整理</span>
                </li>

                <li class="flex items-start gap-2">
                  <x-icon class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <span class="text-muted-foreground">案由确认功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <x-icon class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <span class="text-muted-foreground">请求权分析功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <x-icon class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <span class="text-muted-foreground">对方抗辩预测功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <x-icon class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <span class="text-muted-foreground">证据清单建议</span>
                </li>
                <li class="flex items-start gap-2">
                  <x-icon class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <span class="text-muted-foreground">案件可视化工具</span>
                </li>
              </ul>
              <!-- <button @click="wxSupportStore.showQrCode" class="w-full py-2 border border-primary text-primary font-medium rounded-md hover:bg-primary/5 transition-colors">
                联系客服申请免费试用资格
              </button> -->
              <!-- <button @click="wxSupportStore.showQrCode()" disabled class="w-full py-2 border border-primary text-primary font-medium rounded-md hover:bg-primary/5 transition-colors">
                内测期间暂不开放购买
              </button> -->
              <button @click="buy(1)" class="w-full py-2 border border-primary text-primary font-medium rounded-md hover:bg-primary/5 transition-colors">订阅基础版会员</button>
            </div>
            <div class="p-4 bg-muted/20 border-t mt-auto">
              <p class="text-sm text-center text-muted-foreground">功能存在部份限制</p>
            </div>
          </div>

          <!-- 专业方案 (推荐) -->
          <div class="bg-card rounded-lg border-2 border-primary overflow-hidden relative hover:shadow-md transition-shadow flex flex-col">
            <div class="absolute top-0 right-0">
              <div class="bg-primary text-primary-foreground px-3 py-1 text-sm font-medium">推荐方案</div>
            </div>
            <div class="p-6 flex-1 flex flex-col">
              <div class="mb-4">
                <h3 class="text-3xl font-bold mt-2">专业版</h3>
                <!-- <h3 class="text-lg font-medium text-muted-foreground">专业版</h3> -->
                <p class="text-3xl font-bold mt-2">
                  ¥680
                  <span class="text-base font-normal text-muted-foreground"> <span class="line-through">1280</span>/年</span>
                  <span class="text-sm font-bold mt-2 ml-2">赠送 6800 积分</span>
                </p>
              </div>
              <p class="text-muted-foreground mb-6">适合做专业的案件分析</p>
              <ul class="space-y-3 mb-8 flex-1">
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>1GB云盘存储空间</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>基础版所有功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>请求权分析功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>案由确认功能</span>
                </li>

                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>对方抗辩预测功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>证据清单建议</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>部份案件可视化工具 <span class="text-sm text-muted-foreground">(即将上线)</span></span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>试用新功能的机会</span>
                </li>
              </ul>
              <button @click="buy(2)" class="w-full py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">订阅专业版会员</button>
              <!-- <button @click="wxSupportStore.showQrCode()" class="w-full py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
                内测期间联系客服免费试用
              </button> -->
            </div>
            <div class="p-4 bg-primary/5 border-t mt-auto">
              <p class="text-sm text-center text-primary">最受欢迎的选择</p>
            </div>
          </div>

          <!-- 旗舰版 -->
          <div class="bg-card rounded-lg border overflow-hidden hover:shadow-md transition-shadow flex flex-col">
            <div class="p-6 flex-1 flex flex-col">
              <div class="mb-4">
                <h3 class="text-3xl font-bold mt-2">旗舰版</h3>
                <!-- <h3 class="text-lg font-medium text-muted-foreground">旗舰版</h3> -->
                <p class="text-3xl font-bold mt-2">
                  ¥1280
                  <span class="text-base font-normal text-muted-foreground"> <span class="line-through">2480</span>/年</span>
                  <span class="text-sm font-bold mt-2 ml-2">赠送 12800 积分</span>
                </p>
              </div>
              <p class="text-muted-foreground mb-6">适合做案件深度分析及案例研究</p>
              <ul class="space-y-3 mb-8 flex-1">
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>5GB云盘存储空间</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>专业版所有功能</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>录音智能转写</span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>全部案件可视化工具 <span class="text-sm text-muted-foreground">(即将上线)</span></span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span
                    >起诉状答辩状撰写
                    <!-- <span class="text-sm text-muted-foreground">(即将上线)</span> -->
                  </span>
                </li>
                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>案件复盘 <span class="text-sm text-muted-foreground">(即将上线)</span></span>
                </li>

                <li class="flex items-start gap-2">
                  <check-icon class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <span>后续更新的的所有功能 <span class="text-sm text-muted-foreground"></span></span>
                </li>

                <li class="flex items-start gap-2">
                  <user-round-check class="h-5 w-5 text-[#eb782c] mt-0.5 shrink-0" />
                  <span>专属客服服务 <span class="text-sm text-muted-foreground"></span></span>
                </li>
              </ul>
              <button @click="buy(3)" class="w-full py-2 border border-primary text-primary font-medium rounded-md hover:bg-primary/5 transition-colors">订阅旗舰版会员</button>
              <!-- <button @click="wxSupportStore.showQrCode()" disabled class="w-full py-2 border border-primary text-primary font-medium rounded-md hover:bg-primary/5 transition-colors">
                内测期间暂不开放购买
              </button> -->
            </div>
            <div class="p-4 bg-muted/20 border-t mt-auto">
              <p class="text-sm text-center text-muted-foreground">功能无限制</p>
            </div>
          </div>
        </div>

        <!-- 年付折扣提示 -->
        <div class="mt-8 text-center">
          <p class="text-muted-foreground">注册享7天全功能免费试用，<NuxtLink to="/register" class="text-primary font-bold hover:underline">立即注册</NuxtLink>体验</p>
        </div>
      </div>
    </section>

    <!-- 功能对比 -->
    <section class="py-16 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">功能说明</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">不同的会员等级可使用不同的功能，更多功能正在陆续上线中...</p>
        </div>

        <div class="bg-card rounded-lg border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[800px] table-with-borders">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium w-28">功能分类</th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-60">功能名称</th>
                  <th class="px-4 py-3 text-center text-sm font-medium">免费版</th>
                  <th class="px-4 py-3 text-center text-sm font-medium">基础版</th>
                  <th class="px-4 py-3 text-center text-sm font-medium">专业版</th>
                  <th class="px-4 py-3 text-center text-sm font-medium">旗舰版</th>
                </tr>
              </thead>
              <tbody>
                <!-- 云盘空间 -->
                <tr class="border-b bg-muted/20">
                  <td class="px-4 py-3 text-sm font-medium" rowspan="1">文件存储</td>
                  <td class="px-4 py-3 text-sm font-medium" rowspan="1">云盘空间</td>
                  <td class="px-4 py-3 text-sm text-center">100MB</td>
                  <td class="px-4 py-3 text-sm text-center">100MB</td>
                  <td class="px-4 py-3 text-sm text-center">1GB</td>
                  <td class="px-4 py-3 text-sm text-center">5GB</td>
                </tr>

                <!-- 案件分析功能 -->
                <tr class="border-b bg-muted/20">
                  <td class="px-4 py-3 text-sm font-medium" rowspan="8">案件分析</td>
                  <td class="px-4 py-3 text-sm">提取案件标题</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">生成案情概要</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">提取案件大事记</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">预分析案件请求权</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">法律合理性审查和判决趋势预测</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">预选案由</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">抗辩分析及策略预测</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">证据清单预处理</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>

                <!-- 办案工具功能 -->
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm font-medium" rowspan="13">办案工具</td>
                  <td class="px-4 py-3 text-sm">录音智能转写</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">利息计算工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">诉讼费用计算工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">律师费用计算工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">延迟履行利息计算工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">银行利率查询工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">日期推算工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">赔偿计算器</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">加班计算工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">高婚财产分割工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">社保追偿工具</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">法律文书生成</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center text-sm text-muted-foreground">部分</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">案件可视化工具</td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center text-sm text-muted-foreground">部分</td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>

                <!-- 其他功能 -->
                <!-- <tr class="border-b bg-muted/20">
                  <td class="px-4 py-3 text-sm font-medium" rowspan="5">其他功能</td>
                  <td class="px-4 py-3 text-sm">类案研判 <span class="text-sm text-muted-foreground">(即将上线)</span></td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr> -->
                <!-- <tr class="border-b">
                  <td class="px-4 py-3 text-sm">非诉文书提取 <span class="text-sm text-muted-foreground">(即将上线)</span></td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr> -->
                <!-- <tr class="border-b">
                  <td class="px-4 py-3 text-sm">办案小结 <span class="text-sm text-muted-foreground">(即将上线)</span></td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr class="border-b">
                  <td class="px-4 py-3 text-sm">案件复盘 <span class="text-sm text-muted-foreground">(即将上线)</span></td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr> -->
                <!-- <tr class="border-b">
                  <td class="px-4 py-3 text-sm">合同审查 <span class="text-sm text-muted-foreground">(即将上线)</span></td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <x-icon class="h-4 w-4 text-red-500 mx-auto" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <check-icon class="h-4 w-4 text-green-600 mx-auto" />
                  </td>
                </tr> -->
              </tbody>
            </table>
          </div>
        </div>

        <div class="mt-8 bg-primary/5 rounded-lg p-6 border border-primary/20">
          <div class="flex flex-col md:flex-row items-start md:items-center gap-4">
            <ShieldX class="h-10 w-10 text-primary shrink-0" />
            <div>
              <h3 class="text-xl font-semibold mb-1">防滥用说明</h3>
              <p class="text-muted-foreground">LexSeek 仅提供给会员本人使用，禁止任何形式的转卖、出租、出借、赠与等行为。案件分析功能限制同一时间分析的案件数(并发数)为1个。</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 常见问题 -->
    <section class="py-16 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">常见问题</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">关于定价和使用的一些常见问题解答</p>
        </div>

        <div class="space-y-6 max-w-3xl mx-auto">
          <div class="bg-card rounded-lg p-6 border">
            <h3 class="text-lg font-semibold mb-2">有免费试用吗？</h3>
            <p class="text-muted-foreground">是的，新用户注册后可获得7天免费试用，可体验旗舰版的全部功能。</p>
          </div>

          <div class="bg-card rounded-lg p-6 border">
            <h3 class="text-lg font-semibold mb-2">可以随时更换订阅方案吗？</h3>
            <p class="text-muted-foreground">您可以随时升级您的订阅方案，但降级需要等待当前会员有效期结束后进行续订。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 行动号召 -->
    <section class="py-16 bg-primary text-primary-foreground px-4">
      <div class="max-w-[1200px] mx-auto text-center">
        <h2 class="text-3xl font-bold mb-4">开始免费试用</h2>
        <p class="text-xl mb-8 max-w-2xl mx-auto opacity-90">立即注册并获得7天免费试用</p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <NuxtLink to="/register" class="inline-flex items-center justify-center px-6 py-3 bg-white text-primary font-medium rounded-md hover:bg-white/90 transition-colors"> 免费注册 </NuxtLink>
          <a href="#" @click="wxSupportStore.showQrCode()" class="inline-flex items-center justify-center px-6 py-3 bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 font-medium rounded-md hover:bg-primary-foreground/20 transition-colors"> 联系客服 </a>
        </div>
      </div>
    </section>

    <!-- 购买流程组件（包含认证弹框和支付二维码弹框） -->
    <PurchaseFlow v-model:show-auth-modal="purchaseFlow.showAuthModal.value" :auth-modal-tab="purchaseFlow.authModalTab.value" v-model:show-q-r-code-dialog="purchaseFlow.showQRCodeDialog.value" :qr-code-url="purchaseFlow.qrCodeUrl.value" :payment-loading="purchaseFlow.paymentLoading.value" :payment-paid="purchaseFlow.paymentPaid.value" @auth-success="purchaseFlow.handleAuthSuccess" @auth-cancel="purchaseFlow.handleAuthCancel" @close-q-r-code="purchaseFlow.closeQRCodeDialog" />
  </div>
</template>

<script setup>
definePageMeta({
  layout: "base-layout",
});
import { CheckIcon, XIcon, CoinsIcon, ShieldX, UserRoundCheck } from "lucide-vue-next";

// 使用微信客服 store（Nuxt 自动导入）
const wxSupportStore = useWxSupportStore();

// 购买流程 composable
const purchaseFlow = usePurchaseFlow({
  onSuccess: () => {
    // 购买成功后跳转到会员页面
    navigateTo("/dashboard/membership/level");
  },
});

/**
 * 购买会员
 * @param productId 商品 ID
 */
const buy = (productId) => {
  purchaseFlow.buy(productId);
};

onMounted(() => {
  window.scrollTo(0, 0);
});
</script>

<style scoped>
.table-with-borders td,
.table-with-borders th {
  border-right: 1px solid hsl(var(--border));
}

.table-with-borders td:last-child,
.table-with-borders th:last-child {
  border-right: none;
}
</style>

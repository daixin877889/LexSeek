# 注册页移除微信小程序注册入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `app/pages/register.vue` 注释掉微信小程序注册相关的 Tab 切换栏、小程序 TabsContent 与"请使用小程序注册"提示，并把 `activeTab` 默认值改为 `"website"`，使注册页只显示手机号短信注册表单。代码保留以便后续恢复。

**Architecture:** 单文件改动。Template 3 处用 `<!-- -->` 整块包住（每处上方加一行中文说明）；Script 1 处把 `activeTab` 默认值从 `"miniprogram"` 改为 `"website"`，否则 `<Tabs>` 找不到对应 TabsContent 会渲染空白。外层 `<Tabs>` 容器保留。

**Tech Stack:** Nuxt 4 / Vue 3 / shadcn-vue Tabs

**Spec:** `docs/superpowers/specs/2026-05-14-register-disable-wechat-design.md`

---

### Task 1: Template 三处注释

**Files:**
- Modify: `app/pages/register.vue`

- [ ] **Step 1: 注释 Tab 切换栏 `<TabsList>`（约第 28–33 行）**

将原 `<!-- Tab导航 -->` 旁注替换为新的中文说明，并把整个 `<TabsList>` 块用 HTML 注释包住。

old_string:
```
          <!-- Tab导航 -->
          <Tabs v-model="activeTab" class="w-full">
            <TabsList class="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="miniprogram">小程序注册</TabsTrigger>
              <TabsTrigger value="website">网站注册</TabsTrigger>
            </TabsList>
```

new_string:
```
          <!-- 暂时移除微信小程序注册入口，保留代码以便后续恢复 -->
          <Tabs v-model="activeTab" class="w-full">
            <!-- <TabsList class="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="miniprogram">小程序注册</TabsTrigger>
              <TabsTrigger value="website">网站注册</TabsTrigger>
            </TabsList> -->
```

- [ ] **Step 2: 注释小程序 `<TabsContent value="miniprogram">`（约第 35–50 行）**

将原 `<!-- 小程序注册Tab -->` 旁注替换为新的中文说明，并把整个 `<TabsContent>` 块用 HTML 注释包住。

old_string:
```
            <!-- 小程序注册Tab -->
            <TabsContent value="miniprogram" class="mt-6">
              <div class="text-center space-y-4">
                <h3 class="text-lg font-medium mb-4">微信扫码注册</h3>
                <div class="flex justify-center">
                  <img src="/images/lsRegister.png" alt="小程序注册码" class="w-64 h-64 rounded-lg" />
                </div>
                <p class="text-sm text-muted-foreground">使用微信扫描上方二维码，进入小程序完成注册</p>
              </div>
              <div class="mt-6 text-center">
                <p class="text-sm text-muted-foreground">
                  已完成注册?
                  <NuxtLink to="#" @click="toLogin" class="text-primary hover:underline font-medium"> 立即登录 </NuxtLink>
                </p>
              </div>
            </TabsContent>
```

new_string:
```
            <!-- 暂时移除微信小程序注册入口，保留代码以便后续恢复 -->
            <!-- <TabsContent value="miniprogram" class="mt-6">
              <div class="text-center space-y-4">
                <h3 class="text-lg font-medium mb-4">微信扫码注册</h3>
                <div class="flex justify-center">
                  <img src="/images/lsRegister.png" alt="小程序注册码" class="w-64 h-64 rounded-lg" />
                </div>
                <p class="text-sm text-muted-foreground">使用微信扫描上方二维码，进入小程序完成注册</p>
              </div>
              <div class="mt-6 text-center">
                <p class="text-sm text-muted-foreground">
                  已完成注册?
                  <NuxtLink to="#" @click="toLogin" class="text-primary hover:underline font-medium"> 立即登录 </NuxtLink>
                </p>
              </div>
            </TabsContent> -->
```

- [ ] **Step 3: 注释"请使用小程序注册"提示行（约第 92–94 行）**

old_string:
```
                  <div class="text-sm text-muted-foreground mt-2">尝试多次无法接收验证码？请使用 <a
                      class="text-primary font-semibold underline" href="#"
                      @click.prevent="activeTab = 'miniprogram'">小程序注册</a>。</div>
```

new_string:
```
                  <!-- 暂时移除"请使用小程序注册"引导文案，保留代码以便后续恢复 -->
                  <!-- <div class="text-sm text-muted-foreground mt-2">尝试多次无法接收验证码？请使用 <a
                      class="text-primary font-semibold underline" href="#"
                      @click.prevent="activeTab = 'miniprogram'">小程序注册</a>。</div> -->
```

> 注意：第 91 行原本就存在的 `<!-- 联系客服 -->` 历史注释不动。

---

### Task 2: 修改 `activeTab` 默认值

**Files:**
- Modify: `app/pages/register.vue`（约第 189–190 行）

- [ ] **Step 1: 把默认值从 `"miniprogram"` 改为 `"website"`**

old_string:
```
// Tab 相关状态
const activeTab = ref("miniprogram");
```

new_string:
```
// Tab 相关状态
// 暂时移除微信小程序注册入口，默认显示网站注册；恢复入口时改回 "miniprogram"
const activeTab = ref("website");
```

---

### Task 3: 校验与提交

**Files:** 无新增。

- [ ] **Step 1: 跑 typecheck**

Run: `bun run typecheck`
Expected: 通过，无新增类型错误。

- [ ] **Step 2: 核对改动**

Run: `git diff app/pages/register.vue`
Expected: 看到 4 处改动且与 Task 1 / Task 2 一致。

- [ ] **Step 3: 浏览器手测**

启动 `bun dev`，用 chrome-devtools MCP 打开 `http://localhost:3000/register`：
- 页面只显示"创建新账号"标题与手机号短信注册表单
- 没有 Tab 切换栏（无"小程序注册 / 网站注册"按钮）
- 短信验证码输入框下方没有"请使用小程序注册"提示

再打开 `http://localhost:3000/login`，确认未受影响。

测毕关闭 dev server。若无法启动浏览器，跳过此步并在提交说明里注明"未做浏览器手测"。

- [ ] **Step 4: 提交**

Run:
```
git add app/pages/register.vue
git commit -m "fix(ui): 注册页暂时移除微信小程序注册入口"
```

Expected: 提交成功。

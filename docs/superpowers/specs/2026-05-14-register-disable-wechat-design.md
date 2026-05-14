# 注册页移除微信小程序注册入口

## 背景

`app/pages/register.vue` 当前默认显示"小程序注册" Tab（微信二维码 + 引导文案），并提供切到"网站注册"（手机号短信注册）的入口。本次按 `lexseek_web` 项目同名页面的做法，关闭小程序入口，注册页仅保留手机号短信注册流程。

**约束**：只注释，不删除代码，便于后续恢复。

## 范围

仅修改一个文件：`app/pages/register.vue`。

- 不动后端、Pinia store、composable
- 不动图片资源 `/images/lsRegister.png`
- 登录页 `app/pages/login.vue` 经核对无相应入口，不动

## 改动清单

### Template 注释（3 处）

每处在原代码上方加一行简短中文说明，再用 `<!-- ... -->` 将原代码整块包住。

1. **Tab 切换栏 `<TabsList>`**（当前约第 30–33 行）：包含"小程序注册 / 网站注册"两个 `TabsTrigger`。
2. **小程序 Tab 内容 `<TabsContent value="miniprogram">`**（当前约第 36–50 行）：微信扫码图 + 引导文案 + 「已完成注册? 立即登录」链接。
3. **短信验证码下方"请使用小程序注册"提示行**（当前约第 92–94 行）。

外层容器 `<Tabs v-model="activeTab" class="w-full">` 保留不动。

### Script 值变更（1 处）

`const activeTab = ref("miniprogram")` 改为 `ref("website")`，旁加单行中文注释说明旧值与恢复方式。

> 原因：TabsList 与 miniprogram TabsContent 都被注释后，如果默认 Tab 仍指向 `"miniprogram"`，`<Tabs>` 会渲染空白，必须切到 `"website"`。这是唯一一处"值改"而非"注释"。

## 不改动的边界

- `<ClientOnly><AuthAliyunCaptchaHost scene="registerSms" /></ClientOnly>`（阿里云验证码托管，与微信无关）
- `useAuthStore` / `useSmsCooldown` / `useAliyunCaptcha`
- 第 91 行原本就存在的 `<!-- 联系客服 -->` 历史注释
- `app/pages/login.vue`

## 验证

- `bun run typecheck` 通过（确保 template 注释无语法问题）
- 浏览器打开 `/register`：仅显示网站注册表单，不出现 Tab 切换栏，不出现"请使用小程序注册"提示
- 浏览器打开 `/login`：未受影响

## 风险

HTML 注释不能嵌套。已核对三处待新增注释区块内部均无既有 `<!-- -->`，安全。

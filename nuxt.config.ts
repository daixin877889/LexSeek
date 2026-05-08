// https://nuxt.com/docs/api/configuration/nuxt-config
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import { obfuscatorConfig } from './config/obfuscator'

// 仅在启用混淆时才同步 require 此插件，避免普通构建被 javascript-obfuscator (~60MB) 静态拉进来占座
const enableObfuscator = process.env.ENABLE_OBFUSCATOR === 'true'
const rollupObfuscator: ((opts: unknown) => unknown) | null = enableObfuscator
  ? createRequire(import.meta.url)('rollup-plugin-obfuscator').default
  : null

export default defineNuxtConfig({
  // 忽略 worktree 目录：避免 Nuxt 扫描/监视导致 EMFILE
  ignore: ['.worktrees/**', '**/.worktrees/**'],
  watchers: {
    chokidar: {
      ignored: [
        '**/.worktrees/**',
        '**/node_modules/**',
        '**/.git/**',
        '**/.nuxt/**',
        '**/.output/**',
        '**/coverage/**',
        '**/logs/**',
      ],
    },
  },
  // 组件配置：仅自动注册 ai-elements/ 下的 .vue 组件，业务组件全部显式 import
  // shadcn-nuxt 模块独立通过 addComponent API 注册 ui/，不受 components.dirs 影响
  // extensions 限定为 vue 后，目录内的 index.ts/context.ts/utils.ts/types.ts 等辅助文件不会被当作组件扫描
  components: {
    dirs: [
      {
        path: '~/components/ai-elements',
        pathPrefix: false,
        extensions: ['vue'],
      },
    ],
  },
  app: {
    head: {
      htmlAttrs: {
        // 服务端默认渲染 light 主题，客户端脚本会立即修正
        class: ''
      },
      // 内联样式：在任何 CSS 加载前隐藏页面，防止主题闪烁
      style: [
        {
          innerHTML: 'html:not(.theme-ready){background:#fff}html.dark:not(.theme-ready){background:#171717}',
          tagPosition: 'head'
        }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/logo.svg' }
      ],
      // 内联脚本：在页面渲染前应用颜色模式，避免闪烁
      script: [
        {
          innerHTML: `(function(){try{var s=localStorage.getItem('color-mode');var m=s&&['light','dark','system'].includes(s)?s:'light';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);var t=localStorage.getItem('theme-color');if(t&&t!=='zinc')document.documentElement.classList.add('theme-'+t);document.documentElement.classList.add('theme-ready')}catch(e){document.documentElement.classList.add('theme-ready')}})()`,
          tagPosition: 'head'
        }
      ]
    }
  },
  css: ['~/assets/css/tailwind.css'],
  alias: {
    // ai-elements 组件使用 @repo/shadcn-vue 路径，映射到本地目录
    // 在 Nuxt 层面声明，使 Vite 构建与 TypeScript 类型检查保持一致
    '@repo/shadcn-vue/lib': resolve(__dirname, 'app/lib'),
    '@repo/shadcn-vue/components/ui': resolve(__dirname, 'app/components/ui'),
  },
  vite: {
    resolve: {
      alias: {
        // ai-elements 组件使用 @repo/shadcn-vue 路径，映射到本地目录
        '@repo/shadcn-vue/lib': resolve(__dirname, 'app/lib'),
        '@repo/shadcn-vue/components/ui': resolve(__dirname, 'app/components/ui'),
      },
    },
    plugins: [
      tailwindcss() as any,
    ],
    worker: {
      format: 'es', // 使用 ES 模块格式
    },
    optimizeDeps: {
      // 确保 age-encryption 在 Worker 中可用
      include: ['age-encryption'],
    },
    server: {
      allowedHosts: true
    },
    build: {
      // 关闭 chunk gzip size 计算 — 在 9968 modules 规模下是 vite 构建末尾的内存峰值，
      // 云效流水线 16G 实例都会被 cgroup OOM Killer 杀掉（exit code 137）
      reportCompressedSize: false,
    },
  },
  shadcn: {
    /**
     * Prefix for all the imported component.
     * @default "Ui"
     */
    prefix: '',
    /**
     * Directory that the component lives in.
     * Will respect the Nuxt aliases.
     * @link https://nuxt.com/docs/api/nuxt-config#alias
     * @default "@/components/ui"
     */
    componentDir: '@/components/ui'
  },
  modules: [
    '@nuxt/image',
    '@nuxt/scripts',
    'shadcn-nuxt',
    '@pinia/nuxt',
  ],
  imports: {
    // 关闭自定义代码扫描（composables / utils / store / shared/utils / shared/types）
    // Vue / Nuxt 内置 magic（ref / computed / useRoute / useFetch / defineEventHandler 等）仍保留
    scan: false,
    dirs: [],
    imports: [
      // 高频共享工具白名单，保留自动导入避免 import 冗余
      { name: 'logger', from: '#shared/utils/logger' },
      { name: 'resSuccess', from: '#shared/utils/apiResponse' },
      { name: 'resError', from: '#shared/utils/apiResponse' },
    ]
  },
  future: {
    compatibilityVersion: 4, // 确保开启 Nuxt 4 模式
  },
  // 关闭客户端 source map（生产环境无需调试信息）
  sourcemap: {
    server: false,
    client: false,
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  nitro: {
    imports: {
      // 保留 nitro 默认 magic：H3 函数 / server/utils/* / nitropack 内部
      // 只关闭 server/services/*/* 自动扫描（项目自定义业务代码必须显式 import）
      dirs: [],
      imports: [
        // 白名单：高频共享工具保留自动可用
        { name: 'logger', from: '#shared/utils/logger' },
        { name: 'resSuccess', from: '#shared/utils/apiResponse' },
        { name: 'resError', from: '#shared/utils/apiResponse' },
      ]
    },
    // 关闭服务端 source map（生产环境无需调试信息，省 ~7MB）
    sourceMap: false,
    // 关闭服务端代码 minify：服务端产物不下发浏览器，terser 阶段是云效构建 OOM 主因之一
    minify: false,
    // 解决 dayjs/zod ESM 模块解析问题，确保打包进 .output
    externals: {
      inline: ['dayjs', 'zod']
    },
    // 生产构建代码混淆（rollup 插件）
    // 通过环境变量 ENABLE_OBFUSCATOR=true 显式开启，默认关闭
    rollupConfig: {
      plugins: (enableObfuscator && rollupObfuscator ? [
        rollupObfuscator({
          global: true,
          options: {
            ...obfuscatorConfig,
          },
        }),
      ] : []) as any[],
    },
  },
  runtimeConfig: {
    public: {
      // 日志级别配置（客户端和服务端共用）
      // 可选值: DEBUG, INFO, WARN, ERROR, SILENT
      // 通过环境变量 NUXT_PUBLIC_LOG_LEVEL 覆盖
      logLevel: 'DEBUG',
      // 应用基础 URL（用于支付回调等）
      baseUrl: '',
      // 微信公众号 AppID（前端 OAuth 授权 + 后端支付共用）
      wechatAppId: '',
      // 微信授权回调地址（通用回调，支持多环境）
      wechatAuthCallbackUrl: '',
    },
    // 微信公众号配置（服务端私密配置）
    wechat: {
      // 公众号 AppSecret（用于 OAuth 获取 OpenID）
      mpSecret: '',
      // 授权回调重定向白名单（逗号分隔）
      authRedirectWhitelist: '',
    },
    // Langfuse 可观测性配置（自托管）
    langfuse: {
      publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
      secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
      baseUrl: process.env.LANGFUSE_BASE_URL ?? '',
      tracingEnabled: process.env.LANGFUSE_TRACING_ENABLED !== 'false',
      maskPII: process.env.LANGFUSE_MASK_PII !== 'false',
      environment: (process.env.LANGFUSE_ENVIRONMENT
        ?? process.env.NODE_ENV
        ?? 'development') as 'development' | 'staging' | 'production',
      gitSha: process.env.GIT_SHA ?? '',
      // serverless（FC3/Lambda）必须配 'immediate'，否则容器被回收前 batched 队列里 span 不 flush 全丢
      exportMode: (process.env.LANGFUSE_EXPORT_MODE === 'immediate'
        ? 'immediate'
        : 'batched') as 'immediate' | 'batched',
    },
    aliyun: {
      accessKeyId: '',
      accessKeySecret: '',
      captcha: {
        enable: false,
        region: 'cn',
        prefix: '',
        dualStack: false,
        scriptSrc: 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js',
        sceneIds: {
          loginSms: '',
          registerSms: '',
          resetPasswordSms: '',
          passwordLogin: '',
        },
        loginRisk: {
          enable: false,
          threshold: 3,
          windowSec: 900,
        },
      },
      sms: {
        enable: false, // 是否启用短信发送
        signName: '', // 短信签名
        templateCaptchaCode: '', // 短信验证码模板ID，用于发送验证码
        rateLimitMs: 60, // 短信发送频率限制，单位：秒，默认60秒内只能发送一次
        codeExpireMs: 300, // 短信验证码有效期，单位：秒，默认5分钟
        maxFailures: 5, // 验证码最大失败次数，超过后锁定
        lockDurationMs: 900, // 验证码锁定时间，单位：秒，默认15分钟
      },
      oss: {
        callbackUrl: '',
        main: {
          bucket: '',
          basePath: ''
        }
      }
    },
    jwt: {
      secret: 'lexseek_jwt_secret', // jwt 的 secret
      expiresIn: '30d', // 过期时间
    },
    auth: {
      cookieName: 'auth_token', // 认证 Cookie 名称
      cookieMaxAge: 2592000, // Cookie 过期时间，单位：秒，默认30天
    },
    // 微信支付配置（注意：AppID 使用 public.wechatAppId，避免重复配置）
    wechatPay: {
      mchId: '',           // 微信支付商户号
      apiV3Key: '',        // API v3 密钥
      serialNo: '',        // 商户证书序列号
      privateKey: '',      // 商户私钥
      platformCert: '',    // 微信支付平台证书（可选，用于验证回调签名）
      notifyUrl: '',       // 支付回调通知地址（完整 URL，如 https://example.com/api/v1/payments/callback/wechat）
    },
    // 嵌入模型配置（环境变量保底）
    embedding: {
      apiKey: '',           // NUXT_EMBEDDING_API_KEY
      baseUrl: '',          // NUXT_EMBEDDING_BASE_URL
      model: 'text-embedding-v4',  // NUXT_EMBEDDING_MODEL
      dimensions: 1536,     // NUXT_EMBEDDING_DIMENSIONS
      batchSize: 5,         // NUXT_EMBEDDING_BATCH_SIZE
    },
    // Agent 后台任务队列配置
    // 环境变量映射: NUXT_AGENT_MAX_CONCURRENT, NUXT_AGENT_MAX_USER_CONCURRENT, ...
    agent: {
      maxConcurrent: 3, // 最大并发数
      maxUserConcurrent: 2, // 单用户最大并发数
      timeoutMs: 3600000,          // 1小时
      heartbeatIntervalMs: 15000, // 心跳间隔时间，单位：毫秒
      crashThresholdMs: 60000, // 崩溃阈值时间，单位：毫秒
      databaseUrl: '',             // Agent 专用数据库连接，默认回退到 DATABASE_URL
      pendingQueueMax: 500000, // 最大队列长度
      pendingQueueTtlMs: 10 * 60 * 1000, // 队列超时时间，单位：毫秒
    },
    // Redis 配置
    // 环境变量映射: NUXT_REDIS_URL
    redis: {
      url: '',
    },
    // 存储适配器配置
    storage: {
      // 默认存储类型: aliyun_oss, qiniu, tencent_cos
      defaultType: 'aliyun_oss',
      // OSS 回调 URL（所有存储服务商共用）
      callbackUrl: '',
      // 文件存储基础路径
      basePath: '',
      // 阿里云 OSS 配置
      aliyunOss: {
        accessKeyId: '',
        accessKeySecret: '',
        bucket: '',
        region: '',
        customDomain: '',
        // STS 配置（可选）
        sts: {
          roleArn: '',
          roleSessionName: 'lexseek-oss-session',
          durationSeconds: 3600
        }
      },
      // 七牛云配置（预留）
      qiniu: {
        accessKey: '',
        secretKey: '',
        bucket: '',
        zone: '' // z0, z1, z2, na0, as0
      },
      // 腾讯云 COS 配置（预留）
      tencentCos: {
        secretId: '',
        secretKey: '',
        bucket: '',
        region: '',
        appId: ''
      }
    }
  }
})

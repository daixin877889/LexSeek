// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/logo.svg' }
      ]
    }
  },
  css: ['~/assets/css/tailwind.css'],
  vite: {
    plugins: [
      tailwindcss() as any,
    ],
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
    // 自动导入 store 目录下的所有 store
    dirs: ['store'],
    imports: [
      // 导入 logger 便捷函数和默认实例
      // 使用 #shared 别名指向项目根目录的 shared 文件夹
      // { name: 'logger', from: '#shared/utils/logger' },

    ]
  },
  future: {
    compatibilityVersion: 4, // 确保开启 Nuxt 4 模式
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  nitro: {
    imports: {
      dirs: [
        './server/lib/**',
        './server/services/**/**',
      ],
      imports: [
        // 服务端 logger 自动导入
        // { name: 'logger', from: '#shared/utils/logger' },
      ]
    }
  },
  runtimeConfig: {
    public: {
      // 日志级别配置（客户端和服务端共用）
      // 可选值: DEBUG, INFO, WARN, ERROR, SILENT
      // 通过环境变量 NUXT_PUBLIC_LOG_LEVEL 覆盖
      logLevel: 'DEBUG',
    },
    aliyun: {
      accessKeyId: '',
      accessKeySecret: '',
      sms: {
        enable: false, // 是否启用短信发送
        signName: '', // 短信签名
        templateCaptchaCode: '', // 短信验证码模板ID，用于发送验证码
        rateLimitMs: 60, // 短信发送频率限制，单位：秒，默认60秒内只能发送一次
        codeExpireMs: 300, // 短信验证码有效期，单位：秒，默认5分钟
        maxFailures: 5, // 验证码最大失败次数，超过后锁定
        lockDurationMs: 900, // 验证码锁定时间，单位：秒，默认15分钟
      }
    },
    jwt: {
      secret: 'lexseek_jwt_secret', // jwt 的 secret
      expiresIn: '30d', // 过期时间
    },
    auth: {
      cookieName: 'auth_token', // 认证 Cookie 名称
      cookieMaxAge: 2592000, // Cookie 过期时间，单位：秒，默认30天
    }
  }
})
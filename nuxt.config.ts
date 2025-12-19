// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }
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
  modules: ['@nuxt/image', '@nuxt/scripts', 'shadcn-nuxt'],
  future: {
    compatibilityVersion: 4, // 确保开启 Nuxt 4 模式
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  nitro: {
    imports: {
      dirs: [
        './server/lib/**',
      ]
    }
  },
  runtimeConfig: {
    aliyun: {
      accessKeyId: '',
      accessKeySecret: '',
      sms: {
        enable: false,
        signName: '',
        templateCode: '',

      }
    }
  }
})
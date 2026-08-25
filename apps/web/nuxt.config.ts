import type { NuxtOptions } from 'nuxt/schema'

type TypeScriptCompilerOptions = NonNullable<
  NuxtOptions['typescript']['tsConfig']['compilerOptions']
>

const compilerOptions = {
  noFallthroughCasesInSwitch: true,
  noImplicitReturns: true,
  noUnusedLocals: true,
  noUnusedParameters: true
} satisfies TypeScriptCompilerOptions

const TURNSTILE_SITE_KEY = '0x4AAAAAAEb6dlP7oJ9xo7cf'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-08',

  devServer: {
    host: '127.0.0.1',
    port: 3001
  },

  css: [
    '~/assets/styles/reset.css'
  ],

  experimental: {
    /**
     * Nuxt disables Nitro auto-imports for compatibility version 5, but
     * Nitro's Cloudflare development plugin still imports its runtime helpers
     * from #imports. Keep this enabled until that upstream dependency is removed.
     *
     * https://github.com/nuxt/nuxt/issues/34142
     */
    nitroAutoImports: true
  },

  future: {
    compatibilityVersion: 5
  },

  imports: {
    autoImport: false
  },

  runtimeConfig: {
    public: {
      turnstileSiteKey: TURNSTILE_SITE_KEY
    }
  },

  typescript: {
    tsConfig: {
      files: [
        '../worker-configuration.d.ts'
      ],

      compilerOptions
    },

    sharedTsConfig: {
      compilerOptions
    },

    nodeTsConfig: {
      compilerOptions
    }
  },

  nitro: {
    preset: 'cloudflare_module',

    cloudflare: {
      deployConfig: false
    },

    typescript: {
      tsConfig: {
        files: [
          '../worker-configuration.d.ts'
        ],

        compilerOptions
      }
    }
  },

  app: {
    head: {
      htmlAttrs: {
        lang: 'en'
      },

      title: 'TV'
    }
  }
})

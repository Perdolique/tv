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

const TURNSTILE_PRODUCTION_SITE_KEY = '0x4AAAAAAEb6dlP7oJ9xo7cf'
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'

export default defineNuxtConfig({
  $development: {
    runtimeConfig: {
      public: {
        turnstileSiteKey: TURNSTILE_TEST_SITE_KEY
      }
    }
  },

  compatibilityDate: '2026-08-08',

  devServer: {
    host: '127.0.0.1',
    port: 3001
  },

  css: [
    '~/assets/styles/app.css'
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

  icon: {
    clientBundle: {
      icons: [
        'hugeicons:view',
        'hugeicons:view-off-slash'
      ],

      scan: false
    },

    provider: 'none'
  },

  imports: {
    autoImport: false
  },

  modules: [
    '@nuxt/icon'
  ],

  runtimeConfig: {
    public: {
      turnstileSiteKey: TURNSTILE_PRODUCTION_SITE_KEY
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

      meta: [{
        content: 'light dark',
        name: 'color-scheme'
      }],

      title: 'TV'
    }
  }
})

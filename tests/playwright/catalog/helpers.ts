import type { Page } from '@playwright/test'

interface NuxtHydrationState {
  isHydrating: boolean;
}
interface VueGlobalProperties {
  $nuxt: NuxtHydrationState;
}
interface VueApplicationConfig {
  globalProperties: VueGlobalProperties;
}
interface VueApplication {
  config: VueApplicationConfig;
}
interface VueRootElement extends HTMLElement {
  __vue_app__?: VueApplication;
}

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = globalThis.document.querySelector<VueRootElement>('#__nuxt')

    // oxlint-disable-next-line eslint/no-underscore-dangle -- Wait for Nuxt's hydration boundary before interacting with server-rendered controls.
    return root?.__vue_app__?.config.globalProperties.$nuxt.isHydrating === false
  })
}

export { waitForHydration }

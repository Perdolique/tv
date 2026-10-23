import type { Page } from '@playwright/test'

interface NuxtHydrationState {
  isHydrating: boolean;
}
interface VueRouter {
  push: (target: string) => Promise<unknown>;
}
interface VueGlobalProperties {
  $nuxt: NuxtHydrationState;
  $router: VueRouter;
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

async function navigateWithClientRouter(page: Page, target: string): Promise<void> {
  await page.evaluate(async (path) => {
    const root = globalThis.document.querySelector<VueRootElement>('#__nuxt')

    // oxlint-disable-next-line eslint/no-underscore-dangle -- Vue exposes the application instance on the root element for browser tooling.
    const router = root?.__vue_app__?.config.globalProperties.$router

    if (router === undefined) {
      throw new Error('Nuxt client router is unavailable')
    }

    await router.push(path)
  }, target)
}

async function openEpisodes(page: Page): Promise<void> {
  await waitForHydration(page)

  await page.getByRole('tab', {
    name: 'Episodes',
    exact: true
  }).click()
}

export { navigateWithClientRouter, openEpisodes, waitForHydration }

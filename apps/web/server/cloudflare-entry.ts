import cloudflareModule from 'nitropack/presets/cloudflare/runtime/cloudflare-module'
import { proxyAuthRequestAtEdge } from './utils/proxy-auth.ts'

const nitroFetch = cloudflareModule.fetch

if (nitroFetch === undefined) {
  throw new Error('Nitro Cloudflare fetch handler is unavailable')
}

type CloudflareModuleFetch = typeof nitroFetch
type CloudflareModuleResponse = Awaited<ReturnType<CloudflareModuleFetch>>

const fetch: CloudflareModuleFetch = async (request, env, context) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The generated project environment augments Nitro's narrower Cloudflare environment with service bindings.
  const bindings = env as typeof env & CloudflareBindings

  const authResponse = await proxyAuthRequestAtEdge(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Nitro and the project declare the same runtime Request through separate Cloudflare type packages.
    request as unknown as Request,
    bindings.API
  )

  if (authResponse !== undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Nitro and the project declare the same runtime Response through separate Cloudflare type packages.
    return authResponse as unknown as CloudflareModuleResponse
  }

  return nitroFetch(request, env, context)
}

const worker = {
  ...cloudflareModule,
  fetch
}

// oxlint-disable-next-line import/no-default-export -- Cloudflare Workers require a default entrypoint.
export default worker

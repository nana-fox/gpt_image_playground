import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { resolveEmbeddedApiProfile } from './embeddedSession'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const sourceProfile = getActiveApiProfile(opts.settings)
  const profile = resolveEmbeddedApiProfile(sourceProfile)
  const settings = profile === sourceProfile
    ? opts.settings
    : {
        ...opts.settings,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        timeout: profile.timeout,
        apiMode: profile.apiMode,
        codexCli: profile.codexCli,
        apiProxy: profile.apiProxy,
        profiles: opts.settings.profiles.map((item) => item.id === profile.id ? profile : item),
        activeProfileId: profile.id,
      }
  const request = settings === opts.settings ? opts : { ...opts, settings }
  if (profile.provider === 'fal') return callFalAiImageApi(request, profile)

  return callOpenAICompatibleImageApi(request, profile, getCustomProviderDefinition(settings, profile.provider))
}

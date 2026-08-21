import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { getEmbeddedContext, isEmbeddedSessionActive, resolveEmbeddedApiProfile } from './embeddedSession'
import { assertEmbeddedImageEndpoint, assertEmbeddedImageRequest } from './embeddedPolicy'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const sourceProfile = getActiveApiProfile(opts.settings)
  const embedded = isEmbeddedSessionActive()
  assertEmbeddedImageRequest(sourceProfile, opts.params, embedded)
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
  const endpoint = request.inputImageDataUrls.length > 0 ? 'images/edits' : 'images/generations'
  const context = getEmbeddedContext()
  if (context) assertEmbeddedImageEndpoint(`${profile.baseUrl}/${endpoint}`, context.origin, embedded)
  if (profile.provider === 'fal') {
    if (import.meta.env.VITE_DEPLOYMENT_FLAVOR === 'nanafox-embedded') throw new Error('嵌入模式仅支持 OpenAI Images')
    const { callFalAiImageApi } = await import('./falAiImageApi')
    return callFalAiImageApi(request, profile)
  }

  return callOpenAICompatibleImageApi(request, profile, getCustomProviderDefinition(settings, profile.provider))
}

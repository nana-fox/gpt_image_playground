import type { ApiProfile, TaskParams } from '../types'
import { isNanafoxEmbedded } from './deploymentFlavor'

export function assertEmbeddedImageRequest(
  profile: ApiProfile,
  params: TaskParams,
  embedded = isNanafoxEmbedded(),
) {
  if (!embedded) return
  if (profile.provider !== 'openai') throw new Error('嵌入模式仅允许 OpenAI Images 服务商')
  if (profile.apiMode !== 'images') throw new Error('嵌入模式仅允许 Images API')
  if (profile.model.trim() !== 'gpt-image-2') throw new Error('嵌入模式仅允许 gpt-image-2 模型')
  if (profile.codexCli) throw new Error('嵌入模式不允许 Codex CLI 模式')
  if (profile.apiProxy) throw new Error('嵌入模式不允许 API 代理')
  if (params.n !== 1) throw new Error('嵌入模式每次仅允许生成 1 张图片')
}

export function assertEmbeddedImageEndpoint(
  value: string,
  origin: string,
  embedded = isNanafoxEmbedded(),
) {
  if (!embedded) return

  const url = new URL(value, origin)
  if (
    url.origin !== origin ||
    (url.pathname !== '/v1/images/generations' && url.pathname !== '/v1/images/edits') ||
    url.search ||
    url.hash
  ) {
    throw new Error('嵌入模式仅允许同源 Images API 端点')
  }
}

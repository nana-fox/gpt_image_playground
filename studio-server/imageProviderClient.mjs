const ALLOWED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])
const ALLOWED_QUALITIES = new Set(['low', 'medium', 'high'])
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

export class ImageProviderError extends Error {
  constructor(message, { status = 502, reason = 'IMAGE_PROVIDER_ERROR' } = {}) {
    super(message)
    this.name = 'ImageProviderError'
    this.status = status
    this.reason = reason
  }
}

export function createImageProviderClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const apiKey = String(options.apiKey ?? '')
  const model = String(options.model ?? '').trim()
  if (apiKey.length < 16) throw new Error('Studio image provider API key is invalid')
  if (!/^[A-Za-z0-9_.:/-]{1,128}$/.test(model)) throw new Error('Studio image provider model is invalid')

  const request = options.fetch ?? globalThis.fetch
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120000

  const post = async (input) => {
    let response
    try {
      response = await request(new URL('images/generations', baseUrl).toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          output_format: 'png',
          n: 1,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new ImageProviderError('图像服务暂时不可用，请稍后重试', {
        reason: error?.name === 'TimeoutError' ? 'IMAGE_PROVIDER_TIMEOUT' : 'IMAGE_PROVIDER_UNAVAILABLE',
      })
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) throw protocolError()
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw protocolError()

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw protocolError()
    }
    if (!response.ok) {
      throw new ImageProviderError(providerFailureMessage(response.status), {
        status: response.status,
        reason: 'IMAGE_PROVIDER_REJECTED',
      })
    }

    const data = payload?.data
    if (!Array.isArray(data) || data.length !== 1) throw protocolError()
    const base64 = String(data[0]?.b64_json ?? '').trim()
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw protocolError()
    const image = Buffer.from(base64, 'base64')
    if (!image.length || image.length > 50 * 1024 * 1024) throw protocolError()

    const result = {
      images: [{
        base64,
        mimeType: 'image/png',
        revisedPrompt: typeof data[0].revised_prompt === 'string' ? data[0].revised_prompt : undefined,
      }],
    }
    if (Number.isFinite(payload?.usage?.total_tokens)) {
      result.usage = { total_tokens: payload.usage.total_tokens }
    }
    return result
  }

  return {
    generate(input) {
      const prompt = String(input?.prompt ?? '').trim()
      const size = String(input?.size ?? '')
      const quality = String(input?.quality ?? '')
      if (!prompt || prompt.length > 20000) throw new Error('Studio image prompt is invalid')
      if (!ALLOWED_SIZES.has(size)) throw new Error('Studio image size is invalid')
      if (!ALLOWED_QUALITIES.has(quality)) throw new Error('Studio image quality is invalid')
      if (input?.model !== undefined) throw new Error('Studio image model cannot be selected by the browser')
      return post({ prompt, size, quality })
    },
  }
}

function normalizeBaseUrl(value) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw new Error('Studio image provider base URL is invalid')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Studio image provider base URL must use HTTPS')
  }
  if (url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname)) {
    throw new Error('Studio image provider base URL must end with /v1')
  }
  url.pathname = '/v1/'
  return url
}

function providerFailureMessage(status) {
  if (status === 429) return '图像服务当前繁忙，请稍后重试'
  if (status === 400 || status === 422) return '当前创作请求无法处理，请调整描述后重试'
  return '图像生成失败，本次不会扣除额度'
}

function protocolError() {
  return new ImageProviderError('图像服务返回了无效结果，本次不会扣除额度', {
    reason: 'IMAGE_PROVIDER_PROTOCOL_ERROR',
  })
}

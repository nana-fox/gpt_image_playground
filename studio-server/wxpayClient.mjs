import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto'
import { isIP } from 'node:net'

const API_ORIGIN = 'https://api.mch.weixin.qq.com'
const MAX_RESPONSE_BYTES = 1024 * 1024

export class WxpayError extends Error {
  constructor(message, reason = 'PAYMENT_PROVIDER_ERROR', status = 502) {
    super(message)
    this.name = 'WxpayError'
    this.reason = reason
    this.status = status
  }
}

export function createWxpayClient(options = {}) {
  const appId = required(options.appId, 'appId')
  const mchId = required(options.mchId, 'mchId')
  const serialNo = required(options.serialNo, 'serialNo')
  const platformSerialNo = required(options.platformSerialNo, 'platformSerialNo')
  const apiV3Key = Buffer.from(String(options.apiV3Key ?? ''))
  if (apiV3Key.length !== 32) throw new Error('WeChat Pay APIv3 key must be 32 bytes')
  const privateKey = createPrivateKey(options.privateKey)
  const platformPublicKey = createPublicKey(options.platformPublicKey)
  const notifyUrl = normalizeHttpsUrl(options.notifyUrl, 'notifyUrl')
  const request = options.request ?? fetch
  const clock = options.clock ?? (() => new Date())
  const nonce = options.nonce ?? (() => randomBytes(16).toString('hex'))

  const signedRequest = async (method, path, body = '') => {
    const timestamp = String(Math.floor(clock().getTime() / 1000))
    const nonceStr = nonce()
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`),
      privateKey,
    ).toString('base64')
    let response
    try {
      response = await request(`${API_ORIGIN}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body || undefined,
      })
    } catch {
      throw new WxpayError('微信支付服务暂时不可用', 'PAYMENT_PROVIDER_UNAVAILABLE')
    }
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_RESPONSE_BYTES) throw new WxpayError('微信支付响应过大', 'PAYMENT_PROVIDER_PROTOCOL_ERROR')
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new WxpayError('微信支付响应过大', 'PAYMENT_PROVIDER_PROTOCOL_ERROR')
    if (!response.ok) throw new WxpayError('微信支付请求失败', 'PAYMENT_PROVIDER_REJECTED')
    verifyMessage(text, response.headers, platformSerialNo, platformPublicKey)
    try {
      return JSON.parse(text)
    } catch {
      throw new WxpayError('微信支付响应无效', 'PAYMENT_PROVIDER_PROTOCOL_ERROR')
    }
  }

  return {
    async createNativeOrder(input) {
      const outTradeNo = normalizeOutTradeNo(input?.outTradeNo)
      const description = String(input?.description ?? '').trim()
      const amountCents = Number(input?.amountCents)
      const clientIp = String(input?.clientIp ?? '').trim()
      const expiresAt = new Date(input?.expiresAt)
      if (!description || Buffer.byteLength(description) > 127) throw validationError('支付商品描述无效')
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100000000) throw validationError('支付金额无效')
      if (!isIp(clientIp)) throw validationError('客户端地址无效')
      if (!Number.isFinite(expiresAt.getTime())) throw validationError('订单有效期无效')
      const body = JSON.stringify({
        appid: appId,
        mchid: mchId,
        description,
        out_trade_no: outTradeNo,
        notify_url: notifyUrl,
        time_expire: expiresAt.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        amount: { total: amountCents, currency: 'CNY' },
        scene_info: { payer_client_ip: clientIp },
      })
      const result = await signedRequest('POST', '/v3/pay/transactions/native', body)
      const codeUrl = String(result?.code_url ?? '').trim()
      if (!codeUrl.startsWith('weixin://')) throw new WxpayError('微信支付没有返回有效二维码', 'PAYMENT_PROVIDER_PROTOCOL_ERROR')
      return { codeUrl }
    },

    verifyNotification(rawBody, inputHeaders) {
      const headers = normalizeHeaders(inputHeaders)
      const timestamp = Number(headers['wechatpay-timestamp'])
      const nonceStr = headers['wechatpay-nonce']
      const serial = headers['wechatpay-serial']
      const signature = headers['wechatpay-signature']
      if (!Number.isInteger(timestamp) || !nonceStr || serial !== platformSerialNo || !signature) {
        throw new WxpayError('微信支付签名无效', 'PAYMENT_SIGNATURE_INVALID', 401)
      }
      if (Math.abs(Math.floor(clock().getTime() / 1000) - timestamp) > 300) {
        throw new WxpayError('微信支付通知已过期', 'PAYMENT_SIGNATURE_EXPIRED', 401)
      }
      const valid = verify(
        'RSA-SHA256',
        Buffer.from(`${timestamp}\n${nonceStr}\n${rawBody}\n`),
        platformPublicKey,
        Buffer.from(signature, 'base64'),
      )
      if (!valid) throw new WxpayError('微信支付签名无效', 'PAYMENT_SIGNATURE_INVALID', 401)

      let event
      try {
        event = JSON.parse(rawBody)
      } catch {
        throw new WxpayError('微信支付通知无效', 'PAYMENT_NOTIFICATION_INVALID', 400)
      }
      if (event?.event_type !== 'TRANSACTION.SUCCESS' || !event.id || event.resource?.algorithm !== 'AEAD_AES_256_GCM') {
        throw new WxpayError('微信支付通知无效', 'PAYMENT_NOTIFICATION_INVALID', 400)
      }
      const transaction = decryptResource(event.resource, apiV3Key)
      const total = Number(transaction?.amount?.total)
      if (
        transaction?.trade_state !== 'SUCCESS'
        || transaction.appid !== appId
        || transaction.mchid !== mchId
        || !normalizeOptionalOutTradeNo(transaction.out_trade_no)
        || !String(transaction.transaction_id ?? '').trim()
        || !Number.isInteger(total)
        || total < 1
        || transaction.amount?.currency !== 'CNY'
      ) {
        throw new WxpayError('微信支付通知与商户订单不匹配', 'PAYMENT_NOTIFICATION_MISMATCH', 401)
      }
      return {
        eventId: String(event.id),
        outTradeNo: transaction.out_trade_no,
        transactionId: String(transaction.transaction_id),
        amountCents: total,
        currency: 'CNY',
        appId,
        mchId,
      }
    },
  }
}

function verifyMessage(body, headers, platformSerialNo, platformPublicKey) {
  const timestamp = headers.get('wechatpay-timestamp')
  const nonce = headers.get('wechatpay-nonce')
  const serial = headers.get('wechatpay-serial')
  const signature = headers.get('wechatpay-signature')
  if (!timestamp || !nonce || serial !== platformSerialNo || !signature) {
    throw new WxpayError('微信支付响应缺少有效签名', 'PAYMENT_PROVIDER_SIGNATURE_INVALID')
  }
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    platformPublicKey,
    Buffer.from(signature, 'base64'),
  )
  if (!valid) throw new WxpayError('微信支付响应签名无效', 'PAYMENT_PROVIDER_SIGNATURE_INVALID')
}

function decryptResource(resource, key) {
  const nonce = String(resource?.nonce ?? '')
  const associatedData = String(resource?.associated_data ?? '')
  let encrypted
  try {
    encrypted = Buffer.from(String(resource?.ciphertext ?? ''), 'base64')
  } catch {
    throw new WxpayError('微信支付通知无法解密', 'PAYMENT_NOTIFICATION_INVALID', 400)
  }
  if (Buffer.byteLength(nonce) !== 12 || encrypted.length <= 16) {
    throw new WxpayError('微信支付通知无法解密', 'PAYMENT_NOTIFICATION_INVALID', 400)
  }
  try {
    const ciphertext = encrypted.subarray(0, -16)
    const tag = encrypted.subarray(-16)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce))
    decipher.setAAD(Buffer.from(associatedData))
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
  } catch {
    throw new WxpayError('微信支付通知无法解密', 'PAYMENT_NOTIFICATION_INVALID', 400)
  }
}

function normalizeHeaders(input) {
  if (input instanceof Headers) return Object.fromEntries([...input].map(([key, value]) => [key.toLowerCase(), value]))
  return Object.fromEntries(Object.entries(input ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]))
}

function normalizeOutTradeNo(value) {
  const normalized = normalizeOptionalOutTradeNo(value)
  if (!normalized) throw validationError('商户订单号无效')
  return normalized
}

function normalizeOptionalOutTradeNo(value) {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(normalized)) return ''
  return normalized
}

function isIp(value) {
  return isIP(value) !== 0
}

function normalizeHttpsUrl(value, name) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw new Error(`WeChat Pay ${name} is invalid`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`WeChat Pay ${name} is invalid`)
  return url.toString()
}

function required(value, name) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`WeChat Pay ${name} is required`)
  return normalized
}

function validationError(message) {
  return new WxpayError(message, 'VALIDATION_ERROR', 400)
}

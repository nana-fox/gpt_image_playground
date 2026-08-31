import { createSign, createVerify } from 'node:crypto'

export class PaymentProviderError extends Error {
  constructor(message, reason = 'PAYMENT_PROVIDER_ERROR', status = 502) {
    super(message)
    this.name = 'PaymentProviderError'
    this.reason = reason
    this.status = status
  }
}

export function createAlipayClient(options = {}) {
  const appId = required(options.appId, 'Alipay App ID')
  const privateKey = required(options.privateKey, 'Alipay private key')
  const publicKey = required(options.publicKey, 'Alipay public key')
  const notifyUrl = required(options.notifyUrl, 'Alipay notify URL')
  const returnUrl = required(options.returnUrl, 'Alipay return URL')
  const sdk = options.sdk

  return {
    async createCheckoutOrder(input) {
      const bizContent = {
        out_trade_no: required(input?.outTradeNo, 'Alipay order number'),
        product_code: 'FAST_INSTANT_TRADE_PAY',
        subject: required(input?.description, 'Alipay order description').slice(0, 256),
        total_amount: amount(Number(input?.amountCents)),
        time_expire: formatTime(input?.expiresAt),
        qr_pay_mode: '4',
        qrcode_width: 220,
      }
      const url = sdk
        ? await sdk.pageExecute('alipay.trade.page.pay', 'GET', { notifyUrl, returnUrl, bizContent })
        : pageUrl({ appId, privateKey, notifyUrl, returnUrl, bizContent })
      if (!String(url).startsWith('https://')) throw providerError('支付宝没有返回有效收银台地址')
      return { payUrl: String(url) }
    },

    verifyNotification(rawBody) {
      const values = Object.fromEntries(new URLSearchParams(String(rawBody ?? '')))
      if (!(sdk ? sdk.checkNotifySignV2(values) : verify(values, publicKey))) {
        throw new PaymentProviderError('支付宝回调签名无效', 'PAYMENT_SIGNATURE_INVALID', 401)
      }
      if (values.app_id !== appId || !['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(values.trade_status)) {
        throw new PaymentProviderError('支付宝回调状态无效', 'PAYMENT_NOTIFICATION_MISMATCH', 401)
      }
      return {
        eventId: required(values.notify_id, 'Alipay notification ID'),
        outTradeNo: required(values.out_trade_no, 'Alipay order number'),
        transactionId: required(values.trade_no, 'Alipay transaction ID'),
        amountCents: cents(values.total_amount),
        currency: 'CNY',
        appId,
        mchId: null,
      }
    },
  }
}

function pageUrl({ appId, privateKey, notifyUrl, returnUrl, bizContent }) {
  const params = {
    app_id: appId,
    biz_content: JSON.stringify(bizContent),
    charset: 'utf-8',
    format: 'JSON',
    method: 'alipay.trade.page.pay',
    notify_url: notifyUrl,
    return_url: returnUrl,
    sign_type: 'RSA2',
    timestamp: formatTime(new Date()),
    version: '1.0',
  }
  const signer = createSign('RSA-SHA256')
  signer.update(signingText(params, true), 'utf8')
  signer.end()
  const query = new URLSearchParams({ ...params, sign: signer.sign(pem(privateKey, 'PRIVATE KEY'), 'base64') })
  return `https://openapi.alipay.com/gateway.do?${query}`
}

function verify(values, publicKey) {
  const signature = String(values.sign ?? '').trim()
  if (!signature) return false
  const verifier = createVerify('RSA-SHA256')
  verifier.update(signingText(values), 'utf8')
  verifier.end()
  return verifier.verify(pem(publicKey, 'PUBLIC KEY'), signature, 'base64')
}

function signingText(values, includeSignType = false) {
  return Object.keys(values)
    .filter((key) => key !== 'sign' && (includeSignType || key !== 'sign_type') && values[key] !== '' && values[key] !== undefined)
    .sort()
    .map((key) => `${key}=${values[key]}`)
    .join('&')
}

function pem(value, label) {
  const normalized = String(value ?? '').trim()
  if (normalized.includes('-----BEGIN')) return normalized
  return `-----BEGIN ${label}-----\n${normalized.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END ${label}-----`
}

function amount(value) {
  if (!Number.isInteger(value) || value < 1) throw providerError('支付宝订单金额无效')
  return (value / 100).toFixed(2)
}

function cents(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw providerError('支付宝支付金额无效')
  return Math.round(number * 100)
}

function formatTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw providerError('支付宝订单有效期无效')
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function required(value, name) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw providerError(`${name} is required`)
  return normalized
}

function providerError(message) {
  return new PaymentProviderError(message)
}

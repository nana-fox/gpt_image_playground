import { AlipaySdk } from 'alipay-sdk'

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
  const sdk = options.sdk ?? new AlipaySdk({ appId, privateKey, alipayPublicKey: publicKey, signType: 'RSA2' })

  return {
    async createCheckoutOrder(input) {
      const url = await sdk.pageExecute('alipay.trade.page.pay', 'GET', {
        notifyUrl,
        returnUrl,
        bizContent: {
          out_trade_no: required(input?.outTradeNo, 'Alipay order number'),
          product_code: 'FAST_INSTANT_TRADE_PAY',
          subject: required(input?.description, 'Alipay order description').slice(0, 256),
          total_amount: amount(Number(input?.amountCents)),
          timeout_express: '15m',
        },
      })
      if (!String(url).startsWith('https://')) throw providerError('支付宝没有返回有效收银台地址')
      return { payUrl: String(url) }
    },

    async queryOrder(outTradeNo) {
      const result = await sdk.exec('alipay.trade.query', { bizContent: { out_trade_no: outTradeNo } })
      if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(result?.tradeStatus)) return { status: 'pending' }
      return {
        status: 'success',
        outTradeNo: result.outTradeNo,
        transactionId: result.tradeNo,
        amountCents: cents(result.totalAmount),
        currency: 'CNY',
        appId,
        mchId: null,
      }
    },

    verifyNotification(rawBody) {
      const values = Object.fromEntries(new URLSearchParams(String(rawBody ?? '')))
      if (!sdk.checkNotifySignV2(values)) {
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

function amount(value) {
  if (!Number.isInteger(value) || value < 1) throw providerError('支付宝订单金额无效')
  return (value / 100).toFixed(2)
}

function cents(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw providerError('支付宝支付金额无效')
  return Math.round(number * 100)
}

function required(value, name) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw providerError(`${name} is required`)
  return normalized
}

function providerError(message) {
  return new PaymentProviderError(message)
}

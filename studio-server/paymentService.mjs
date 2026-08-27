import { randomBytes, randomUUID } from 'node:crypto'

export class PaymentError extends Error {
  constructor(message, reason = 'PAYMENT_ERROR', status = 400) {
    super(message)
    this.name = 'PaymentError'
    this.reason = reason
    this.status = status
  }
}

export function createPaymentService(options = {}) {
  const enabled = options.enabled === true
  const store = options.store
  const provider = options.provider
  const clock = options.clock ?? (() => new Date())
  const orderId = options.orderId ?? randomUUID
  const outTradeNo = options.outTradeNo ?? (() => `studio_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`)

  return {
    listPlans() {
      return store.listPlans()
    },

    getOrder(userId, id) {
      return store.getUserOrder(userId, id)
    },

    async createOrder(userId, planId, idempotencyKey, clientIp) {
      if (!enabled || !provider) throw new PaymentError('微信支付尚未开放', 'PAYMENT_NOT_CONFIGURED', 503)
      const normalizedPlanId = String(planId ?? '').trim()
      const key = String(idempotencyKey ?? '').trim()
      if (!userId || !/^[a-z0-9_-]{1,64}$/i.test(normalizedPlanId) || !key || key.length > 200) {
        throw new PaymentError('支付请求参数无效', 'VALIDATION_ERROR')
      }
      const expiresAt = new Date(clock().getTime() + 15 * 60 * 1000).toISOString()
      const result = await store.createOrder({
        id: orderId(),
        userId,
        planId: normalizedPlanId,
        idempotencyKey: key,
        outTradeNo: outTradeNo(),
        expiresAt,
      })
      if (!result.created) return result.order
      try {
        const payment = await provider.createNativeOrder({
          outTradeNo: result.order.outTradeNo,
          description: `NanaFox Studio ${result.order.plan.name}`,
          amountCents: result.order.amountCents,
          expiresAt: result.order.expiresAt,
          clientIp,
        })
        return store.attachCodeUrl(result.order.id, payment.codeUrl)
      } catch (error) {
        await store.failOrder(result.order.id, error?.reason ?? 'PAYMENT_PROVIDER_ERROR')
        throw error
      }
    },

    async handleWebhook(rawBody, headers) {
      if (!enabled || !provider) throw new PaymentError('微信支付尚未配置', 'PAYMENT_NOT_CONFIGURED', 503)
      const notification = provider.verifyNotification(rawBody, headers)
      return store.fulfillOrder(notification)
    },
  }
}

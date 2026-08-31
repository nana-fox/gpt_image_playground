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
  const store = options.store
  const provider = options.provider
  const providers = options.providers
  const legacyReady = options.enabled === true && Boolean(provider)
  const notifyUrl = String(options.notifyUrl ?? '').trim()
  const clock = options.clock ?? (() => new Date())
  const orderId = options.orderId ?? randomUUID
  const outTradeNo = options.outTradeNo ?? (() => `studio_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`)

  return {
    async listPlans() {
      const [plans, channel, methods] = await Promise.all([
        store.listPlans(),
        store.getPaymentChannel(),
        enabledProviders(),
      ])
      return plans.map((plan) => ({
        id: plan.id,
        kind: plan.kind,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        credits: plan.credits,
        durationDays: plan.durationDays,
        purchasable: methods.length > 0 && channel.acceptingOrders,
        paymentMethods: methods.map((item) => ({ providerKey: item.providerKey, name: item.name })),
      }))
    },

    async getChannelStatus() {
      const methods = await enabledProviders()
      return publicChannel(await store.getPaymentChannel(), methods.length > 0, notifyUrl)
    },

    async updateChannel(input, audit) {
      const methods = await enabledProviders()
      if (input?.acceptingOrders === true && methods.length === 0) {
        throw new PaymentError('请先配置并启用至少一个支付供应商', 'PAYMENT_CREDENTIALS_NOT_READY', 409)
      }
      return publicChannel(await store.updatePaymentChannel(input, audit), methods.length > 0, notifyUrl)
    },

    async getOrder(userId, id) {
      const order = await store.getUserOrder(userId, id)
      const active = await providerForOrder(order)
      if (!order || order.status !== 'pending' || !active?.client?.queryOrder) return publicOrder(order)
      try {
        const result = await active.client.queryOrder(order.outTradeNo)
        if (result.status !== 'success') return publicOrder(order)
        return publicOrder(await store.fulfillOrder({
          ...result,
          eventId: `query:${result.transactionId}`,
        }))
      } catch (error) {
        console.warn('Studio payment reconciliation failed', {
          orderId: order.id,
          reason: error?.reason ?? 'PAYMENT_PROVIDER_ERROR',
        })
        return publicOrder(order)
      }
    },

    async createOrder(userId, planId, idempotencyKey, clientIp, providerKey) {
      const normalizedPlanId = String(planId ?? '').trim()
      const key = String(idempotencyKey ?? '').trim()
      if (!userId || !/^[a-z0-9_-]{1,64}$/i.test(normalizedPlanId) || !key || key.length > 200) {
        throw new PaymentError('支付请求参数无效', 'VALIDATION_ERROR')
      }
      const active = providers
        ? await providers.getEnabled(String(providerKey ?? '').trim())
        : legacyReady ? legacyProvider(provider) : null
      if (!active) throw new PaymentError('所选支付方式尚未开放', 'PAYMENT_NOT_CONFIGURED', 503)
      const channel = await store.getPaymentChannel()
      if (!channel.acceptingOrders) throw new PaymentError('支付暂未开放下单', 'PAYMENT_NOT_ACCEPTING', 503)
      const expiresAt = new Date(Math.ceil((clock().getTime() + 15 * 60 * 1000) / 1000) * 1000).toISOString()
      const orderInput = {
        id: orderId(),
        userId,
        planId: normalizedPlanId,
        idempotencyKey: key,
        outTradeNo: outTradeNo(),
        expiresAt,
      }
      if (providers) Object.assign(orderInput, {
        provider: active.providerKey === 'alipay' ? 'alipay_page' : 'wxpay_native',
        providerInstanceId: active.id,
        providerIdentity: active.identity,
      })
      const result = await store.createOrder(orderInput)
      if (!result.created) return publicOrder(result.order)
      try {
        const createCheckout = active.client.createCheckoutOrder
          ? active.client.createCheckoutOrder.bind(active.client)
          : active.client.createNativeOrder.bind(active.client)
        const payment = await createCheckout({
          outTradeNo: result.order.outTradeNo,
          description: `NanaFox Studio ${result.order.plan.name}`,
          amountCents: result.order.amountCents,
          expiresAt: result.order.expiresAt,
          clientIp,
        })
        const updated = store.attachCheckout
          ? await store.attachCheckout(result.order.id, payment)
          : await store.attachCodeUrl(result.order.id, payment.codeUrl)
        return publicOrder(updated)
      } catch (error) {
        await store.failOrder(result.order.id, error?.reason ?? 'PAYMENT_PROVIDER_ERROR')
        throw error
      }
    },

    async handleWebhook(rawBody, headers, providerId) {
      const active = providers
        ? await providers.getById(providerId)
        : legacyReady ? legacyProvider(provider) : null
      if (!active) throw new PaymentError('支付供应商尚未配置', 'PAYMENT_NOT_CONFIGURED', 503)
      const notification = active.client.verifyNotification(rawBody, headers)
      return store.fulfillOrder(notification)
    },
  }

  async function enabledProviders() {
    if (providers) return options.enabled === true ? providers.listEnabled() : []
    return legacyReady ? [legacyProvider(provider)] : []
  }

  async function providerForOrder(order) {
    if (!order) return null
    if (providers) return providers.getById(order.providerInstanceId)
    return legacyReady ? legacyProvider(provider) : null
  }
}

function legacyProvider(provider) {
  return { id: null, providerKey: 'wxpay', name: '微信支付', client: provider }
}

function publicChannel(channel, credentialsReady, notifyUrl) {
  return {
    provider: 'wxpay_native',
    credentialsReady,
    acceptingOrders: channel.acceptingOrders,
    checkoutAvailable: credentialsReady && channel.acceptingOrders,
    notifyUrl,
    version: channel.version,
  }
}

function publicOrder(order) {
  if (!order) return null
  return {
    id: order.id,
    status: order.status,
    provider: order.provider,
    plan: order.plan,
    amountCents: order.amountCents,
    currency: order.currency,
    codeUrl: order.codeUrl,
    payUrl: order.payUrl ?? null,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt ?? null,
    completedAt: order.completedAt ?? null,
  }
}

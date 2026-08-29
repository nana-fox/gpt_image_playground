// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import {
  createStudioPaymentOrder,
  getStudioPaymentOrder,
  listStudioPaymentPlans,
  StudioPaymentError,
} from './studioPayment'

describe('Studio payment client', () => {
  it('loads only validated server-side plans', async () => {
    const request = vi.fn(async () => Response.json({
      ok: true,
      data: [{
        id: 'plus',
        kind: 'subscription',
        name: '创作 Plus',
        description: '适合持续内容创作',
        priceCents: 2900,
        currency: 'CNY',
        credits: 100,
        durationDays: 30,
        purchasable: false,
        paymentMethods: [{ providerKey: 'alipay', name: '支付宝' }],
      }],
    }))

    expect(await listStudioPaymentPlans(request as typeof fetch)).toEqual([{
      id: 'plus',
      kind: 'subscription',
      name: '创作 Plus',
      description: '适合持续内容创作',
      priceCents: 2900,
      currency: 'CNY',
      credits: 100,
      durationDays: 30,
      purchasable: false,
      paymentMethods: [{ providerKey: 'alipay', name: '支付宝' }],
    }])
  })

  it('creates and polls a real order with Studio CSRF', async () => {
    document.cookie = 'nanafox_studio_csrf=csrf-token'
    const request = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => Response.json({
      ok: true,
      data: {
        id: 'order-1',
        status: init?.method === 'POST' ? 'pending' : 'completed',
        provider: 'wxpay_native',
        plan: {
          id: 'plus',
          kind: 'subscription',
          name: '创作 Plus',
          description: '适合持续内容创作',
          priceCents: 2900,
          currency: 'CNY',
          credits: 100,
          durationDays: 30,
        },
        amountCents: 2900,
        currency: 'CNY',
        codeUrl: init?.method === 'POST' ? 'weixin://wxpay/bizpayurl?pr=test' : null,
        expiresAt: '2026-08-28T08:15:00.000Z',
        paidAt: null,
        completedAt: null,
      },
    }))

    expect((await createStudioPaymentOrder('plus', 'checkout-1', 'wxpay', request as typeof fetch)).status).toBe('pending')
    expect(request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
    })
    expect((await getStudioPaymentOrder('order-1', request as typeof fetch)).status).toBe('completed')
  })

  it('does not turn payment-disabled errors into fake success', async () => {
    const request = vi.fn(async () => Response.json({
      ok: false,
      error: { reason: 'PAYMENT_NOT_CONFIGURED', message: '微信支付尚未开放' },
    }, { status: 503 }))

    await expect(createStudioPaymentOrder('plus', 'checkout-1', 'alipay', request as typeof fetch)).rejects.toEqual(
      expect.objectContaining<Partial<StudioPaymentError>>({ reason: 'PAYMENT_NOT_CONFIGURED', status: 503 }),
    )
  })
})

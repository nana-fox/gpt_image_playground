import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle, Receipt, Sparkle, X } from '@phosphor-icons/react'
import QRCode from 'qrcode'

import {
  createStudioPaymentOrder,
  getStudioPaymentOrder,
  listStudioPaymentPlans,
  type StudioPaymentMethod,
  type StudioPaymentOrder,
  type StudioPaymentPlan,
} from '../lib/studioPayment'
import { quotaDescription, quotaHeader, type StudioQuotaBalance } from '../lib/studioQuota'
import StudioModal from './StudioModal'

export default function StudioQuotaPage({ quota, refreshQuota, onStartCreating }: { quota: StudioQuotaBalance | null | undefined, refreshQuota: () => Promise<void>, onStartCreating: () => void }) {
  const [plans, setPlans] = useState<StudioPaymentPlan[]>()
  const [choosingPlan, setChoosingPlan] = useState<StudioPaymentPlan | null>(null)
  const [order, setOrder] = useState<StudioPaymentOrder | null>(null)
  const [qrCode, setQrCode] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void listStudioPaymentPlans()
      .then(setPlans)
      .catch((err) => setError(err instanceof Error ? err.message : '套餐暂时无法读取'))
  }, [])

  useEffect(() => {
    const id = window.sessionStorage.getItem('nanafox_studio_payment_order')
    if (!id) return
    void getStudioPaymentOrder(id)
      .then(setOrder)
      .catch(() => window.sessionStorage.removeItem('nanafox_studio_payment_order'))
  }, [])

  useEffect(() => {
    if (!order?.codeUrl || order.status !== 'pending') {
      setQrCode('')
      return
    }
    let active = true
    void QRCode.toDataURL(order.codeUrl, { width: 260, margin: 1, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setQrCode(value) })
      .catch(() => { if (active) setError('支付二维码生成失败，请关闭后重试') })
    return () => { active = false }
  }, [order?.codeUrl, order?.status])

  useEffect(() => {
    if (!order || order.status !== 'pending') return
    let active = true
    const timer = window.setInterval(() => {
      void getStudioPaymentOrder(order.id)
        .then(async (next) => {
          if (!active) return
          setOrder(next)
          if (next.status === 'completed') {
            window.sessionStorage.removeItem('nanafox_studio_payment_order')
            await refreshQuota()
          } else if (next.status !== 'pending') {
            window.sessionStorage.removeItem('nanafox_studio_payment_order')
          }
        })
        .catch(() => {})
    }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [order?.id, order?.status, refreshQuota])

  const checkout = async (plan: StudioPaymentPlan, method: StudioPaymentMethod) => {
    setBusy(plan.id)
    setError('')
    setChoosingPlan(null)
    try {
      const next = await createStudioPaymentOrder(plan.id, crypto.randomUUID(), method.providerKey)
      window.sessionStorage.setItem('nanafox_studio_payment_order', next.id)
      setOrder(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '订单创建失败，请稍后重试')
    } finally {
      setBusy('')
    }
  }

  return <div className="page-frame quota-live-page">
    <header className="page-title-row"><div><span className="eyebrow">创作额度</span><h1>额度与方案</h1><p>先使用每日免费次数，用完后再按需购买或订阅。</p></div><button className="secondary-button" onClick={onStartCreating}>返回创作</button></header>
    <section className="live-quota-card"><span><Sparkle size={24} weight="duotone" /></span><div><small>当前可用额度</small><strong>{quotaHeader(quota)}</strong><p>{quotaDescription(quota)}</p></div></section>
    {error && <p className="auth-error studio-payment-error" role="alert">{error}</p>}
    {plans === undefined ? <div className="recent-loading">正在读取真实套餐…</div> : plans.length ? <div className="plans-preview studio-live-plans">{plans.map((plan) => <article key={plan.id}>
      <span className="eyebrow">{plan.kind === 'subscription' ? '按月订阅' : '一次购买'}</span>
      <h2>{plan.name}</h2>
      <strong className="studio-plan-price"><small>¥</small>{(plan.priceCents / 100).toFixed(2)}</strong>
      <p>{plan.description}</p>
      <ul><li>{plan.credits} 次创作额度</li><li>{plan.durationDays} 天有效</li></ul>
      <button className="primary-button" disabled={!plan.purchasable || Boolean(busy)} onClick={() => { if (plan.paymentMethods.length === 1) void checkout(plan, plan.paymentMethods[0]); else setChoosingPlan(plan) }}>{busy === plan.id ? '正在创建订单…' : plan.purchasable ? plan.kind === 'subscription' ? '立即订阅' : '购买加量包' : '支付渠道配置中'}</button>
    </article>)}</div> : <div className="empty-state"><Receipt size={30} /><h3>套餐正在配置</h3><p>运营启用价格和额度后会在这里显示。</p></div>}
    {choosingPlan && <StudioModal onClose={() => setChoosingPlan(null)} className="studio-payment-modal"><div className="studio-payment-result"><span className="eyebrow">选择支付方式</span><h2>{choosingPlan.name}</h2><strong className="studio-plan-price"><small>¥</small>{(choosingPlan.priceCents / 100).toFixed(2)}</strong><div className="payment-methods">{choosingPlan.paymentMethods.map((method) => <button key={method.providerKey} onClick={() => void checkout(choosingPlan, method)}><span className={`payment-logo ${method.providerKey === 'wxpay' ? 'wechat' : 'alipay'}`}>{method.providerKey === 'wxpay' ? '微' : '支'}</span><span><strong>{method.name}</strong><small>{method.providerKey === 'wxpay' ? '微信扫码支付' : '支付宝扫码支付'}</small></span><ArrowRight size={18} /></button>)}</div></div></StudioModal>}
    {order && <StudioModal onClose={() => setOrder(null)} className="studio-payment-modal">
      {order.status === 'completed' ? <div className="studio-payment-result"><CheckCircle size={58} weight="fill" /><span className="eyebrow">支付完成</span><h2>{order.plan.name} 已到账</h2><p>{order.plan.credits} 次创作额度已经加入账户。</p><button className="primary-button" onClick={() => { setOrder(null); onStartCreating() }}>开始创作</button></div> : order.status === 'pending' ? <div className="studio-payment-result"><span className="eyebrow">{order.provider === 'wxpay_native' ? '微信扫码支付' : '支付宝扫码支付'}</span><h2>{order.plan.name}</h2><strong className="studio-plan-price"><small>¥</small>{(order.amountCents / 100).toFixed(2)}</strong>{order.provider === 'wxpay_native' ? qrCode ? <img className="studio-payment-qr" src={qrCode} alt="微信支付二维码" /> : <div className="recent-loading">正在生成支付二维码…</div> : order.payUrl ? <div className="studio-alipay-qr-frame"><iframe className="studio-alipay-checkout" src={order.payUrl} title="支付宝支付二维码" scrolling="no" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" /></div> : <div className="recent-loading">正在生成支付二维码…</div>}<p>请使用{order.provider === 'wxpay_native' ? '微信' : '支付宝'}扫码，支付完成后页面会自动更新。</p><small>订单有效至 {new Date(order.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></div> : <div className="studio-payment-result"><X size={48} /><h2>订单未完成</h2><p>{order.status === 'expired' ? '订单已过期，请重新创建。' : '支付渠道暂时没有完成这个订单。'}</p><button className="secondary-button" onClick={() => setOrder(null)}>返回套餐</button></div>}
    </StudioModal>}
  </div>
}

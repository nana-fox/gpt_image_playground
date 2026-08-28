import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  CaretRight,
  CheckCircle,
  CreditCard,
  Gauge,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Sparkle,
  Storefront,
  User,
  UsersThree,
  X,
} from '@phosphor-icons/react'

import {
  getStudioPaymentChannel,
  getStudioQuotaPolicy,
  getStudioPaymentPlans,
  grantStudioCredits,
  searchStudioUsers,
  updateStudioPaymentChannel,
  updateStudioQuotaPolicy,
  updateStudioPaymentPlan,
  type StudioAdminPaymentPlan,
  type StudioAdminSession,
  type StudioAdminUser,
  type StudioPaymentChannel,
  type StudioQuotaPolicy,
} from '../lib/studioAdmin'

type AdminSection = 'overview' | 'quota' | 'users' | 'plans' | 'payment'

const adminSections: { id: AdminSection, label: string, icon: typeof Gauge }[] = [
  { id: 'overview', label: '运营总览', icon: Gauge },
  { id: 'quota', label: '免费额度', icon: Sparkle },
  { id: 'users', label: '用户额度', icon: UsersThree },
  { id: 'plans', label: '套餐与价格', icon: Storefront },
  { id: 'payment', label: '支付渠道', icon: CreditCard },
]

export default function StudioAdminPage({ admin, onExit }: { admin: StudioAdminSession, onExit: () => void }) {
  const [section, setSection] = useState<AdminSection>('overview')
  const [policy, setPolicy] = useState<StudioQuotaPolicy>()
  const [plans, setPlans] = useState<StudioAdminPaymentPlan[]>([])
  const [paymentChannel, setPaymentChannel] = useState<StudioPaymentChannel>()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [users, setUsers] = useState<StudioAdminUser[]>([])
  const [selected, setSelected] = useState<StudioAdminUser | null>(null)
  const [units, setUnits] = useState(10)
  const [reference, setReference] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [confirmingGrant, setConfirmingGrant] = useState(false)
  const [editingPlan, setEditingPlan] = useState<StudioAdminPaymentPlan | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void Promise.all([getStudioQuotaPolicy(), getStudioPaymentPlans(), getStudioPaymentChannel()])
      .then(([nextPolicy, nextPlans, nextPaymentChannel]) => {
        setPolicy(nextPolicy)
        setPlans(nextPlans)
        setPaymentChannel(nextPaymentChannel)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '运营配置加载失败'))
  }, [])

  const showSection = (next: AdminSection) => {
    setSection(next)
    setError('')
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const savePolicy = async () => {
    if (!policy) return
    setBusy('policy')
    setError('')
    setMessage('')
    try {
      setPolicy(await updateStudioQuotaPolicy(policy))
      setMessage('免费额度配置已生效，新的创作请求会立即使用这套规则。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置保存失败')
    } finally {
      setBusy('')
    }
  }

  const search = async (event: FormEvent) => {
    event.preventDefault()
    setBusy('search')
    setError('')
    setMessage('')
    setSearched(true)
    try {
      const result = await searchStudioUsers(query)
      setUsers(result)
      setSelected(result.length === 1 ? result[0] : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户查询失败')
    } finally {
      setBusy('')
    }
  }

  const requestGrant = (event: FormEvent) => {
    event.preventDefault()
    if (!selected) {
      setError('请先选择一个用户')
      return
    }
    setConfirmingGrant(true)
  }

  const grant = async () => {
    if (!selected) return
    setBusy('grant')
    setError('')
    setMessage('')
    try {
      const result = await grantStudioCredits(selected.id, {
        units,
        reference: reference.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
      setMessage(`已为 ${selected.email} 增加 ${result.total} 次额度，审计编号 ${result.reference}`)
      setReference('')
      setExpiresAt('')
      setConfirmingGrant(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '额度发放失败')
      setConfirmingGrant(false)
    } finally {
      setBusy('')
    }
  }

  const savePlan = async () => {
    if (!editingPlan) return
    setBusy(`plan:${editingPlan.id}`)
    setError('')
    setMessage('')
    try {
      const updated = await updateStudioPaymentPlan(editingPlan)
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMessage(`${updated.name} 已更新，新的订单会使用这套价格和额度。`)
      setEditingPlan(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '套餐保存失败')
    } finally {
      setBusy('')
    }
  }

  const savePaymentChannel = async () => {
    if (!paymentChannel) return
    setBusy('payment-channel')
    setError('')
    setMessage('')
    try {
      const updated = await updateStudioPaymentChannel(paymentChannel)
      setPaymentChannel(updated)
      setMessage(updated.acceptingOrders ? '支付渠道已开始接收新订单。' : '已停止新订单，历史订单仍会继续查单和履约。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '支付渠道保存失败')
    } finally {
      setBusy('')
    }
  }

  const enabledPlans = plans.filter((plan) => plan.enabled).length
  const operator = admin.user.displayName || admin.user.email

  return <div className="studio-operations" data-admin-shell>
    <aside className="operations-sidebar">
      <button className="operations-brand" onClick={() => showSection('overview')}><span>NanaFox</span><small>Operations</small></button>
      <nav aria-label="运营模块">{adminSections.map((item) => {
        const Icon = item.icon
        return <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => showSection(item.id)}><Icon size={19} /><span>{item.label}</span><CaretRight size={14} /></button>
      })}</nav>
      <div className="operations-operator"><span className="studio-avatar"><User size={16} /></span><span><strong>{operator}</strong><small>Router 管理员</small></span></div>
      <button className="operations-exit" onClick={onExit}><ArrowLeft size={17} />返回创作端</button>
    </aside>

    <main className="operations-main">
      <header className="operations-topbar"><div><span className="live-dot" />配置服务运行中</div><button className="secondary-button" onClick={onExit}><ArrowLeft size={17} /> 返回创作端</button></header>
      <div className="operations-content">
        {error && <p className="auth-error studio-admin-notice" role="alert">{error}</p>}
        {message && <p className="studio-admin-success" role="status"><CheckCircle size={18} weight="fill" />{message}</p>}

        {section === 'overview' && <>
          <header className="operations-heading"><span className="eyebrow">NANAFOX OPERATIONS</span><h1>运营总览</h1><p>管理免费额度、用户补偿和销售套餐。每次修改都会经过服务端鉴权并记录操作者。</p></header>
          <div className="operations-metrics">
            <article><span className="metric-icon"><Sparkle size={20} /></span><div><small>每日免费额度</small><strong>{policy ? `${policy.dailyLimit} 次` : '读取中'}</strong><p>{policy?.enabled ? '当前已启用' : '当前已关闭'}</p></div></article>
            <article><span className="metric-icon"><Storefront size={20} /></span><div><small>销售中的套餐</small><strong>{plans.length ? `${enabledPlans}/${plans.length}` : '读取中'}</strong><p>订阅与加量包</p></div></article>
            <article><span className="metric-icon"><CheckCircle size={20} /></span><div><small>权限来源</small><strong>Router</strong><p>角色实时校验</p></div></article>
          </div>
          <section className="operations-quick-actions"><div><h2>常用操作</h2><p>选择一个任务开始，避免在同一页面误改多项配置。</p></div><div>
            <button onClick={() => showSection('quota')}><span className="metric-icon"><Sparkle size={20} /></span><span><strong>调整免费额度</strong><small>开关每日赠送或修改默认次数</small></span><CaretRight size={17} /></button>
            <button onClick={() => showSection('users')}><span className="metric-icon"><UsersThree size={20} /></span><span><strong>给用户增加额度</strong><small>搜索账户并完成一次审计发放</small></span><CaretRight size={17} /></button>
            <button onClick={() => showSection('plans')}><span className="metric-icon"><Storefront size={20} /></span><span><strong>管理销售套餐</strong><small>修改价格、额度、有效期和上架状态</small></span><CaretRight size={17} /></button>
            <button onClick={() => showSection('payment')}><span className="metric-icon"><CreditCard size={20} /></span><span><strong>管理支付渠道</strong><small>检查服务端凭证并控制是否接收新订单</small></span><CaretRight size={17} /></button>
          </div></section>
        </>}

        {section === 'quota' && <>
          <header className="operations-heading"><span className="eyebrow">额度策略</span><h1>每日免费额度</h1><p>免费用户优先使用每日额度；订阅用户不会额外叠加免费次数。</p></header>
          <section className="operations-card compact-card">
            <div className="operations-card-heading"><div><h2>当前生效规则</h2><p>保存后会立即影响新的创作请求。</p></div><span className={`status-pill ${policy?.enabled ? 'online' : ''}`}>{policy?.enabled ? '已启用' : '已关闭'}</span></div>
            {policy ? <div className="operations-form">
              <label className="operations-switch"><span><strong>每日赠送免费创作</strong><small>关闭后，免费用户需要购买额度或订阅才能继续。</small></span><input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /></label>
              <div className="operations-field-grid"><label><span>每位用户每天次数</span><input type="number" min="0" max="1000" value={policy.dailyLimit} onChange={(event) => setPolicy({ ...policy, dailyLimit: Number(event.target.value) })} /><small>建议默认保持 3 次，后续可按运营数据调整。</small></label><label><span>每日重置时区</span><input value={policy.timezone} readOnly /><small>固定为中国标准时间，防止切换时区重复领取。</small></label></div>
              <div className="operations-form-actions"><span>版本 {policy.version}</span><button className="primary-button" disabled={busy === 'policy'} onClick={() => void savePolicy()}>{busy === 'policy' ? '正在保存…' : '保存并立即生效'}</button></div>
            </div> : <div className="recent-loading">正在读取真实配置…</div>}
          </section>
        </>}

        {section === 'users' && <>
          <header className="operations-heading"><span className="eyebrow">客户支持</span><h1>用户额度</h1><p>用于售后补偿、活动奖励和人工加量。发放前会再次显示账户与数量。</p></header>
          <section className="operations-card">
            <div className="operations-card-heading"><div><h2>查找 Studio 用户</h2><p>用户至少登录过一次 Studio 后才能被检索。</p></div></div>
            <form className="operations-search" onSubmit={search}><div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入完整邮箱或昵称" required /></div><button className="secondary-button" disabled={busy === 'search'}>{busy === 'search' ? '查询中…' : '查询用户'}</button></form>
            {users.length > 0 && <div className="operations-users">{users.map((user) => <button type="button" key={user.id} className={selected?.id === user.id ? 'active' : ''} onClick={() => setSelected(user)}><span className="studio-avatar"><User size={16} /></span><span><strong>{user.displayName || '未设置昵称'}</strong><small>{user.email}</small></span>{selected?.id === user.id && <CheckCircle size={19} weight="fill" />}</button>)}</div>}
            {searched && users.length === 0 && busy !== 'search' && <div className="operations-empty"><UsersThree size={25} /><span><strong>没有找到用户</strong><small>请检查邮箱，或者确认该账户已经登录过 Studio。</small></span></div>}
          </section>
          {selected && <section className="operations-card grant-card">
            <div className="selected-user"><span className="studio-avatar large"><User size={20} /></span><span><small>当前发放对象</small><strong>{selected.displayName || selected.email}</strong><p>{selected.email}</p></span><button className="text-button" onClick={() => setSelected(null)}>重新选择</button></div>
            <form className="operations-form" onSubmit={requestGrant}><div className="operations-field-grid"><label><span>增加次数</span><input type="number" min="1" max="100000" value={units} onChange={(event) => setUnits(Number(event.target.value))} required /></label><label><span>有效期（可选）</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div><label><span>业务编号 / 原因标识</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="例如 support-20260828-001" maxLength={200} required /><small>这是幂等键和审计依据，同一个编号不能用于其他发放。</small></label><div className="operations-form-actions"><span>提交前会再次确认</span><button className="primary-button"><Plus size={17} />确认发放信息</button></div></form>
          </section>}
        </>}

        {section === 'plans' && <>
          <header className="operations-heading"><span className="eyebrow">商业化</span><h1>套餐与价格</h1><p>订单会保存下单时的套餐快照，修改只影响之后创建的新订单。</p></header>
          <section className="operations-card plans-table-card">
            <div className="operations-card-heading"><div><h2>全部套餐</h2><p>{enabledPlans} 个销售中，{plans.length - enabledPlans} 个未上架</p></div></div>
            <div className="operations-plan-list"><div className="operations-plan-head"><span>套餐</span><span>价格</span><span>额度与有效期</span><span>状态</span><span /></div>{plans.map((plan) => <article key={plan.id}><span><small>{plan.kind === 'subscription' ? '订阅' : '加量包'}</small><strong>{plan.name}</strong><em>{plan.id}</em></span><strong>¥{(plan.priceCents / 100).toFixed(2)}</strong><span><strong>{plan.credits} 次</strong><small>{plan.durationDays} 天有效</small></span><span className={`status-pill ${plan.enabled ? 'online' : ''}`}>{plan.enabled ? '销售中' : '未上架'}</span><button className="secondary-button small-button" onClick={() => setEditingPlan({ ...plan })}><PencilSimple size={16} />编辑套餐</button></article>)}</div>
          </section>
        </>}

        {section === 'payment' && <>
          <header className="operations-heading"><span className="eyebrow">收款配置</span><h1>支付渠道</h1><p>运营端只控制是否接收新订单。商户号、证书和密钥保留在服务端，不会写入页面或数据库。</p></header>
          <section className="operations-card compact-card">
            <div className="operations-card-heading"><div><h2>微信 Native 支付</h2><p>用户在浏览器中扫码完成支付，到账后自动发放套餐额度。</p></div><span className={`status-pill ${paymentChannel?.checkoutAvailable ? 'online' : ''}`}>{paymentChannel?.checkoutAvailable ? '可下单' : '未开放'}</span></div>
            {paymentChannel ? <div className="operations-form">
              <div className="operations-field-grid"><label><span>服务端凭证</span><input value={paymentChannel.credentialsReady ? '已完整配置' : '尚未配置完整'} readOnly /><small>凭证只通过部署环境和只读文件挂载提供。</small></label><label><span>支付回调地址</span><input value={paymentChannel.notifyUrl} readOnly /><small>需要在微信支付商户平台保持可访问。</small></label></div>
              <label className="operations-switch"><span><strong>接收新的支付订单</strong><small>{paymentChannel.credentialsReady ? '关闭后不再创建新订单，已存在订单仍继续回调和履约。' : '请先由部署人员配置微信支付凭证，再开放下单。'}</small></span><input type="checkbox" checked={paymentChannel.acceptingOrders} disabled={!paymentChannel.credentialsReady} onChange={(event) => setPaymentChannel({ ...paymentChannel, acceptingOrders: event.target.checked })} /></label>
              <div className="operations-form-actions"><span>配置版本 {paymentChannel.version}</span><button className="primary-button" disabled={busy === 'payment-channel'} onClick={() => void savePaymentChannel()}>{busy === 'payment-channel' ? '正在保存…' : '保存支付渠道设置'}</button></div>
            </div> : <div className="recent-loading">正在读取真实配置…</div>}
          </section>
        </>}
      </div>
    </main>

    {confirmingGrant && selected && <div className="operations-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmingGrant(false) }}><section className="operations-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="grant-title"><button className="modal-close" onClick={() => setConfirmingGrant(false)} aria-label="关闭"><X size={20} /></button><span className="metric-icon"><Plus size={21} /></span><h2 id="grant-title">确认发放</h2><p>请核对账户和额度。提交后会写入审计记录，不能通过当前页面撤销。</p><dl><div><dt>用户</dt><dd>{selected.email}</dd></div><div><dt>增加额度</dt><dd>{units} 次</dd></div><div><dt>业务编号</dt><dd>{reference}</dd></div><div><dt>有效期</dt><dd>{expiresAt ? new Date(expiresAt).toLocaleString('zh-CN') : '不过期'}</dd></div></dl><div className="operations-modal-actions"><button className="secondary-button" onClick={() => setConfirmingGrant(false)}>返回修改</button><button className="primary-button" disabled={busy === 'grant'} onClick={() => void grant()}>{busy === 'grant' ? '正在发放…' : '确认发放'}</button></div></section></div>}

    {editingPlan && <div className="operations-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPlan(null) }}><section className="operations-modal plan-editor" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><button className="modal-close" onClick={() => setEditingPlan(null)} aria-label="关闭"><X size={20} /></button><span className="eyebrow">{editingPlan.kind === 'subscription' ? '订阅套餐' : '一次性加量包'}</span><h2 id="plan-editor-title">编辑套餐</h2><p>修改会影响之后创建的新订单，历史订单继续使用原快照。</p><div className="operations-form"><label className="operations-switch"><span><strong>在用户端销售</strong><small>关闭后不会出现在额度与方案页面。</small></span><input type="checkbox" checked={editingPlan.enabled} onChange={(event) => setEditingPlan({ ...editingPlan, enabled: event.target.checked })} /></label><label><span>套餐名称</span><input value={editingPlan.name} maxLength={100} onChange={(event) => setEditingPlan({ ...editingPlan, name: event.target.value })} /></label><div className="operations-field-grid"><label><span>价格（元）</span><input type="number" min="0.01" max="1000000" step="0.01" value={(editingPlan.priceCents / 100).toFixed(2)} onChange={(event) => setEditingPlan({ ...editingPlan, priceCents: Math.round(Number(event.target.value) * 100) })} /></label><label><span>包含次数</span><input type="number" min="1" max="100000" value={editingPlan.credits} onChange={(event) => setEditingPlan({ ...editingPlan, credits: Number(event.target.value) })} /></label><label><span>有效天数</span><input type="number" min="1" max="3650" value={editingPlan.durationDays} onChange={(event) => setEditingPlan({ ...editingPlan, durationDays: Number(event.target.value) })} /></label></div><label><span>用户说明</span><textarea value={editingPlan.description} maxLength={300} onChange={(event) => setEditingPlan({ ...editingPlan, description: event.target.value })} /></label></div><div className="operations-modal-actions"><button className="secondary-button" onClick={() => setEditingPlan(null)}>取消</button><button className="primary-button" disabled={busy === `plan:${editingPlan.id}`} onClick={() => void savePlan()}>{busy === `plan:${editingPlan.id}` ? '正在保存…' : '保存套餐'}</button></div></section></div>}
  </div>
}

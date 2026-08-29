import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  CaretRight,
  CheckCircle,
  CreditCard,
  Gauge,
  ImageSquare,
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
  createStudioInspiration,
  getStudioAdminInspirations,
  getStudioPaymentChannel,
  getStudioPaymentProviders,
  getStudioQuotaPolicy,
  getStudioPaymentPlans,
  grantStudioCredits,
  searchStudioUsers,
  updateStudioPaymentChannel,
  updateStudioPaymentProvider,
  updateStudioInspiration,
  updateStudioQuotaPolicy,
  updateStudioPaymentPlan,
  type StudioAdminPaymentPlan,
  type StudioAdminInspiration,
  type StudioAdminSession,
  type StudioAdminUser,
  type StudioPaymentChannel,
  type StudioPaymentProvider,
  type StudioQuotaPolicy,
} from '../lib/studioAdmin'
import { studioAssetPath } from '../lib/studioApi'

type AdminSection = 'overview' | 'quota' | 'users' | 'inspirations' | 'plans' | 'payment'

const adminSections: { id: AdminSection, label: string, icon: typeof Gauge }[] = [
  { id: 'overview', label: '运营总览', icon: Gauge },
  { id: 'quota', label: '免费额度', icon: Sparkle },
  { id: 'users', label: '用户额度', icon: UsersThree },
  { id: 'inspirations', label: '灵感内容', icon: ImageSquare },
  { id: 'plans', label: '套餐与价格', icon: Storefront },
  { id: 'payment', label: '支付渠道', icon: CreditCard },
]

const inspirationImages = [
  'inspiration-product.png',
  'inspiration-portrait.png',
  'inspiration-social.png',
  'inspiration-illustration.png',
  'inspiration-interior.png',
  'recent-perfume.png',
  'recent-alley.png',
  'recent-flowers.png',
  'recent-cat.png',
]

export default function StudioAdminPage({ admin, onExit }: { admin: StudioAdminSession, onExit: () => void }) {
  const [section, setSection] = useState<AdminSection>('overview')
  const [policy, setPolicy] = useState<StudioQuotaPolicy>()
  const [plans, setPlans] = useState<StudioAdminPaymentPlan[]>([])
  const [paymentChannel, setPaymentChannel] = useState<StudioPaymentChannel>()
  const [paymentProviders, setPaymentProviders] = useState<StudioPaymentProvider[]>([])
  const [inspirations, setInspirations] = useState<StudioAdminInspiration[]>([])
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [users, setUsers] = useState<StudioAdminUser[]>([])
  const [selected, setSelected] = useState<StudioAdminUser | null>(null)
  const [units, setUnits] = useState(10)
  const [reference, setReference] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [confirmingGrant, setConfirmingGrant] = useState(false)
  const [editingPlan, setEditingPlan] = useState<StudioAdminPaymentPlan | null>(null)
  const [editingProvider, setEditingProvider] = useState<StudioPaymentProvider | null>(null)
  const [editingInspiration, setEditingInspiration] = useState<StudioAdminInspiration | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void Promise.all([getStudioQuotaPolicy(), getStudioPaymentPlans(), getStudioPaymentChannel(), getStudioPaymentProviders(), getStudioAdminInspirations()])
      .then(([nextPolicy, nextPlans, nextPaymentChannel, nextPaymentProviders, nextInspirations]) => {
        setPolicy(nextPolicy)
        setPlans(nextPlans)
        setPaymentChannel(nextPaymentChannel)
        setPaymentProviders(nextPaymentProviders)
        setInspirations(nextInspirations)
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

  const editProvider = (provider: StudioPaymentProvider) => {
    setEditingProvider({
      ...provider,
      config: { ...provider.config, privateKey: '', publicKey: '', apiV3Key: '' },
    })
  }

  const savePaymentProvider = async () => {
    if (!editingProvider) return
    setBusy(`provider:${editingProvider.id}`)
    setError('')
    setMessage('')
    try {
      const updated = await updateStudioPaymentProvider(editingProvider)
      setPaymentProviders((current) => current.map((provider) => provider.id === updated.id ? updated : provider))
      setPaymentChannel(await getStudioPaymentChannel())
      setMessage(`${updated.name} 已保存，${updated.enabled ? '现在可供用户选择' : '当前未启用'}。`)
      setEditingProvider(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '支付供应商保存失败')
    } finally {
      setBusy('')
    }
  }

  const startCreatingInspiration = () => {
    setEditingInspiration({
      id: '',
      category: '商业',
      title: '',
      description: '',
      prompt: '',
      image: inspirationImages[0],
      enabled: false,
      featured: false,
      sortOrder: Math.max(0, ...inspirations.map((item) => item.sortOrder)) + 10,
      version: 1,
    })
  }

  const saveInspiration = async () => {
    if (!editingInspiration) return
    setBusy('inspiration')
    setError('')
    setMessage('')
    try {
      const updated = editingInspiration.id
        ? await updateStudioInspiration(editingInspiration)
        : await createStudioInspiration(editingInspiration)
      setInspirations((current) => (editingInspiration.id
        ? current.map((item) => item.id === updated.id ? updated : item)
        : [...current, updated]
      ).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)))
      setMessage(`${updated.title} 已保存，${updated.enabled ? '用户端已可见' : '当前未上架'}。`)
      setEditingInspiration(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '灵感保存失败')
    } finally {
      setBusy('')
    }
  }

  const enabledPlans = plans.filter((plan) => plan.enabled).length
  const enabledInspirations = inspirations.filter((item) => item.enabled).length
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
          <header className="operations-heading"><span className="eyebrow">NANAFOX OPERATIONS</span><h1>运营总览</h1><p>管理灵感内容、免费额度、用户补偿和销售套餐。每次修改都会经过服务端鉴权并记录操作者。</p></header>
          <div className="operations-metrics">
            <article><span className="metric-icon"><Sparkle size={20} /></span><div><small>每日免费额度</small><strong>{policy ? `${policy.dailyLimit} 次` : '读取中'}</strong><p>{policy?.enabled ? '当前已启用' : '当前已关闭'}</p></div></article>
            <article><span className="metric-icon"><Storefront size={20} /></span><div><small>销售中的套餐</small><strong>{plans.length ? `${enabledPlans}/${plans.length}` : '读取中'}</strong><p>订阅与加量包</p></div></article>
            <article><span className="metric-icon"><CheckCircle size={20} /></span><div><small>权限来源</small><strong>Router</strong><p>角色实时校验</p></div></article>
          </div>
          <section className="operations-quick-actions"><div><h2>常用操作</h2><p>选择一个任务开始，避免在同一页面误改多项配置。</p></div><div>
            <button onClick={() => showSection('quota')}><span className="metric-icon"><Sparkle size={20} /></span><span><strong>调整免费额度</strong><small>开关每日赠送或修改默认次数</small></span><CaretRight size={17} /></button>
            <button onClick={() => showSection('users')}><span className="metric-icon"><UsersThree size={20} /></span><span><strong>给用户增加额度</strong><small>搜索账户并完成一次审计发放</small></span><CaretRight size={17} /></button>
            <button onClick={() => showSection('inspirations')}><span className="metric-icon"><ImageSquare size={20} /></span><span><strong>管理灵感内容</strong><small>{enabledInspirations}/{inspirations.length} 条已上架，可调整首页推荐</small></span><CaretRight size={17} /></button>
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

        {section === 'inspirations' && <>
          <header className="operations-heading"><span className="eyebrow">内容运营</span><h1>灵感内容</h1><p>维护创作端展示的灵感和首页推荐。未上架内容不会出现在用户端。</p></header>
          <section className="operations-card">
            <div className="operations-card-heading"><div><h2>灵感库</h2><p>{enabledInspirations} 条已上架，{inspirations.filter((item) => item.featured && item.enabled).length} 条首页推荐</p></div><button className="primary-button small-button" onClick={startCreatingInspiration}><Plus size={16} />新增灵感</button></div>
            {inspirations.length > 0 ? <div className="operations-inspiration-grid">{inspirations.map((item) => <article key={item.id} className="operations-inspiration-card">
              <div className="operations-inspiration-cover"><img src={studioAssetPath(item.image)} alt="" /><span className={`status-pill ${item.enabled ? 'online' : ''}`}>{item.enabled ? '已上架' : '未上架'}</span></div>
              <div className="operations-inspiration-body"><small>{item.category} · 排序 {item.sortOrder}</small><h3>{item.title}</h3><p>{item.description}</p><div><span>{item.featured ? '首页推荐' : '灵感页展示'}</span><button className="secondary-button small-button" onClick={() => setEditingInspiration({ ...item })}><PencilSimple size={15} />编辑</button></div></div>
            </article>)}</div> : <div className="operations-empty"><ImageSquare size={25} /><span><strong>还没有灵感内容</strong><small>新增后先预览，再决定是否上架。</small></span></div>}
          </section>
        </>}

        {section === 'plans' && <>
          <header className="operations-heading"><span className="eyebrow">商业化</span><h1>套餐与价格</h1><p>订单会保存下单时的套餐快照，修改只影响之后创建的新订单。</p></header>
          <section className="operations-card plans-table-card">
            <div className="operations-card-heading"><div><h2>全部套餐</h2><p>{enabledPlans} 个销售中，{plans.length - enabledPlans} 个未上架</p></div></div>
            <div className="operations-plan-list"><div className="operations-plan-head"><span>套餐</span><span>价格</span><span>额度与有效期</span><span>状态</span><span /></div>{plans.map((plan) => <article key={plan.id}><span><small>{plan.kind === 'subscription' ? '订阅' : '加量包'}</small><strong>{plan.name}</strong><em>{plan.id}</em></span><strong>¥{(plan.priceCents / 100).toFixed(2)}</strong><span><strong>{plan.credits} 次</strong><small>{plan.durationDays} 天有效</small></span><span className={`status-pill ${plan.enabled ? 'online' : ''}`}>{plan.enabled ? '销售中' : '未上架'}</span><button className="secondary-button small-button" onClick={() => setEditingPlan({ ...plan })}><PencilSimple size={16} />编辑套餐</button></article>)}</div>
          </section>
        </>}

        {section === 'payment' && <>
          <header className="operations-heading"><span className="eyebrow">收款配置</span><h1>支付渠道</h1><p>在 Studio 内配置微信和支付宝。敏感凭证加密保存在 Studio PostgreSQL，页面只显示配置状态。</p></header>
          <section className="operations-card compact-card">
            <div className="operations-card-heading"><div><h2>收款总开关</h2><p>关闭后不再创建新订单，已有订单仍可回调、查单和发放额度。</p></div><span className={`status-pill ${paymentChannel?.checkoutAvailable ? 'online' : ''}`}>{paymentChannel?.checkoutAvailable ? '可下单' : '未开放'}</span></div>
            {paymentChannel ? <div className="operations-form">
              <label className="operations-switch"><span><strong>接收新的支付订单</strong><small>{paymentChannel.credentialsReady ? '至少一个供应商已配置并启用，可以开放用户购买。' : '请先完成下方微信或支付宝配置。'}</small></span><input type="checkbox" checked={paymentChannel.acceptingOrders} disabled={!paymentChannel.credentialsReady} onChange={(event) => setPaymentChannel({ ...paymentChannel, acceptingOrders: event.target.checked })} /></label>
              <div className="operations-form-actions"><span>配置版本 {paymentChannel.version}</span><button className="primary-button" disabled={busy === 'payment-channel'} onClick={() => void savePaymentChannel()}>{busy === 'payment-channel' ? '正在保存…' : '保存支付渠道设置'}</button></div>
            </div> : <div className="recent-loading">正在读取真实配置…</div>}
          </section>
          <section className="operations-card">
            <div className="operations-card-heading"><div><h2>支付供应商</h2><p>首发支持微信 Native 扫码和支付宝电脑网站支付。</p></div></div>
            <div className="operations-provider-grid">{paymentProviders.map((provider) => <article key={provider.id}>
              <div><span className={`payment-logo ${provider.providerKey === 'wxpay' ? 'wechat' : 'alipay'}`}>{provider.providerKey === 'wxpay' ? '微' : '支'}</span><span><small>{provider.providerKey === 'wxpay' ? '微信 Native' : '支付宝网页支付'}</small><strong>{provider.name}</strong></span><span className={`status-pill ${provider.enabled ? 'online' : ''}`}>{provider.enabled ? '已启用' : provider.configured ? '已配置' : '待配置'}</span></div>
              <dl><div><dt>App ID</dt><dd>{provider.config.appId || '尚未填写'}</dd></div>{provider.providerKey === 'wxpay' && <div><dt>商户号</dt><dd>{provider.config.mchId || '尚未填写'}</dd></div>}<div><dt>凭证</dt><dd>{provider.configured ? '已加密保存' : '尚未完整配置'}</dd></div></dl>
              <label><span>异步通知地址</span><input value={provider.notifyUrl} readOnly /></label>
              <button className="secondary-button" onClick={() => editProvider(provider)}><PencilSimple size={16} />配置供应商</button>
            </article>)}</div>
          </section>
        </>}
      </div>
    </main>

    {confirmingGrant && selected && <div className="operations-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmingGrant(false) }}><section className="operations-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="grant-title"><button className="modal-close" onClick={() => setConfirmingGrant(false)} aria-label="关闭"><X size={20} /></button><span className="metric-icon"><Plus size={21} /></span><h2 id="grant-title">确认发放</h2><p>请核对账户和额度。提交后会写入审计记录，不能通过当前页面撤销。</p><dl><div><dt>用户</dt><dd>{selected.email}</dd></div><div><dt>增加额度</dt><dd>{units} 次</dd></div><div><dt>业务编号</dt><dd>{reference}</dd></div><div><dt>有效期</dt><dd>{expiresAt ? new Date(expiresAt).toLocaleString('zh-CN') : '不过期'}</dd></div></dl><div className="operations-modal-actions"><button className="secondary-button" onClick={() => setConfirmingGrant(false)}>返回修改</button><button className="primary-button" disabled={busy === 'grant'} onClick={() => void grant()}>{busy === 'grant' ? '正在发放…' : '确认发放'}</button></div></section></div>}

    {editingPlan && <div className="operations-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPlan(null) }}><section className="operations-modal plan-editor" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><button className="modal-close" onClick={() => setEditingPlan(null)} aria-label="关闭"><X size={20} /></button><span className="eyebrow">{editingPlan.kind === 'subscription' ? '订阅套餐' : '一次性加量包'}</span><h2 id="plan-editor-title">编辑套餐</h2><p>修改会影响之后创建的新订单，历史订单继续使用原快照。</p><div className="operations-form"><label className="operations-switch"><span><strong>在用户端销售</strong><small>关闭后不会出现在额度与方案页面。</small></span><input type="checkbox" checked={editingPlan.enabled} onChange={(event) => setEditingPlan({ ...editingPlan, enabled: event.target.checked })} /></label><label><span>套餐名称</span><input value={editingPlan.name} maxLength={100} onChange={(event) => setEditingPlan({ ...editingPlan, name: event.target.value })} /></label><div className="operations-field-grid"><label><span>价格（元）</span><input type="number" min="0.01" max="1000000" step="0.01" value={(editingPlan.priceCents / 100).toFixed(2)} onChange={(event) => setEditingPlan({ ...editingPlan, priceCents: Math.round(Number(event.target.value) * 100) })} /></label><label><span>包含次数</span><input type="number" min="1" max="100000" value={editingPlan.credits} onChange={(event) => setEditingPlan({ ...editingPlan, credits: Number(event.target.value) })} /></label><label><span>有效天数</span><input type="number" min="1" max="3650" value={editingPlan.durationDays} onChange={(event) => setEditingPlan({ ...editingPlan, durationDays: Number(event.target.value) })} /></label></div><label><span>用户说明</span><textarea value={editingPlan.description} maxLength={300} onChange={(event) => setEditingPlan({ ...editingPlan, description: event.target.value })} /></label></div><div className="operations-modal-actions"><button className="secondary-button" onClick={() => setEditingPlan(null)}>取消</button><button className="primary-button" disabled={busy === `plan:${editingPlan.id}`} onClick={() => void savePlan()}>{busy === `plan:${editingPlan.id}` ? '正在保存…' : '保存套餐'}</button></div></section></div>}

    {editingProvider && <div className="operations-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingProvider(null) }}><section className="operations-modal provider-editor" role="dialog" aria-modal="true" aria-labelledby="provider-editor-title"><button className="modal-close" onClick={() => setEditingProvider(null)} aria-label="关闭"><X size={20} /></button><span className="eyebrow">支付供应商</span><h2 id="provider-editor-title">配置{editingProvider.providerKey === 'wxpay' ? '微信支付' : '支付宝'}</h2><p>密钥提交后只会加密保存；再次编辑时留空可保留原值。</p><div className="operations-form"><label className="operations-switch"><span><strong>允许用户选择此支付方式</strong><small>必须完整填写凭证后才能启用。</small></span><input type="checkbox" checked={editingProvider.enabled} onChange={(event) => setEditingProvider({ ...editingProvider, enabled: event.target.checked })} /></label><label><span>显示名称</span><input value={editingProvider.name} maxLength={100} onChange={(event) => setEditingProvider({ ...editingProvider, name: event.target.value })} /></label><label><span>App ID</span><input value={editingProvider.config.appId} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, appId: event.target.value } })} /></label>{editingProvider.providerKey === 'wxpay' && <><div className="operations-field-grid"><label><span>商户号</span><input value={editingProvider.config.mchId ?? ''} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, mchId: event.target.value } })} /></label><label><span>商户证书序列号</span><input value={editingProvider.config.serialNo ?? ''} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, serialNo: event.target.value } })} /></label><label><span>微信支付公钥 ID</span><input value={editingProvider.config.publicKeyId ?? ''} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, publicKeyId: event.target.value } })} /></label></div><label><span>API v3 密钥</span><input type="password" value={editingProvider.config.apiV3Key ?? ''} placeholder={editingProvider.config.apiV3KeyConfigured ? '已配置，留空保持不变' : '32 位 API v3 密钥'} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, apiV3Key: event.target.value } })} /></label></>}<label><span>商户应用私钥</span><textarea value={editingProvider.config.privateKey ?? ''} placeholder={editingProvider.config.privateKeyConfigured ? '已配置，留空保持不变' : '粘贴完整 PEM 私钥'} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, privateKey: event.target.value } })} /></label><label><span>{editingProvider.providerKey === 'wxpay' ? '微信支付公钥' : '支付宝公钥'}</span><textarea value={editingProvider.config.publicKey ?? ''} placeholder={editingProvider.config.publicKeyConfigured ? '已配置，留空保持不变' : '粘贴平台公钥'} onChange={(event) => setEditingProvider({ ...editingProvider, config: { ...editingProvider.config, publicKey: event.target.value } })} /></label><label><span>异步通知地址</span><input value={editingProvider.notifyUrl} readOnly /><small>把这个地址填写到对应支付平台；不要使用 Router 的回调地址。</small></label></div><div className="operations-modal-actions"><button className="secondary-button" onClick={() => setEditingProvider(null)}>取消</button><button className="primary-button" disabled={busy === `provider:${editingProvider.id}`} onClick={() => void savePaymentProvider()}>{busy === `provider:${editingProvider.id}` ? '正在保存…' : '加密保存供应商'}</button></div></section></div>}

    {editingInspiration && <div className="operations-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingInspiration(null) }}><section className="operations-modal inspiration-editor" role="dialog" aria-modal="true" aria-labelledby="inspiration-editor-title"><button className="modal-close" onClick={() => setEditingInspiration(null)} aria-label="关闭"><X size={20} /></button><span className="eyebrow">内容运营</span><h2 id="inspiration-editor-title">{editingInspiration.id ? '编辑灵感' : '新增灵感'}</h2><p>提示词会在用户选择灵感后带入创作框。首发封面使用随 Studio 发布的受控图片。</p><img className="inspiration-editor-preview" src={studioAssetPath(editingInspiration.image)} alt="当前封面预览" /><div className="operations-form"><div className="operations-field-grid"><label><span>分类</span><input value={editingInspiration.category} maxLength={30} required onChange={(event) => setEditingInspiration({ ...editingInspiration, category: event.target.value })} /></label><label><span>标题</span><input value={editingInspiration.title} maxLength={100} required onChange={(event) => setEditingInspiration({ ...editingInspiration, title: event.target.value })} /></label></div><label><span>一句话说明</span><input value={editingInspiration.description} maxLength={300} required onChange={(event) => setEditingInspiration({ ...editingInspiration, description: event.target.value })} /></label><label><span>创作提示词</span><textarea value={editingInspiration.prompt} maxLength={10000} required onChange={(event) => setEditingInspiration({ ...editingInspiration, prompt: event.target.value })} /></label><div className="operations-field-grid"><label><span>封面图片</span><select value={editingInspiration.image} onChange={(event) => setEditingInspiration({ ...editingInspiration, image: event.target.value })}>{inspirationImages.map((image) => <option key={image} value={image}>{image}</option>)}</select></label><label><span>排序</span><input type="number" min="0" max="100000" value={editingInspiration.sortOrder} onChange={(event) => setEditingInspiration({ ...editingInspiration, sortOrder: Number(event.target.value) })} /></label></div><label className="operations-switch"><span><strong>在灵感页上架</strong><small>关闭后用户端立即隐藏，但内容和审计记录会保留。</small></span><input type="checkbox" checked={editingInspiration.enabled} onChange={(event) => setEditingInspiration({ ...editingInspiration, enabled: event.target.checked })} /></label><label className="operations-switch"><span><strong>设为首页推荐</strong><small>只有已上架内容会在首页推荐区展示。</small></span><input type="checkbox" checked={editingInspiration.featured} onChange={(event) => setEditingInspiration({ ...editingInspiration, featured: event.target.checked })} /></label></div><div className="operations-modal-actions"><button className="secondary-button" onClick={() => setEditingInspiration(null)}>取消</button><button className="primary-button" disabled={busy === 'inspiration' || !editingInspiration.title.trim() || !editingInspiration.description.trim() || !editingInspiration.prompt.trim()} onClick={() => void saveInspiration()}>{busy === 'inspiration' ? '正在保存…' : '保存灵感'}</button></div></section></div>}
  </div>
}

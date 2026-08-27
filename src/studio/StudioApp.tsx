import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  Compass,
  DownloadSimple,
  Eye,
  Gear,
  Heart,
  House,
  ImageSquare,
  Images,
  MagnifyingGlass,
  Plus,
  Receipt,
  SignOut,
  SlidersHorizontal,
  Sparkle,
  User,
  X,
} from '@phosphor-icons/react'

import {
  StudioAuthError,
  getStudioSession,
  loginStudio,
  loginStudio2FA,
  logoutStudio,
  registerStudio,
  sendStudioVerifyCode,
  type StudioSession,
} from '../lib/studioAuth'
import { studioAssetPath } from '../lib/studioApi'
import {
  createStudioGeneration,
  listStudioGenerations,
  StudioGenerationError,
  type StudioGenerationInput,
  type StudioGenerationTask,
} from '../lib/studioGeneration'
import { getStudioQuota, type StudioQuotaBalance } from '../lib/studioQuota'
import './studio.css'

type AuthMode = 'login' | 'register' | '2fa'
type StudioRoute = 'create' | 'inspiration' | 'works' | 'points' | 'settings'

type InspirationItem = {
  id: string
  category: string
  title: string
  description: string
  image: string
  prompt: string
}

const inspirationItems: InspirationItem[] = [
  { id: 'product', category: '商业', title: '产品海报', description: '打造质感产品视觉', image: 'inspiration-product.png', prompt: '为一款高端无线耳机制作电影感产品海报，黑色背景，柔和轮廓光，突出精密材质和高级质感' },
  { id: 'portrait', category: '人像', title: '自然光人像', description: '捕捉光影与情绪', image: 'inspiration-portrait.png', prompt: '自然电影感人像写真，柔和侧光，安静克制的情绪，细腻肤质，深色背景' },
  { id: 'social', category: '社媒', title: '旅行封面', description: '吸睛封面一键生成', image: 'inspiration-social.png', prompt: '旅行主题社媒封面，雪山与湖面，蓝紫暮色，具有清晰的视觉中心和留白' },
  { id: 'illustration', category: '插画', title: '云海鲸歌', description: '天马行空的想象世界', image: 'inspiration-illustration.png', prompt: '巨鲸穿行在金色云海中的幻想插画，深海蓝与暖金配色，细腻笔触，宏大而宁静' },
  { id: 'interior', category: '空间', title: '温暖客厅', description: '焕新你的理想空间', image: 'inspiration-interior.png', prompt: '把客厅改造成安静温暖的现代空间，低饱和米灰色，木质和布艺材质，自然光充足' },
  { id: 'perfume', category: '商业', title: '静奢香氛', description: '克制高级的品牌视觉', image: 'recent-perfume.png', prompt: '高级香氛产品摄影，深色石材台面，冷调轮廓光，微微水汽，杂志广告质感' },
  { id: 'alley', category: '摄影', title: '雨夜街巷', description: '城市叙事氛围感', image: 'recent-alley.png', prompt: '雨夜里的老城街巷，霓虹灯倒影，电影宽银幕构图，安静行人，写实摄影' },
  { id: 'flowers', category: '摄影', title: '百合静物', description: '柔和自然的静物光线', image: 'recent-flowers.png', prompt: '白色百合花静物摄影，晨光穿过薄纱，低饱和背景，细腻花瓣质感，留白构图' },
  { id: 'cat', category: '萌宠', title: '布偶猫肖像', description: '把日常拍成故事', image: 'recent-cat.png', prompt: '布偶猫电影感肖像，柔和窗边光，奶油色背景，浅景深，细腻毛发' },
]

function getRoute(): StudioRoute {
  const route = window.location.hash.replace(/^#\/?/, '')
  if (route === 'inspiration' || route === 'works' || route === 'points' || route === 'settings') return route
  return 'create'
}

export default function StudioApp() {
  const [session, setSession] = useState<StudioSession | null>()
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    void getStudioSession()
      .then(setSession)
      .catch((error) => {
        if (error instanceof StudioAuthError && error.status === 401) {
          setSession(null)
          return
        }
        setLoadError('账户服务暂时不可用，请稍后重试')
        setSession(null)
      })
  }, [])

  if (session === undefined) return <main className="studio-loading"><span aria-label="正在加载" /></main>
  if (!session) return <StudioAuthPage initialError={loadError} onAuthenticated={setSession} />
  return <StudioWorkspace session={session} onLogout={() => setSession(null)} />
}

function StudioAuthPage({
  initialError,
  onAuthenticated,
}: {
  initialError: string
  onAuthenticated: (session: StudioSession) => void
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [challenge, setChallenge] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const [codeSent, setCodeSent] = useState(false)

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setError('')
    setPassword('')
    setVerifyCode('')
    setCodeSent(false)
  }

  const sendCode = async () => {
    if (!email.trim()) {
      setError('请先填写邮箱地址')
      return
    }
    setBusy(true)
    setError('')
    try {
      await sendStudioVerifyCode(email)
      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') {
        onAuthenticated(await registerStudio({ email, password, verifyCode }))
        return
      }
      if (mode === '2fa') {
        onAuthenticated(await loginStudio2FA(challenge, totpCode))
        return
      }
      const result = await loginStudio(email, password)
      if ('requires2FA' in result) {
        setChallenge(result.challenge)
        setMode('2fa')
        return
      }
      onAuthenticated(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main data-studio-auth className="auth-shell">
      <section className="auth-visual">
        <span className="brand light"><span>NanaFox</span> 创作</span>
        <img src={studioAssetPath('inspiration-portrait.png')} alt="自然光人像创作案例" />
        <div>
          <span className="eyebrow">为创作者准备</span>
          <blockquote>把脑海里的光线、情绪和故事，轻松变成作品。</blockquote>
          <p>不需要配置 Key，也不用研究复杂参数。</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <span className="eyebrow">{mode === 'login' ? '欢迎回来' : mode === 'register' ? '开始你的创作' : '保护你的账户'}</span>
          <h1>{mode === 'login' ? '登录 NanaFox Studio' : mode === 'register' ? '创建账户' : '完成两步验证'}</h1>
          <p>{mode === 'login' ? '继续管理作品、创作额度和订阅。' : mode === 'register' ? '注册后即可使用每日免费创作额度。' : '请输入身份验证器中显示的 6 位动态验证码。'}</p>
          <form onSubmit={submit}>
            {mode !== '2fa' ? (
              <>
                <label><span>邮箱</span><input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></label>
                <label><span>密码</span><input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" minLength={8} required /></label>
                {mode === 'register' && <label><span>邮箱验证码</span><div className="verify-code-field"><input inputMode="numeric" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" pattern="\d{6}" required /><button type="button" onClick={() => void sendCode()} disabled={busy || codeSent}>{codeSent ? '已发送' : '发送验证码'}</button></div></label>}
              </>
            ) : (
              <label><span>两步验证</span><input className="totp-input" autoComplete="one-time-code" inputMode="numeric" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" pattern="\d{6}" autoFocus required /></label>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : mode === 'register' ? '注册并开始创作' : '验证并登录'} <ArrowRight size={17} /></button>
          </form>
          {mode === '2fa' ? (
            <p className="auth-switch"><button type="button" onClick={() => switchMode('login')}>返回邮箱登录</button></p>
          ) : (
            <p className="auth-switch">{mode === 'login' ? '还没有账户？' : '已经有账户？'}<button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '注册账户' : '直接登录'}</button></p>
          )}
        </div>
      </section>
    </main>
  )
}

function StudioWorkspace({ session, onLogout }: { session: StudioSession, onLogout: () => void }) {
  const [route, setRoute] = useState(getRoute)
  const [prompt, setPrompt] = useState('')
  const [selectedInspiration, setSelectedInspiration] = useState('')
  const [quota, setQuota] = useState<StudioQuotaBalance | null>()
  const [tasks, setTasks] = useState<StudioGenerationTask[]>()
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const onHashChange = () => {
      setRoute(getRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.allSettled([getStudioQuota(), listStudioGenerations()])
      .then(([quotaResult, tasksResult]) => {
        if (!active) return
        setQuota(quotaResult.status === 'fulfilled' ? quotaResult.value : null)
        setTasks(tasksResult.status === 'fulfilled' ? tasksResult.value : [])
        if (tasksResult.status === 'rejected') setLoadError('作品记录暂时无法读取')
      })
    return () => {
      active = false
    }
  }, [])

  const navigate = (next: StudioRoute) => {
    if (getRoute() === next) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    window.location.hash = `/${next}`
  }

  const useTemplate = (item: InspirationItem) => {
    setPrompt(item.prompt)
    setSelectedInspiration(item.id)
    navigate('create')
  }

  const refreshQuota = async () => setQuota(await getStudioQuota())
  const addTask = (task: StudioGenerationTask) => setTasks((current) => [task, ...(current ?? []).filter((item) => item.id !== task.id)])
  const content = route === 'inspiration'
    ? <InspirationPage useTemplate={useTemplate} />
    : route === 'works'
      ? <WorksPage tasks={tasks} useWork={(task) => { if (task) setPrompt(task.input.prompt); navigate('create') }} />
      : route === 'points'
        ? <QuotaPage quota={quota} navigate={navigate} />
        : route === 'settings'
          ? <SettingsPage session={session} onLogout={onLogout} />
          : <CreatePage prompt={prompt} setPrompt={setPrompt} selectedInspiration={selectedInspiration} quota={quota} tasks={tasks} addTask={addTask} refreshQuota={refreshQuota} navigate={navigate} />

  return (
    <main className="app-shell" data-studio-workspace>
      <AppHeader route={route} quota={quota} session={session} navigate={navigate} onLogout={onLogout} />
      {loadError && <p className="workspace-alert" role="alert">{loadError}</p>}
      {content}
      {route !== 'points' && <nav className="mobile-tabbar" aria-label="移动端导航"><button className={route === 'create' ? 'active' : ''} onClick={() => navigate('create')}><House size={20} />首页</button><button className={route === 'inspiration' ? 'active' : ''} onClick={() => navigate('inspiration')}><Compass size={20} />灵感</button><button className={route === 'works' ? 'active' : ''} onClick={() => navigate('works')}><Images size={20} />作品</button><button className={route === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><User size={20} />我的</button></nav>}
    </main>
  )
}

function AppHeader({ route, quota, session, navigate, onLogout }: { route: StudioRoute, quota: StudioQuotaBalance | null | undefined, session: StudioSession, navigate: (route: StudioRoute) => void, onLogout: () => void }) {
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const displayName = session.user.displayName || session.user.email

  const signOut = async () => {
    setSigningOut(true)
    try {
      await logoutStudio()
      onLogout()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate('create')}><span>NanaFox</span> 创作</button>
      <nav className="primary-nav" aria-label="主导航"><button className={route === 'create' ? 'active' : ''} onClick={() => navigate('create')}><House size={18} />首页</button><button className={route === 'inspiration' ? 'active' : ''} onClick={() => navigate('inspiration')}><Compass size={18} />灵感</button><button className={route === 'works' ? 'active' : ''} onClick={() => navigate('works')}><Images size={18} />作品</button></nav>
      <div className="account-area"><div className="points-wrap"><button className="points-button quota-header-button" onClick={() => { setQuotaOpen(!quotaOpen); setAccountOpen(false) }}><strong>{quotaHeader(quota)}</strong><span>{quota?.subscriber ? '订阅额度' : quota?.credits ? `另有 ${quota.credits} 次` : '免费额度'}</span></button>{quotaOpen && <div className="points-popover quota-popover"><div><Sparkle size={20} weight="duotone" /><strong>{quota?.free.enabled ? '今日免费创作' : '查看创作额度'}</strong></div><p>{quotaDescription(quota)}</p><button onClick={() => { setQuotaOpen(false); navigate('points') }}>查看额度与方案 <ArrowRight size={15} /></button></div>}</div><div className="account-menu-wrap"><button className="avatar-button" onClick={() => { setAccountOpen(!accountOpen); setQuotaOpen(false) }}><span className="studio-avatar">{displayName.slice(0, 1).toUpperCase()}</span><CaretDown size={13} /></button>{accountOpen && <div className="account-popover"><div className="account-summary"><span className="studio-avatar large">{displayName.slice(0, 1).toUpperCase()}</span><span><strong>{displayName}</strong><small>{quota?.subscriber ? `${quota.planId?.toUpperCase()} 套餐` : '免费账户'}</small></span></div><button onClick={() => navigate('points')}><Receipt size={17} />额度与订阅</button><button onClick={() => navigate('settings')}><Gear size={17} />账户设置</button><button className="danger-link" disabled={signingOut} onClick={() => void signOut()}><SignOut size={17} />{signingOut ? '正在退出' : '退出登录'}</button></div>}</div></div>
    </header>
  )
}

function CreatePage({ prompt, setPrompt, selectedInspiration, quota, tasks, addTask, refreshQuota, navigate }: { prompt: string, setPrompt: (prompt: string) => void, selectedInspiration: string, quota: StudioQuotaBalance | null | undefined, tasks: StudioGenerationTask[] | undefined, addTask: (task: StudioGenerationTask) => void, refreshQuota: () => Promise<void>, navigate: (route: StudioRoute) => void }) {
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [size, setSize] = useState<StudioGenerationInput['size']>('1536x1024')
  const [quality, setQuality] = useState<StudioGenerationInput['quality']>('medium')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [requestKey, setRequestKey] = useState('')
  const [selectedTask, setSelectedTask] = useState<StudioGenerationTask | null>(null)
  const [chosenInspiration, setChosenInspiration] = useState(selectedInspiration)
  const recent = (tasks ?? []).filter((task) => task.output)
  const canGenerate = Boolean(quota && ((quota.free.enabled && quota.free.remaining > 0) || quota.credits > 0))

  const submit = async () => {
    if (!prompt.trim()) {
      setError('先描述想法，或者从下方选择一个灵感。')
      composerRef.current?.focus()
      return
    }
    if (quota && !canGenerate) {
      navigate('points')
      return
    }
    setGenerating(true)
    setError('')
    const key = requestKey || crypto.randomUUID()
    setRequestKey(key)
    try {
      const task = await createStudioGeneration({ prompt: prompt.trim(), size, quality }, key)
      addTask(task)
      await refreshQuota()
      setRequestKey('')
      if (task.output) setSelectedTask(task)
    } catch (err) {
      setError(err instanceof Error ? err.message : '这次创作没有完成，请稍后重试')
      if (!(err instanceof StudioGenerationError) || (err.reason !== 'NETWORK_ERROR' && err.reason !== 'GENERATION_FINALIZATION_PENDING')) setRequestKey('')
    } finally {
      setGenerating(false)
    }
  }

  const applyInspiration = (item: InspirationItem) => {
    setPrompt(item.prompt)
    setChosenInspiration(item.id)
    setError('')
    composerRef.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <section className="hero" style={{ '--studio-hero-image': `url(${studioAssetPath('hero-studio.png')})` } as CSSProperties}><div className="hero-backdrop" /><div className="hero-content"><h1>今天想做什么<span>？</span></h1><p className="hero-subtitle">{quota?.free.enabled ? `不用研究提示词，今天还可免费创作 ${quota.free.remaining} 次` : quota === undefined ? '正在读取你的创作额度…' : '可以使用购买或订阅额度继续创作'}</p><div className={`composer ${error ? 'composer-error' : ''}`}><textarea ref={composerRef} value={prompt} onChange={(event) => { setPrompt(event.target.value); setError(''); setRequestKey('') }} placeholder="描述你想要的画面…" maxLength={10000} /><div className="composer-toolbar"><div className="composer-actions"><button className="toolbar-button" type="button" disabled title="参考图编辑将在下一阶段开放"><ImageSquare size={19} /><span>添加参考图</span></button><button className="suggestion-chip" type="button" onClick={() => applyInspiration(inspirationItems[0])}><Sparkle size={17} weight="fill" />试试：把产品放进电影感场景</button></div><div className="generation-settings"><label><span>画面比例</span><select value={size} onChange={(event) => { setSize(event.target.value as StudioGenerationInput['size']); setRequestKey('') }}><option value="1024x1024">1:1</option><option value="1536x1024">3:2</option><option value="1024x1536">2:3</option></select></label><label><span>画质</span><select value={quality} onChange={(event) => { setQuality(event.target.value as StudioGenerationInput['quality']); setRequestKey('') }}><option value="medium">标准画质</option><option value="high">精细画质</option></select></label><div className="create-action"><button className="primary-button" type="button" onClick={() => void submit()} disabled={generating || quota === undefined}>{generating ? <span className="loading-dot" /> : <Sparkle size={18} weight="fill" />}{generating ? '正在创作' : '开始创作'}</button><span>{quotaUsageText(quota)}</span></div></div></div></div>{error && <p className="error-message" role="alert">{error}</p>}</div></section>
      <section className="content-section inspiration-section"><div className="section-heading"><h2>从灵感开始</h2><p>选一个方向，提示词会自动准备好</p><button className="heading-link" onClick={() => navigate('inspiration')}>浏览灵感库 <ArrowRight size={16} /></button></div><div className="inspiration-grid">{inspirationItems.slice(0, 5).map((item) => <article key={item.id} className={`inspiration-card ${chosenInspiration === item.id ? 'selected' : ''}`} onClick={() => applyInspiration(item)}><img src={studioAssetPath(item.image)} alt={item.title} /><div className="card-shade" />{chosenInspiration === item.id && <span className="selected-mark"><CheckCircle size={18} weight="fill" /> 已选</span>}<div className="card-copy"><h3>{item.title}</h3><p>{item.description}</p></div><button type="button"><Sparkle size={15} weight="fill" /> 使用此灵感</button></article>)}</div></section>
      <section className="content-section recent-section"><div className="section-heading recent-heading"><div><h2>最近创作</h2><p>自动保存在作品库，随时继续</p></div><button className="text-button" onClick={() => navigate('works')}>查看全部 <ArrowRight size={17} /></button></div>{tasks === undefined ? <div className="recent-loading">正在读取真实作品…</div> : recent.length ? <div className="recent-grid">{recent.slice(0, 7).map((task) => <button className="recent-item" key={task.id} onClick={() => setSelectedTask(task)}><img src={task.output!.url} alt={task.input.prompt} /><span className="recent-meta"><strong>{task.input.prompt}</strong><small>{formatDate(task.createdAt)}</small></span></button>)}</div> : <div className="recent-empty"><Images size={25} /><span><strong>还没有作品</strong><small>完成第一次创作后会自动保存在这里。</small></span></div>}</section>
      {selectedTask?.output && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </>
  )
}

function InspirationPage({ useTemplate }: { useTemplate: (item: InspirationItem) => void }) {
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<InspirationItem | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const categories = ['全部', '商业', '人像', '社媒', '插画', '摄影', '空间', '萌宠']
  const filtered = inspirationItems.filter((item) => (category === '全部' || item.category === category) && `${item.title}${item.description}`.includes(query))
  return <div className="page-frame"><header className="page-hero compact"><span className="eyebrow"><Sparkle size={15} weight="fill" /> 每周更新</span><h1>先找到感觉，再开始创作</h1><p>每个灵感都准备好了画面方向和描述，你只需要换成自己的内容。</p></header><div className="library-toolbar"><div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品、人像、海报…" /></div><div className="filter-scroll">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div><div className="template-grid">{filtered.map((item, idx) => <article className={`template-card template-${idx % 3 + 1}`} key={item.id}><button className={`favorite-button ${favorites.includes(item.id) ? 'active' : ''}`} onClick={() => setFavorites((values) => values.includes(item.id) ? values.filter((id) => id !== item.id) : [...values, item.id])} aria-label={`收藏${item.title}`}><Heart size={18} weight={favorites.includes(item.id) ? 'fill' : 'regular'} /></button><button className="template-image-button" onClick={() => setSelected(item)}><img src={studioAssetPath(item.image)} alt={item.title} /></button><div className="template-info"><span>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p><button onClick={() => useTemplate(item)}>使用灵感 <ArrowRight size={15} /></button></div></article>)}</div>{!filtered.length && <div className="empty-state"><MagnifyingGlass size={30} /><h3>没有找到匹配的灵感</h3><p>换个关键词或浏览其他分类。</p><button className="secondary-button" onClick={() => { setQuery(''); setCategory('全部') }}>查看全部</button></div>}{selected && <Modal onClose={() => setSelected(null)} className="template-modal"><div className="template-preview"><img src={studioAssetPath(selected.image)} alt={selected.title} /></div><div className="template-detail"><span className="eyebrow">{selected.category}灵感</span><h2>{selected.title}</h2><p>{selected.description}</p><div className="prompt-preview"><small>已经帮你准备好</small><p>{selected.prompt}</p></div><button className="primary-button" onClick={() => useTemplate(selected)}><Sparkle size={18} weight="fill" /> 用这个灵感创作</button></div></Modal>}</div>
}

function WorksPage({ tasks, useWork }: { tasks: StudioGenerationTask[] | undefined, useWork: (task: StudioGenerationTask | null) => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<StudioGenerationTask | null>(null)
  const works = useMemo(() => (tasks ?? []).filter((task) => task.output && task.input.prompt.includes(query)), [tasks, query])
  return <div className="page-frame"><header className="page-title-row"><div><span className="eyebrow">你的创作空间</span><h1>作品库</h1><p>{tasks === undefined ? '正在读取真实作品…' : `${works.length} 个作品 · 云端自动保存`}</p></div><button className="primary-button" onClick={() => useWork(null)}><Plus size={18} /> 新建创作</button></header><div className="works-toolbar"><div className="segmented-control"><button className="active">全部作品</button></div><div className="search-field small"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品" /></div><button className="icon-button" aria-label="作品筛选"><SlidersHorizontal size={19} /></button></div><div className="works-grid">{works.map((task, idx) => <button className={`work-card work-${idx % 4 + 1}`} key={task.id} onClick={() => setSelected(task)}><img src={task.output!.url} alt={task.input.prompt} /><span className="work-overlay"><strong>{task.input.prompt}</strong><small>{formatDate(task.createdAt)} · {ratioName(task.input.size)}</small><span><Eye size={15} /> 查看详情</span></span></button>)}</div>{tasks !== undefined && !works.length && <div className="empty-state"><Images size={30} /><h3>还没有这样的作品</h3><p>{query ? '清空搜索，或者开始一次新创作。' : '完成第一次创作后，作品会自动出现在这里。'}</p>{query && <button className="secondary-button" onClick={() => setQuery('')}>清空搜索</button>}</div>}{selected?.output && <TaskModal task={selected} onClose={() => setSelected(null)} onReuse={() => useWork(selected)} />}</div>
}

function QuotaPage({ quota, navigate }: { quota: StudioQuotaBalance | null | undefined, navigate: (route: StudioRoute) => void }) {
  return <div className="page-frame quota-live-page"><header className="page-title-row"><div><span className="eyebrow">创作额度</span><h1>额度与方案</h1><p>先使用每日免费次数，用完后再按需购买或订阅。</p></div><button className="secondary-button" onClick={() => navigate('create')}>返回创作</button></header><section className="live-quota-card"><span><Sparkle size={24} weight="duotone" /></span><div><small>当前可用额度</small><strong>{quotaHeader(quota)}</strong><p>{quotaDescription(quota)}</p></div></section><div className="plans-preview"><article><span className="eyebrow">PLUS</span><h2>创作 Plus</h2><p>适合持续内容创作，包含每月创作额度与精细画质。</p><button className="primary-button" disabled>订阅即将开放</button></article><article><span className="eyebrow">PRO</span><h2>专业版</h2><p>适合高频商业产出，提供更多额度与优先创作能力。</p><button className="primary-button" disabled>订阅即将开放</button></article></div><p className="unavailable-note">支付和套餐配置接口尚未接入测试环境，因此这里不会展示假价格或模拟付款结果。</p></div>
}

function SettingsPage({ session, onLogout }: { session: StudioSession, onLogout: () => void }) {
  const [signingOut, setSigningOut] = useState(false)
  const displayName = session.user.displayName || session.user.email
  const signOut = async () => {
    setSigningOut(true)
    try {
      await logoutStudio()
      onLogout()
    } finally {
      setSigningOut(false)
    }
  }
  return <div className="page-frame settings-page"><header className="page-title-row"><div><span className="eyebrow">个人中心</span><h1>账户设置</h1><p>查看你的 NanaFox Studio 账户资料</p></div></header><div className="settings-layout"><aside className="settings-nav"><button className="active"><User size={18} />个人资料</button></aside><div className="settings-content"><section className="settings-card"><div className="settings-card-heading"><div><h2>个人资料</h2><p>账户由 NanaFox Studio 登录服务安全管理。</p></div></div><div className="profile-editor"><span className="studio-avatar profile">{displayName.slice(0, 1).toUpperCase()}</span></div><div className="form-grid"><label><span>昵称</span><input value={displayName} readOnly /></label><label><span>邮箱</span><input value={session.user.email} readOnly /></label></div><button className="secondary-button danger-link" disabled={signingOut} onClick={() => void signOut()}><SignOut size={17} />{signingOut ? '正在退出' : '退出登录'}</button></section></div></div></div>
}

function Modal({ children, onClose, className = '' }: { children: ReactNode, onClose: () => void, className?: string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`base-modal ${className}`} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>{children}</section></div>
}

function TaskModal({ task, onClose, onReuse }: { task: StudioGenerationTask, onClose: () => void, onReuse?: () => void }) {
  if (!task.output) return null
  return <Modal onClose={onClose} className="work-modal"><div className="work-preview"><img src={task.output.url} alt={task.input.prompt} /></div><div className="work-detail"><span className="success-label"><CheckCircle size={18} weight="fill" /> 已完成</span><h2>{task.input.prompt}</h2><p>创建于 {formatDate(task.createdAt)}，作品已安全保存在云端。</p><dl><div><dt>画面比例</dt><dd>{ratioName(task.input.size)}</dd></div><div><dt>精细度</dt><dd>{qualityName(task.input.quality)}</dd></div><div><dt>作品状态</dt><dd>仅你可见</dd></div></dl><div className="result-actions">{onReuse && <button className="secondary-button" onClick={onReuse}><Sparkle size={17} /> 复用描述</button>}<a className="primary-button" href={task.output.url} download><DownloadSimple size={18} /> 下载</a></div></div></Modal>
}

function quotaHeader(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '额度读取中'
  if (quota === null) return '额度暂不可用'
  if (quota.free.enabled && quota.free.eligible) return `今日 ${quota.free.remaining}/${quota.free.limit} 次`
  return `${quota.credits} 次可用`
}

function quotaDescription(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '正在读取你的真实额度。'
  if (quota === null) return '额度服务暂时不可用，请稍后重试。'
  if (quota.free.enabled && quota.free.eligible) return `今天还剩 ${quota.free.remaining} 次，明天自动恢复。${quota.credits ? `另有 ${quota.credits} 次购买或订阅额度。` : ''}`
  return quota.credits ? `当前有 ${quota.credits} 次购买或订阅额度。` : '当前没有可用额度。'
}

function quotaUsageText(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '正在确认本次额度'
  if (quota === null) return '额度暂时无法读取'
  if (quota.free.enabled && quota.free.remaining > 0) return '使用 1 次今日免费额度'
  if (quota.credits > 0) return '使用 1 次购买或订阅额度'
  return '当前没有可用额度'
}

function ratioName(size: StudioGenerationInput['size']) {
  if (size === '1536x1024') return '3:2'
  if (size === '1024x1536') return '2:3'
  return '1:1'
}

function qualityName(quality: StudioGenerationInput['quality']) {
  if (quality === 'low') return '快速'
  if (quality === 'high') return '精细'
  return '标准'
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

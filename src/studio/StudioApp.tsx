import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight,
  ArrowCounterClockwise,
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
  Trash,
  User,
  X,
} from '@phosphor-icons/react'

import {
  StudioAuthError,
  getStudioSession,
  loginStudio,
  loginStudio2FA,
  logoutStudio,
  requestStudioPasswordReset,
  registerStudio,
  resetStudioPassword,
  sendStudioVerifyCode,
  type StudioSession,
} from '../lib/studioAuth'
import { getStudioAdminSession, type StudioAdminSession } from '../lib/studioAdmin'
import { studioAssetPath } from '../lib/studioApi'
import {
  createStudioGeneration,
  deleteStudioGeneration,
  listStudioGenerations,
  restoreStudioGeneration,
  StudioGenerationError,
  type StudioGenerationInput,
  type StudioGenerationTask,
} from '../lib/studioGeneration'
import { listStudioInspirations, type StudioInspiration } from '../lib/studioInspiration'
import { getStudioQuota, type StudioQuotaBalance } from '../lib/studioQuota'
import {
  createStudioPaymentOrder,
  getStudioPaymentOrder,
  listStudioPaymentPlans,
  type StudioPaymentOrder,
  type StudioPaymentMethod,
  type StudioPaymentPlan,
} from '../lib/studioPayment'
import StudioAdminPage from './StudioAdminPage'
import './studio.css'

type AuthMode = 'login' | 'register' | '2fa' | 'forgot' | 'reset'
type StudioRoute = 'create' | 'inspiration' | 'works' | 'points' | 'settings' | 'admin'

function getRoute(): StudioRoute {
  const route = window.location.hash.replace(/^#\/?/, '')
  if (route === 'inspiration' || route === 'works' || route === 'points' || route === 'settings' || route === 'admin') return route
  return 'create'
}

export default function StudioApp() {
  const [resetRequest, setResetRequest] = useState(getPasswordResetRequest)
  const [session, setSession] = useState<StudioSession | null>()
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (resetRequest) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
      setSession(null)
      return
    }
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

  if (resetRequest) return <StudioAuthPage initialError="" initialMode="reset" initialEmail={resetRequest.email} resetToken={resetRequest.token} onAuthenticated={(next) => { setResetRequest(null); setSession(next) }} />
  if (session === undefined) return <main className="studio-loading"><span aria-label="正在加载" /></main>
  if (!session) return <StudioAuthPage initialError={loadError} onAuthenticated={setSession} />
  return <StudioWorkspace session={session} onLogout={() => setSession(null)} />
}

function StudioAuthPage({
  initialError,
  initialMode = 'login',
  initialEmail = '',
  resetToken = '',
  onAuthenticated,
}: {
  initialError: string
  initialMode?: AuthMode
  initialEmail?: string
  resetToken?: string
  onAuthenticated: (session: StudioSession) => void
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [challenge, setChallenge] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState(initialError)
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setInterval(() => setResendIn((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendIn])

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setError('')
    setSuccess('')
    setPassword('')
    setConfirmPassword('')
    setVerifyCode('')
    setResendIn(0)
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
      setResendIn(60)
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
      if (mode === 'forgot') {
        await requestStudioPasswordReset(email)
        setSuccess('如果该邮箱已注册，重置链接会在几分钟内发送，请检查收件箱。')
        return
      }
      if (mode === 'reset') {
        if (password !== confirmPassword) {
          setError('两次输入的密码不一致')
          return
        }
        await resetStudioPassword(email, resetToken, password)
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setSuccess('密码已重置，请使用新密码登录。')
        return
      }
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

  const copy = {
    login: ['欢迎回来', '登录 NanaFox Studio', '继续管理作品、创作额度和订阅。'],
    register: ['开始你的创作', '创建账户', '注册后即可使用每日免费创作额度。'],
    '2fa': ['保护你的账户', '完成两步验证', '请输入身份验证器中显示的 6 位动态验证码。'],
    forgot: ['找回账户', '忘记密码', '填写注册邮箱，我们会发送一个 30 分钟内有效的重置链接。'],
    reset: ['保护你的账户', '重置密码', '设置一个至少 8 位的新密码，完成后所有已登录设备会退出。'],
  }[mode]
  const submitLabel = mode === 'login'
    ? '登录'
    : mode === 'register'
      ? '注册并开始创作'
      : mode === '2fa'
        ? '验证并登录'
        : mode === 'forgot'
          ? '发送重置链接'
          : '确认重置密码'

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
          <span className="eyebrow">{copy[0]}</span>
          <h1>{copy[1]}</h1>
          <p>{copy[2]}</p>
          <form onSubmit={submit}>
            {mode !== '2fa' ? (
              <>
                <label><span>邮箱</span><input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" readOnly={mode === 'reset'} required /></label>
                {mode !== 'forgot' && <label><span>{mode === 'reset' ? '新密码' : '密码'}</span><input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" minLength={8} required /></label>}
                {mode === 'login' && <button className="forgot-button" type="button" onClick={() => switchMode('forgot')}>忘记密码？</button>}
                {mode === 'reset' && <label><span>确认新密码</span><input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" minLength={8} required /></label>}
                {mode === 'register' && <label><span>邮箱验证码</span><div className="verify-code-field"><input inputMode="numeric" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" pattern="\d{6}" required /><button type="button" onClick={() => void sendCode()} disabled={busy || resendIn > 0}>{resendIn > 0 ? `${resendIn} 秒后重新发送` : '发送验证码'}</button></div></label>}
              </>
            ) : (
              <label><span>两步验证</span><input className="totp-input" autoComplete="one-time-code" inputMode="numeric" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" pattern="\d{6}" autoFocus required /></label>
            )}
            {success && <p className="auth-success" role="status">{success}</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? '请稍候…' : submitLabel} <ArrowRight size={17} /></button>
          </form>
          {mode === '2fa' || mode === 'forgot' || mode === 'reset' ? (
            <p className="auth-switch"><button type="button" onClick={() => switchMode('login')}>返回邮箱登录</button></p>
          ) : (
            <p className="auth-switch">{mode === 'login' ? '还没有账户？' : '已经有账户？'}<button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '注册账户' : '直接登录'}</button></p>
          )}
        </div>
      </section>
    </main>
  )
}

function getPasswordResetRequest() {
  if (!window.location.pathname.endsWith('/reset-password')) return null
  const params = new URLSearchParams(window.location.search)
  const email = params.get('email')?.trim().toLowerCase() ?? ''
  const token = params.get('token')?.trim() ?? ''
  if (!email || !token) return null
  return { email, token }
}

function StudioWorkspace({ session, onLogout }: { session: StudioSession, onLogout: () => void }) {
  const [route, setRoute] = useState(getRoute)
  const [prompt, setPrompt] = useState('')
  const [selectedInspiration, setSelectedInspiration] = useState('')
  const [quota, setQuota] = useState<StudioQuotaBalance | null>()
  const [tasks, setTasks] = useState<StudioGenerationTask[]>()
  const [tasksError, setTasksError] = useState('')
  const [inspirations, setInspirations] = useState<StudioInspiration[]>([])
  const [admin, setAdmin] = useState<StudioAdminSession | null>()
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
    void Promise.allSettled([getStudioQuota(), listStudioGenerations(), listStudioInspirations(), getStudioAdminSession()])
      .then(([quotaResult, tasksResult, inspirationResult, adminResult]) => {
        if (!active) return
        setQuota(quotaResult.status === 'fulfilled' ? quotaResult.value : null)
        setTasks(tasksResult.status === 'fulfilled' ? tasksResult.value : undefined)
        setTasksError(tasksResult.status === 'rejected' ? '作品记录暂时无法读取，请重试' : '')
        setInspirations(inspirationResult.status === 'fulfilled' ? inspirationResult.value : [])
        setAdmin(adminResult.status === 'fulfilled' ? adminResult.value : null)
        if (inspirationResult.status === 'rejected') setLoadError('灵感内容暂时无法读取')
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

  const useTemplate = (item: StudioInspiration) => {
    setPrompt(item.prompt)
    setSelectedInspiration(item.id)
    navigate('create')
  }

  const refreshQuota = async () => {
    setQuota(undefined)
    try {
      setQuota(await getStudioQuota())
    } catch {
      setQuota(null)
    }
  }
  const refreshTasks = async () => {
    setTasks(undefined)
    setTasksError('')
    try {
      setTasks(await listStudioGenerations())
    } catch {
      setTasksError('作品记录暂时无法读取，请重试')
    }
  }
  const addTask = (task: StudioGenerationTask) => setTasks((current) => [task, ...(current ?? []).filter((item) => item.id !== task.id)])
  const removeTask = (id: string) => setTasks((current) => (current ?? []).filter((item) => item.id !== id))
  const content = route === 'inspiration'
    ? <InspirationPage items={inspirations} useTemplate={useTemplate} />
    : route === 'works'
      ? <WorksPage tasks={tasks} tasksError={tasksError} refreshTasks={refreshTasks} addTask={addTask} removeTask={removeTask} useWork={(task) => { if (task) setPrompt(task.input.prompt); navigate('create') }} />
      : route === 'points'
        ? <QuotaPage quota={quota} refreshQuota={refreshQuota} navigate={navigate} />
        : route === 'settings'
          ? <SettingsPage session={session} onLogout={onLogout} />
          : route === 'admin'
            ? admin === undefined
              ? <div className="page-frame recent-loading">正在确认运营权限…</div>
              : admin
                ? <StudioAdminPage admin={admin} onExit={() => navigate('create')} />
                : <div className="page-frame empty-state"><Gear size={30} /><h3>当前账户没有运营权限</h3><p>运营权限只按服务端配置的 Router 用户标识开放。</p><button className="secondary-button" onClick={() => navigate('create')}>返回创作</button></div>
            : <CreatePage prompt={prompt} setPrompt={setPrompt} selectedInspiration={selectedInspiration} inspirations={inspirations} quota={quota} tasks={tasks} tasksError={tasksError} addTask={addTask} refreshQuota={refreshQuota} refreshTasks={refreshTasks} navigate={navigate} />

  return (
    <main className="app-shell" data-studio-workspace>
      {route !== 'admin' && <AppHeader route={route} quota={quota} session={session} isAdmin={Boolean(admin)} navigate={navigate} onLogout={onLogout} />}
      {loadError && <p className="workspace-alert" role="alert">{loadError}</p>}
      {content}
      {route !== 'points' && route !== 'admin' && <nav className="mobile-tabbar" aria-label="移动端导航"><button className={route === 'create' ? 'active' : ''} onClick={() => navigate('create')}><House size={20} />首页</button><button className={route === 'inspiration' ? 'active' : ''} onClick={() => navigate('inspiration')}><Compass size={20} />灵感</button><button className={route === 'works' ? 'active' : ''} onClick={() => navigate('works')}><Images size={20} />作品</button><button className={route === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><User size={20} />我的</button></nav>}
    </main>
  )
}

function AppHeader({ route, quota, session, isAdmin, navigate, onLogout }: { route: StudioRoute, quota: StudioQuotaBalance | null | undefined, session: StudioSession, isAdmin: boolean, navigate: (route: StudioRoute) => void, onLogout: () => void }) {
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
      <div className="account-area"><div className="points-wrap"><button className="points-button quota-header-button" onClick={() => { setQuotaOpen(!quotaOpen); setAccountOpen(false) }}><strong>{quotaHeader(quota)}</strong><span>{quota?.subscriber ? '订阅额度' : quota?.credits ? `另有 ${quota.credits} 次` : '免费额度'}</span></button>{quotaOpen && <div className="points-popover quota-popover"><div><Sparkle size={20} weight="duotone" /><strong>{quota?.free.enabled ? '今日免费创作' : '查看创作额度'}</strong></div><p>{quotaDescription(quota)}</p><button onClick={() => { setQuotaOpen(false); navigate('points') }}>查看额度与方案 <ArrowRight size={15} /></button></div>}</div><div className="account-menu-wrap"><button className="avatar-button" onClick={() => { setAccountOpen(!accountOpen); setQuotaOpen(false) }}><span className="studio-avatar">{displayName.slice(0, 1).toUpperCase()}</span><CaretDown size={13} /></button>{accountOpen && <div className="account-popover"><div className="account-summary"><span className="studio-avatar large">{displayName.slice(0, 1).toUpperCase()}</span><span><strong>{displayName}</strong><small>{quota?.subscriber ? `${quota.planId?.toUpperCase()} 套餐` : '免费账户'}</small></span></div><button onClick={() => { setAccountOpen(false); navigate('points') }}><Receipt size={17} />额度与订阅</button><button onClick={() => { setAccountOpen(false); navigate('settings') }}><Gear size={17} />账户设置</button>{isAdmin && <button onClick={() => { setAccountOpen(false); navigate('admin') }}><SlidersHorizontal size={17} />运营管理</button>}<button className="danger-link" disabled={signingOut} onClick={() => void signOut()}><SignOut size={17} />{signingOut ? '正在退出' : '退出登录'}</button></div>}</div></div>
    </header>
  )
}

function CreatePage({ prompt, setPrompt, selectedInspiration, inspirations, quota, tasks, tasksError, addTask, refreshQuota, refreshTasks, navigate }: { prompt: string, setPrompt: (prompt: string) => void, selectedInspiration: string, inspirations: StudioInspiration[], quota: StudioQuotaBalance | null | undefined, tasks: StudioGenerationTask[] | undefined, tasksError: string, addTask: (task: StudioGenerationTask) => void, refreshQuota: () => Promise<void>, refreshTasks: () => Promise<void>, navigate: (route: StudioRoute) => void }) {
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [size, setSize] = useState<StudioGenerationInput['size']>('1536x1024')
  const [quality, setQuality] = useState<StudioGenerationInput['quality']>('medium')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [requestKey, setRequestKey] = useState('')
  const [selectedTask, setSelectedTask] = useState<StudioGenerationTask | null>(null)
  const [chosenInspiration, setChosenInspiration] = useState(selectedInspiration)
  const recent = (tasks ?? []).filter((task) => task.output)
  const featured = inspirations.filter((item) => item.featured).slice(0, 5)
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

  const applyInspiration = (item: StudioInspiration) => {
    setPrompt(item.prompt)
    setChosenInspiration(item.id)
    setError('')
    composerRef.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <section className="hero" style={{ '--studio-hero-image': `url(${studioAssetPath('hero-studio.png')})` } as CSSProperties}><div className="hero-backdrop" /><div className="hero-content"><h1>今天想做什么<span>？</span></h1><p className="hero-subtitle">{quota?.free.enabled ? `不用研究提示词，今天还可免费创作 ${quota.free.remaining} 次` : quota === undefined ? '正在读取你的创作额度…' : quota === null ? '额度暂时无法读取，请重试后再创作' : '可以使用购买或订阅额度继续创作'}</p><div className={`composer ${error ? 'composer-error' : ''}`}><textarea ref={composerRef} value={prompt} onChange={(event) => { setPrompt(event.target.value); setError(''); setRequestKey('') }} placeholder="描述你想要的画面…" maxLength={10000} /><div className="composer-toolbar"><div className="composer-actions"><button className="toolbar-button" type="button" disabled title="参考图编辑将在下一阶段开放"><ImageSquare size={19} /><span>添加参考图</span></button>{featured[0] && <button className="suggestion-chip" type="button" onClick={() => applyInspiration(featured[0])}><Sparkle size={17} weight="fill" />试试：{featured[0].title}</button>}</div><div className="generation-settings"><label><span>画面比例</span><select value={size} onChange={(event) => { setSize(event.target.value as StudioGenerationInput['size']); setRequestKey('') }}><option value="1024x1024">1:1</option><option value="1536x1024">3:2</option><option value="1024x1536">2:3</option></select></label><label><span>画质</span><select value={quality} onChange={(event) => { setQuality(event.target.value as StudioGenerationInput['quality']); setRequestKey('') }}><option value="medium">标准画质</option><option value="high">精细画质</option></select></label><div className="create-action"><button className="primary-button" type="button" onClick={() => void submit()} disabled={generating || quota === undefined || quota === null}>{generating ? <span className="loading-dot" /> : <Sparkle size={18} weight="fill" />}{generating ? '正在创作' : '开始创作'}</button><span>{quotaUsageText(quota)}</span>{quota === null && <button className="text-button" type="button" onClick={() => void refreshQuota()}><ArrowCounterClockwise size={14} />重新读取额度</button>}</div></div></div></div>{error && <p className="error-message" role="alert">{error}</p>}</div></section>
      <section className="content-section inspiration-section"><div className="section-heading"><h2>从灵感开始</h2><p>选一个方向，提示词会自动准备好</p><button className="heading-link" onClick={() => navigate('inspiration')}>浏览灵感库 <ArrowRight size={16} /></button></div>{featured.length ? <div className="inspiration-grid">{featured.map((item) => <article key={item.id} className={`inspiration-card ${chosenInspiration === item.id ? 'selected' : ''}`} onClick={() => applyInspiration(item)}><img src={studioAssetPath(item.image)} alt={item.title} /><div className="card-shade" />{chosenInspiration === item.id && <span className="selected-mark"><CheckCircle size={18} weight="fill" /> 已选</span>}<div className="card-copy"><h3>{item.title}</h3><p>{item.description}</p></div><button type="button"><Sparkle size={15} weight="fill" /> 使用此灵感</button></article>)}</div> : <div className="recent-empty"><Compass size={25} /><span><strong>灵感正在准备中</strong><small>你仍然可以直接描述想要的画面。</small></span></div>}</section>
      <section className="content-section recent-section"><div className="section-heading recent-heading"><div><h2>最近创作</h2><p>自动保存在作品库，随时继续</p></div><button className="text-button" onClick={() => navigate('works')}>查看全部 <ArrowRight size={17} /></button></div>{tasksError ? <div className="recent-empty"><Images size={25} /><span><strong>作品暂时无法读取</strong><small>{tasksError}</small></span><button className="secondary-button" onClick={() => void refreshTasks()}>重新读取作品</button></div> : tasks === undefined ? <div className="recent-loading">正在读取真实作品…</div> : recent.length ? <div className="recent-grid">{recent.slice(0, 7).map((task) => <button className="recent-item" key={task.id} onClick={() => setSelectedTask(task)}><img src={task.output!.url} alt={task.input.prompt} /><span className="recent-meta"><strong>{task.input.prompt}</strong><small>{formatDate(task.createdAt)}</small></span></button>)}</div> : <div className="recent-empty"><Images size={25} /><span><strong>还没有作品</strong><small>完成第一次创作后会自动保存在这里。</small></span></div>}</section>
      {selectedTask?.output && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </>
  )
}

function InspirationPage({ items, useTemplate }: { items: StudioInspiration[], useTemplate: (item: StudioInspiration) => void }) {
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<StudioInspiration | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const categories = ['全部', ...new Set(items.map((item) => item.category))]
  const filtered = items.filter((item) => (category === '全部' || item.category === category) && `${item.title}${item.description}`.includes(query))
  return <div className="page-frame"><header className="page-hero compact"><span className="eyebrow"><Sparkle size={15} weight="fill" /> 运营精选</span><h1>先找到感觉，再开始创作</h1><p>每个灵感都准备好了画面方向和描述，你只需要换成自己的内容。</p></header><div className="library-toolbar"><div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品、人像、海报…" /></div><div className="filter-scroll">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div><div className="template-grid">{filtered.map((item, idx) => <article className={`template-card template-${idx % 3 + 1}`} key={item.id}><button className={`favorite-button ${favorites.includes(item.id) ? 'active' : ''}`} onClick={() => setFavorites((values) => values.includes(item.id) ? values.filter((id) => id !== item.id) : [...values, item.id])} aria-label={`收藏${item.title}`}><Heart size={18} weight={favorites.includes(item.id) ? 'fill' : 'regular'} /></button><button className="template-image-button" onClick={() => setSelected(item)}><img src={studioAssetPath(item.image)} alt={item.title} /></button><div className="template-info"><span>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p><button onClick={() => useTemplate(item)}>使用灵感 <ArrowRight size={15} /></button></div></article>)}</div>{!filtered.length && <div className="empty-state"><MagnifyingGlass size={30} /><h3>没有找到匹配的灵感</h3><p>{items.length ? '换个关键词或浏览其他分类。' : '灵感内容正在准备中，你可以先直接开始创作。'}</p>{items.length > 0 && <button className="secondary-button" onClick={() => { setQuery(''); setCategory('全部') }}>查看全部</button>}</div>}{selected && <Modal onClose={() => setSelected(null)} className="template-modal"><div className="template-preview"><img src={studioAssetPath(selected.image)} alt={selected.title} /></div><div className="template-detail"><span className="eyebrow">{selected.category}灵感</span><h2>{selected.title}</h2><p>{selected.description}</p><div className="prompt-preview"><small>已经帮你准备好</small><p>{selected.prompt}</p></div><button className="primary-button" onClick={() => useTemplate(selected)}><Sparkle size={18} weight="fill" /> 用这个灵感创作</button></div></Modal>}</div>
}

function WorksPage({
  tasks,
  tasksError,
  refreshTasks,
  addTask,
  removeTask,
  useWork,
}: {
  tasks: StudioGenerationTask[] | undefined
  tasksError: string
  refreshTasks: () => Promise<void>
  addTask: (task: StudioGenerationTask) => void
  removeTask: (id: string) => void
  useWork: (task: StudioGenerationTask | null) => void
}) {
  const [view, setView] = useState<'active' | 'deleted'>('active')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<StudioGenerationTask | null>(null)
  const [deletedTasks, setDeletedTasks] = useState<StudioGenerationTask[]>()
  const [deletedError, setDeletedError] = useState('')
  const visibleTasks = view === 'active' ? tasks : deletedTasks
  const currentError = view === 'active' ? tasksError : deletedError
  const works = useMemo(() => (visibleTasks ?? []).filter((task) => task.output && task.input.prompt.includes(query)), [visibleTasks, query])

  const loadDeletedTasks = async () => {
    setDeletedTasks(undefined)
    setDeletedError('')
    try {
      setDeletedTasks(await listStudioGenerations('deleted'))
    } catch {
      setDeletedError('最近删除暂时无法读取，请重试')
    }
  }

  const switchView = async (next: 'active' | 'deleted') => {
    setView(next)
    setSelected(null)
    setQuery('')
    if (next === 'active') return
    await loadDeletedTasks()
  }

  const deleteTask = async (task: StudioGenerationTask) => {
    const deleted = await deleteStudioGeneration(task.id)
    removeTask(task.id)
    setDeletedTasks((current) => current === undefined ? current : [deleted, ...current.filter((item) => item.id !== task.id)])
    setSelected(null)
  }

  const restoreTask = async (task: StudioGenerationTask) => {
    const restored = await restoreStudioGeneration(task.id)
    setDeletedTasks((current) => (current ?? []).filter((item) => item.id !== task.id))
    addTask(restored)
    setSelected(null)
  }

  return <div className="page-frame">
    <header className="page-title-row"><div><span className="eyebrow">你的创作空间</span><h1>作品库</h1><p>{currentError ? '作品列表读取失败' : visibleTasks === undefined ? '正在读取真实作品…' : view === 'deleted' ? `${works.length} 个作品 · 7 天内可恢复` : `${works.length} 个作品 · 云端自动保存`}</p></div><button className="primary-button" onClick={() => useWork(null)}><Plus size={18} /> 新建创作</button></header>
    <div className="works-toolbar"><div className="segmented-control"><button className={view === 'active' ? 'active' : ''} onClick={() => void switchView('active')}>全部作品</button><button className={view === 'deleted' ? 'active' : ''} onClick={() => void switchView('deleted')}>最近删除</button></div><div className="search-field small"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品" /></div></div>
    {currentError ? <div className="empty-state" role="alert"><Images size={30} /><h3>作品暂时无法读取</h3><p>{currentError}</p><button className="secondary-button" onClick={() => void (view === 'active' ? refreshTasks() : loadDeletedTasks())}>重新读取作品</button></div> : <><div className="works-grid">{works.map((task, idx) => <button className={`work-card work-${idx % 4 + 1}`} key={task.id} onClick={() => setSelected(task)}><img src={task.output!.url} alt={task.input.prompt} /><span className="work-overlay"><strong>{task.input.prompt}</strong><small>{view === 'deleted' && task.purgeAt ? `${formatDate(task.purgeAt)} 后清理` : `${formatDate(task.createdAt)} · ${ratioName(task.input.size)}`}</small><span><Eye size={15} /> 查看详情</span></span></button>)}</div>{visibleTasks !== undefined && !works.length && <div className="empty-state"><Images size={30} /><h3>{view === 'deleted' ? '最近没有删除的作品' : '还没有这样的作品'}</h3><p>{query ? '清空搜索，或者查看其他作品。' : view === 'deleted' ? '删除的作品会在这里保留 7 天。' : '完成第一次创作后，作品会自动出现在这里。'}</p>{query && <button className="secondary-button" onClick={() => setQuery('')}>清空搜索</button>}</div>}</>}
    {selected?.output && <TaskModal task={selected} onClose={() => setSelected(null)} onReuse={view === 'active' ? () => useWork(selected) : undefined} onDelete={view === 'active' ? () => deleteTask(selected) : undefined} onRestore={view === 'deleted' ? () => restoreTask(selected) : undefined} />}
  </div>
}

function QuotaPage({ quota, refreshQuota, navigate }: { quota: StudioQuotaBalance | null | undefined, refreshQuota: () => Promise<void>, navigate: (route: StudioRoute) => void }) {
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
      if (next.payUrl) {
        window.location.assign(next.payUrl)
        return
      }
      setOrder(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '订单创建失败，请稍后重试')
    } finally {
      setBusy('')
    }
  }

  return <div className="page-frame quota-live-page">
    <header className="page-title-row"><div><span className="eyebrow">创作额度</span><h1>额度与方案</h1><p>先使用每日免费次数，用完后再按需购买或订阅。</p></div><button className="secondary-button" onClick={() => navigate('create')}>返回创作</button></header>
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
    {choosingPlan && <Modal onClose={() => setChoosingPlan(null)} className="studio-payment-modal"><div className="studio-payment-result"><span className="eyebrow">选择支付方式</span><h2>{choosingPlan.name}</h2><strong className="studio-plan-price"><small>¥</small>{(choosingPlan.priceCents / 100).toFixed(2)}</strong><div className="payment-methods">{choosingPlan.paymentMethods.map((method) => <button key={method.providerKey} onClick={() => void checkout(choosingPlan, method)}><span className={`payment-logo ${method.providerKey === 'wxpay' ? 'wechat' : 'alipay'}`}>{method.providerKey === 'wxpay' ? '微' : '支'}</span><span><strong>{method.name}</strong><small>{method.providerKey === 'wxpay' ? '微信扫码支付' : '跳转支付宝收银台'}</small></span><ArrowRight size={18} /></button>)}</div></div></Modal>}
    {order && <Modal onClose={() => setOrder(null)} className="studio-payment-modal">
      {order.status === 'completed' ? <div className="studio-payment-result"><CheckCircle size={58} weight="fill" /><span className="eyebrow">支付完成</span><h2>{order.plan.name} 已到账</h2><p>{order.plan.credits} 次创作额度已经加入账户。</p><button className="primary-button" onClick={() => { setOrder(null); navigate('create') }}>开始创作</button></div> : order.status === 'pending' ? <div className="studio-payment-result"><span className="eyebrow">{order.provider === 'wxpay_native' ? '微信扫码支付' : '正在确认支付宝订单'}</span><h2>{order.plan.name}</h2><strong className="studio-plan-price"><small>¥</small>{(order.amountCents / 100).toFixed(2)}</strong>{order.provider === 'wxpay_native' ? qrCode ? <img className="studio-payment-qr" src={qrCode} alt="微信支付二维码" /> : <div className="recent-loading">正在生成支付二维码…</div> : <div className="recent-loading">正在向支付宝查询支付结果…</div>}<p>{order.provider === 'wxpay_native' ? '请使用微信扫码，支付完成后页面会自动更新。' : '支付结果确认后，额度会自动到账。'}</p><small>订单有效至 {new Date(order.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></div> : <div className="studio-payment-result"><X size={48} /><h2>订单未完成</h2><p>{order.status === 'expired' ? '订单已过期，请重新创建。' : '支付渠道暂时没有完成这个订单。'}</p><button className="secondary-button" onClick={() => setOrder(null)}>返回套餐</button></div>}
    </Modal>}
  </div>
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
  return <div className="page-frame settings-page"><header className="page-title-row"><div><span className="eyebrow">个人中心</span><h1>账户设置</h1><p>查看你的 NanaFox Studio 账户资料</p></div></header><div className="settings-layout"><aside className="settings-nav"><button className="active"><User size={18} />账户资料</button></aside><div className="settings-content"><section className="settings-card account-profile-card"><div className="account-profile-heading"><span className="studio-avatar profile">{displayName.slice(0, 1).toUpperCase()}</span><div><h2>{displayName}</h2><p>账户由 NanaFox Studio 登录服务安全管理。</p></div></div><dl className="account-profile-list"><div><dt>显示名称</dt><dd>{displayName}</dd></div><div><dt>登录邮箱</dt><dd>{session.user.email}</dd></div><div><dt>账户标识</dt><dd>{session.user.id}</dd></div></dl><div className="account-security-note"><CheckCircle size={19} weight="fill" /><span><strong>账户已受保护</strong><small>密码、验证码和两步验证由账户服务统一处理。</small></span></div><button className="secondary-button danger-link" disabled={signingOut} onClick={() => void signOut()}><SignOut size={17} />{signingOut ? '正在退出' : '退出登录'}</button></section></div></div></div>
}

function Modal({ children, onClose, className = '' }: { children: ReactNode, onClose: () => void, className?: string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`base-modal ${className}`} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>{children}</section></div>
}

function TaskModal({ task, onClose, onReuse, onDelete, onRestore }: { task: StudioGenerationTask, onClose: () => void, onReuse?: () => void, onDelete?: () => Promise<void>, onRestore?: () => Promise<void> }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!task.output) return null
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试')
      setBusy(false)
    }
  }
  return <Modal onClose={onClose} className="work-modal"><div className="work-preview"><img src={task.output.url} alt={task.input.prompt} /></div><div className="work-detail"><span className="success-label">{onRestore ? <><Trash size={18} /> 最近删除</> : <><CheckCircle size={18} weight="fill" /> 已完成</>}</span><h2>{task.input.prompt}</h2><p>{onRestore && task.purgeAt ? `可在 ${formatDate(task.purgeAt)} 前恢复，之后图片将永久清理。` : `创建于 ${formatDate(task.createdAt)}，作品已安全保存在云端。`}</p><dl><div><dt>画面比例</dt><dd>{ratioName(task.input.size)}</dd></div><div><dt>精细度</dt><dd>{qualityName(task.input.quality)}</dd></div><div><dt>作品状态</dt><dd>{onRestore ? '等待清理' : '仅你可见'}</dd></div></dl>{error && <p className="auth-error work-modal-error" role="alert">{error}</p>}{confirmDelete ? <div className="retention-warning"><strong>确定删除这个作品？</strong><p>作品会进入“最近删除”，7 天内可以恢复。</p><div><button className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button><button className="danger-button" disabled={busy} onClick={() => onDelete && void run(onDelete)}>{busy ? '正在删除…' : '确认删除'}</button></div></div> : <div className="result-actions">{onDelete && <button className="danger-button" onClick={() => setConfirmDelete(true)}><Trash size={17} /> 删除作品</button>}{onReuse && <button className="secondary-button" onClick={onReuse}><Sparkle size={17} /> 复用描述</button>}{onRestore ? <button className="primary-button" disabled={busy} onClick={() => void run(onRestore)}><ArrowCounterClockwise size={18} /> {busy ? '正在恢复…' : '恢复作品'}</button> : <a className="primary-button" href={task.output.url} download><DownloadSimple size={18} /> 下载</a>}</div>}</div></Modal>
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

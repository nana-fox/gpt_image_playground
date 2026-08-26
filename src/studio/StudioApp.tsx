import { useEffect, useState, type FormEvent } from 'react'

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
import {
  createStudioGeneration,
  listStudioGenerations,
  StudioGenerationError,
  type StudioGenerationInput,
  type StudioGenerationTask,
} from '../lib/studioGeneration'
import { getStudioQuota, type StudioQuotaBalance } from '../lib/studioQuota'

type AuthMode = 'login' | 'register' | '2fa'

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

  if (session === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#05070a] text-white">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-[#78a8ff]" aria-label="正在加载" />
      </main>
    )
  }

  if (!session) return <StudioAuthPage initialError={loadError} onAuthenticated={setSession} />
  return <StudioAccountReady session={session} onLogout={() => setSession(null)} />
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
    <main data-studio-auth className="min-h-screen overflow-hidden bg-[#05070a] text-white lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)]">
      <section className="relative hidden min-h-screen overflow-hidden border-r border-white/[0.08] px-14 py-12 lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_26%,rgba(58,116,255,0.35),transparent_34%),radial-gradient(circle_at_78%_72%,rgba(135,73,255,0.22),transparent_30%),linear-gradient(145deg,#070b13_0%,#05070a_64%)]" />
        <div className="absolute left-[16%] top-[25%] h-64 w-64 rounded-full border border-blue-300/15 bg-blue-500/10 blur-[1px]" />
        <div className="absolute left-[32%] top-[34%] h-72 w-48 rotate-12 rounded-[44%_56%_52%_48%] bg-gradient-to-br from-blue-400/45 via-indigo-500/20 to-transparent blur-2xl" />
        <div className="absolute bottom-[18%] right-[12%] h-52 w-72 -rotate-6 rounded-[2.5rem] border border-white/10 bg-white/[0.04] shadow-2xl backdrop-blur-xl" />
        <header className="relative z-10 flex items-center gap-3 text-xl font-semibold tracking-tight">
          <FoxMark />
          <span>NanaFox <span className="font-normal text-white/65">Studio</span></span>
        </header>
        <div className="relative z-10 max-w-xl pb-10">
          <span className="mb-5 inline-flex rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-xs font-medium tracking-[0.14em] text-blue-200">AI IMAGE STUDIO</span>
          <h2 className="text-5xl font-semibold leading-[1.12] tracking-[-0.045em] xl:text-6xl">把脑海里的画面，<br />变成真正的作品。</h2>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300/75">不需要配置 Key，也不用研究复杂参数。从一句描述开始，灵感、创作和作品管理都在这里完成。</p>
        </div>
        <p className="relative z-10 text-xs text-white/35">© 2026 NanaFox. 让 AI 创作更简单。</p>
      </section>

      <section className="relative flex min-h-screen items-center justify-center px-6 py-12 sm:px-10 lg:bg-[#080a0e]">
        <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_50%_0%,rgba(66,114,255,0.12),transparent_70%)] lg:hidden" />
        <div className="relative w-full max-w-[430px]">
          <header className="mb-12 flex items-center gap-3 text-lg font-semibold lg:hidden">
            <FoxMark />
            NanaFox <span className="-ml-2 font-normal text-white/60">Studio</span>
          </header>

          <div className="mb-9">
            <span className="text-sm font-medium text-[#78a8ff]">{mode === 'login' ? '欢迎回来' : mode === 'register' ? '从这里开始创作' : '保护你的账户'}</span>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              {mode === 'login' ? '登录 NanaFox Studio' : mode === 'register' ? '创建账户' : '完成两步验证'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {mode === 'login' ? '继续你的创作和作品管理。' : mode === 'register' ? '使用邮箱注册，不需要配置任何 API Key。' : '请输入身份验证器中显示的 6 位动态验证码。'}
            </p>
          </div>

          <form className="space-y-5" onSubmit={submit}>
            {mode !== '2fa' ? (
              <>
                <AuthField label="邮箱">
                  <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required />
                </AuthField>
                <AuthField label="密码">
                  <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? '输入账户密码' : '至少 8 位，建议包含数字和符号'} minLength={8} required />
                </AuthField>
                {mode === 'register' && (
                  <AuthField label="邮箱验证码">
                    <div className="relative">
                      <input className="pr-32" inputMode="numeric" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" pattern="\d{6}" required />
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-xs font-medium text-[#8eb6ff] transition hover:bg-blue-400/10 disabled:opacity-45" type="button" onClick={() => void sendCode()} disabled={busy || codeSent}>{codeSent ? '已发送' : '发送验证码'}</button>
                    </div>
                  </AuthField>
                )}
              </>
            ) : (
              <AuthField label="两步验证">
                <input className="text-center text-xl tracking-[0.45em]" autoComplete="one-time-code" inputMode="numeric" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" pattern="\d{6}" autoFocus required />
              </AuthField>
            )}

            {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200" role="alert">{error}</p>}

            <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f3f6fc] font-semibold text-[#080a0e] transition hover:bg-white disabled:cursor-wait disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-slate-900" /> : null}
              {mode === 'login' ? '登录' : mode === 'register' ? '注册并开始创作' : '验证并登录'}
            </button>
          </form>

          {mode === '2fa' ? (
            <button className="mt-6 w-full text-center text-sm text-slate-400 hover:text-white" type="button" onClick={() => switchMode('login')}>返回邮箱登录</button>
          ) : (
            <p className="mt-7 text-center text-sm text-slate-400">
              {mode === 'login' ? '还没有账户？' : '已经有账户？'}{' '}
              <button className="font-medium text-[#8eb6ff] hover:text-blue-300" type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
                {mode === 'login' ? '创建账户' : '直接登录'}
              </button>
            </p>
          )}
          <p className="mt-10 text-center text-xs leading-5 text-slate-500">注册或登录即表示你同意《服务条款》和《隐私政策》</p>
        </div>
      </section>
    </main>
  )
}

function StudioAccountReady({ session, onLogout }: { session: StudioSession, onLogout: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<StudioGenerationInput['size']>('1024x1024')
  const [quality, setQuality] = useState<StudioGenerationInput['quality']>('medium')
  const [generating, setGenerating] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<StudioQuotaBalance | null>()
  const [tasks, setTasks] = useState<StudioGenerationTask[]>()
  const [requestKey, setRequestKey] = useState('')

  useEffect(() => {
    let active = true
    void Promise.allSettled([getStudioQuota(), listStudioGenerations()])
      .then(([quotaResult, tasksResult]) => {
        if (!active) return
        setQuota(quotaResult.status === 'fulfilled' ? quotaResult.value : null)
        setTasks(tasksResult.status === 'fulfilled' ? tasksResult.value : [])
        if (tasksResult.status === 'rejected') setError('作品记录暂时无法读取')
      })
    return () => {
      active = false
    }
  }, [])

  const signOut = async () => {
    setSigningOut(true)
    setError('')
    try {
      await logoutStudio()
      onLogout()
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出失败')
    } finally {
      setSigningOut(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!prompt.trim()) return
    setGenerating(true)
    setError('')
    const key = requestKey || crypto.randomUUID()
    setRequestKey(key)
    try {
      const task = await createStudioGeneration({ prompt: prompt.trim(), size, quality }, key)
      setTasks((current) => [task, ...(current ?? []).filter((item) => item.id !== task.id)])
      setQuota(await getStudioQuota())
      setRequestKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '这次创作没有完成，请稍后重试')
      if (!(err instanceof StudioGenerationError) || err.reason !== 'NETWORK_ERROR') setRequestKey('')
    } finally {
      setGenerating(false)
    }
  }

  const resetRequest = () => setRequestKey('')
  const latest = tasks?.[0]

  return (
    <main data-studio-workspace className="min-h-screen bg-[#05070a] text-white">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.08] bg-[#05070a]/90 px-4 backdrop-blur-xl sm:px-8">
        <div className="flex items-center gap-3 text-base font-semibold sm:text-lg"><FoxMark />NanaFox <span className="-ml-2 font-normal text-white/60">Studio</span></div>
        <nav className="hidden items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.035] p-1 text-sm sm:flex" aria-label="主导航">
          <a className="rounded-lg bg-white/[0.09] px-4 py-2 text-white" href="#create">创作</a>
          <a className="rounded-lg px-4 py-2 text-slate-400 transition hover:text-white" href="#works">作品</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-slate-300 sm:inline-flex">{quotaText(quota)}</span>
          <button className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-400 text-sm font-semibold text-slate-900 disabled:opacity-50" type="button" onClick={() => void signOut()} disabled={signingOut} title="退出登录" aria-label="退出登录">
            {(session.user.displayName || session.user.email).slice(0, 1).toUpperCase()}
          </button>
        </div>
      </header>

      <section id="create" className="mx-auto grid max-w-[1480px] gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[390px_minmax(0,1fr)] lg:py-8">
        <form className="rounded-3xl border border-white/[0.08] bg-[#0b0e13] p-5 shadow-2xl shadow-black/20 sm:p-6" onSubmit={submit}>
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#78a8ff]">Create</span>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">开始创作</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">描述你想看到的画面，模型与服务参数由后台统一管理。</p>
          </div>

          <label className="mt-7 block">
            <span className="mb-2 block text-sm font-medium text-slate-300">画面描述</span>
            <textarea className="min-h-40 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400/50 focus:bg-white/[0.05] focus:ring-4 focus:ring-blue-400/10" value={prompt} onChange={(event) => { setPrompt(event.target.value); resetRequest() }} placeholder="例如：月光下的银色狐狸，站在安静的雪原上，电影感光影…" maxLength={10000} required />
            <span className="mt-1 block text-right text-[11px] text-slate-600">{prompt.length}/10000</span>
          </label>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-slate-300">画面比例</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {([
                ['1024x1024', '1:1', '方形'],
                ['1536x1024', '3:2', '横图'],
                ['1024x1536', '2:3', '竖图'],
              ] as const).map(([value, ratio, label]) => (
                <button key={value} className={`rounded-xl border px-3 py-3 text-left transition ${size === value ? 'border-blue-400/60 bg-blue-400/10 text-white' : 'border-white/[0.08] bg-white/[0.025] text-slate-400 hover:border-white/20'}`} type="button" onClick={() => { setSize(value); resetRequest() }}>
                  <span className="block text-sm font-semibold">{ratio}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-slate-300">画面质量</legend>
            <div className="mt-3 grid grid-cols-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
              {([['low', '快速'], ['medium', '标准'], ['high', '精细']] as const).map(([value, label]) => (
                <button key={value} className={`rounded-lg px-3 py-2 text-sm transition ${quality === value ? 'bg-white/[0.1] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`} type="button" onClick={() => { setQuality(value); resetRequest() }}>{label}</button>
              ))}
            </div>
          </fieldset>

          {error && <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200" role="alert">{error}</p>}

          <button className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#78a8ff] to-[#8b77ff] font-semibold text-[#07090d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45" type="submit" disabled={generating || !prompt.trim()}>
            {generating && <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700/30 border-t-slate-900" />}
            {generating ? '正在创作…' : '生成图像'}
          </button>
          <p className="mt-3 text-center text-xs text-slate-600">每次生成 1 张 · {quotaText(quota)}</p>
        </form>

        <div className="min-h-[560px] overflow-hidden rounded-3xl border border-white/[0.08] bg-[#090c11]">
          {latest?.output ? (
            <div className="relative flex h-full min-h-[560px] items-center justify-center bg-[radial-gradient(circle_at_50%_10%,rgba(90,126,255,0.12),transparent_44%)] p-4 sm:p-8">
              <img className="max-h-[720px] w-auto max-w-full rounded-2xl object-contain shadow-2xl shadow-black/50" src={latest.output.url} alt={latest.input.prompt} />
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur-xl sm:inset-x-8 sm:bottom-8">
                <p className="line-clamp-2 text-sm leading-6 text-slate-200">{latest.input.prompt}</p>
                <p className="mt-1 text-xs text-slate-500">{latest.input.size} · {qualityName(latest.input.quality)}</p>
              </div>
            </div>
          ) : latest && latest.status !== 'failed' ? (
            <div className="flex min-h-[560px] flex-col items-center justify-center px-8 text-center">
              <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-[#78a8ff]" />
              <h2 className="mt-6 text-lg font-semibold">作品正在生成</h2>
              <p className="mt-2 text-sm text-slate-500">完成后会自动保存在你的作品中。</p>
            </div>
          ) : (
            <div className="relative flex min-h-[560px] flex-col items-center justify-center overflow-hidden px-8 text-center">
              <div className="absolute h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-300/15 bg-blue-300/[0.07] text-3xl text-blue-200">✦</span>
              <h2 className="relative mt-6 text-xl font-semibold">你的画布已经准备好</h2>
              <p className="relative mt-2 max-w-sm text-sm leading-6 text-slate-500">写下一个具体的场景、主体与氛围，从第一张作品开始。</p>
            </div>
          )}
        </div>
      </section>

      <section id="works" className="mx-auto max-w-[1480px] px-4 pb-16 pt-8 sm:px-8">
        <div className="flex items-end justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#78a8ff]">Library</span>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">我的作品</h2>
          </div>
          <span className="text-xs text-slate-500">仅你自己可见</span>
        </div>

        {tasks === undefined ? (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="aspect-square animate-pulse rounded-2xl bg-white/[0.04]" />)}
          </div>
        ) : tasks.filter((task) => task.output).length ? (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tasks.filter((task) => task.output).map((task) => (
              <article key={task.id} className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0e13]">
                <div className="aspect-square overflow-hidden bg-white/[0.025]"><img className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" src={task.output!.url} alt={task.input.prompt} loading="lazy" /></div>
                <div className="p-3.5">
                  <p className="line-clamp-1 text-sm text-slate-200">{task.input.prompt}</p>
                  <p className="mt-1 text-[11px] text-slate-600">{new Date(task.createdAt).toLocaleDateString('zh-CN')} · {qualityName(task.input.quality)}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center text-sm text-slate-500">完成的作品会出现在这里。</div>
        )}
      </section>
    </main>
  )
}

function quotaText(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '正在读取真实额度…'
  if (quota === null) return '额度暂时无法读取'
  if (quota.subscriber) return `${quota.planId?.toUpperCase()} 套餐 · 剩余 ${quota.credits} 次`
  if (quota.free.eligible && quota.free.enabled) {
    const paid = quota.credits > 0 ? ` · 购买或订阅额度 ${quota.credits} 次` : ''
    return `今日免费剩余 ${quota.free.remaining}/${quota.free.limit} 次${paid}`
  }
  return quota.credits > 0 ? `购买或订阅额度 ${quota.credits} 次` : '免费体验暂未开放'
}

function qualityName(quality: StudioGenerationInput['quality']) {
  if (quality === 'low') return '快速'
  if (quality === 'high') return '精细'
  return '标准'
}

function AuthField({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>
      <div className="[&_input]:h-12 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-white/10 [&_input]:bg-white/[0.045] [&_input]:px-4 [&_input]:text-sm [&_input]:text-white [&_input]:outline-none [&_input]:transition [&_input]:placeholder:text-slate-600 [&_input]:focus:border-blue-400/60 [&_input]:focus:bg-white/[0.06] [&_input]:focus:ring-4 [&_input]:focus:ring-blue-400/10">{children}</div>
    </label>
  )
}

function FoxMark() {
  return (
    <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#8cb7ff] via-[#5d7cff] to-[#8c5cff] shadow-[0_8px_30px_rgba(81,115,255,0.28)]">
      <svg viewBox="0 0 32 32" className="h-6 w-6 fill-none stroke-white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 8.5 12 11l4-2 4 2 5-2.5-1.4 10.2L16 25l-7.6-6.3L7 8.5Z" />
        <path d="m12.5 17 3.5 2.4 3.5-2.4M16 19.5V23" />
      </svg>
    </span>
  )
}

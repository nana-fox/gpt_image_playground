import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle, MagnifyingGlass, Plus, Sparkle, User } from '@phosphor-icons/react'

import {
  getStudioQuotaPolicy,
  grantStudioCredits,
  searchStudioUsers,
  updateStudioQuotaPolicy,
  type StudioAdminSession,
  type StudioAdminUser,
  type StudioQuotaPolicy,
} from '../lib/studioAdmin'

export default function StudioAdminPage({ admin, onExit }: { admin: StudioAdminSession, onExit: () => void }) {
  const [policy, setPolicy] = useState<StudioQuotaPolicy>()
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<StudioAdminUser[]>([])
  const [selected, setSelected] = useState<StudioAdminUser | null>(null)
  const [units, setUnits] = useState(10)
  const [reference, setReference] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getStudioQuotaPolicy()
      .then(setPolicy)
      .catch((err) => setError(err instanceof Error ? err.message : '免费额度配置加载失败'))
  }, [])

  const savePolicy = async () => {
    if (!policy) return
    setBusy('policy')
    setError('')
    setMessage('')
    try {
      setPolicy(await updateStudioQuotaPolicy(policy))
      setMessage('每日免费额度已更新，新的创作请求会立即使用这套配置。')
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

  const grant = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) {
      setError('请先选择一个用户')
      return
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '额度发放失败')
    } finally {
      setBusy('')
    }
  }

  return <div className="page-frame studio-admin-page">
    <header className="page-title-row admin-title"><div><span className="eyebrow">NANAFOX OPERATIONS</span><h1>运营管理</h1><p>当前操作者：{admin.user.displayName || admin.user.email}。所有修改均由服务端鉴权并写入审计记录。</p></div><button className="secondary-button" onClick={onExit}><ArrowLeft size={17} /> 返回创作端</button></header>
    {error && <p className="auth-error studio-admin-notice" role="alert">{error}</p>}
    {message && <p className="studio-admin-success" role="status"><CheckCircle size={18} weight="fill" />{message}</p>}
    <div className="studio-admin-grid">
      <section className="admin-card">
        <div className="panel-heading"><div><h2>每日免费额度</h2><p>默认每天 3 次，可随时开关或调整；已订阅用户不叠加免费次数。</p></div><span className="metric-icon"><Sparkle size={21} /></span></div>
        {policy ? <div className="studio-admin-form">
          <label className="studio-admin-toggle"><span><strong>启用每日免费创作</strong><small>关闭后，用户只能使用购买或订阅额度。</small></span><input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /></label>
          <label><span>每位免费用户每天次数</span><input type="number" min="0" max="1000" value={policy.dailyLimit} onChange={(event) => setPolicy({ ...policy, dailyLimit: Number(event.target.value) })} /></label>
          <label><span>每日重置时区</span><input value={policy.timezone} readOnly /><small>首发固定为 Asia/Shanghai，避免当天切换时区重复领额度。</small></label>
          <button className="primary-button" disabled={busy === 'policy'} onClick={() => void savePolicy()}>{busy === 'policy' ? '正在保存…' : '保存免费额度配置'}</button>
        </div> : <div className="recent-loading">正在读取真实配置…</div>}
      </section>
      <section className="admin-card">
        <div className="panel-heading"><div><h2>给单个用户增加额度</h2><p>按邮箱或昵称查询，选择用户后发放；相同业务编号不会重复加额。</p></div><span className="metric-icon"><Plus size={21} /></span></div>
        <form className="studio-admin-search" onSubmit={search}><div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="邮箱或昵称" /></div><button className="secondary-button" disabled={busy === 'search'}>{busy === 'search' ? '查询中…' : '查询用户'}</button></form>
        <div className="studio-admin-users">{users.map((user) => <button type="button" key={user.id} className={selected?.id === user.id ? 'active' : ''} onClick={() => setSelected(user)}><span className="studio-avatar"><User size={16} /></span><span><strong>{user.displayName || '未设置昵称'}</strong><small>{user.email}</small></span>{selected?.id === user.id && <CheckCircle size={18} weight="fill" />}</button>)}</div>
        {users.length === 0 && query && busy !== 'search' && <p className="studio-admin-empty">没有匹配用户，请确认该用户已登录过 Studio。</p>}
        <form className="studio-admin-form studio-grant-form" onSubmit={grant}>
          <label><span>增加次数</span><input type="number" min="1" max="100000" value={units} onChange={(event) => setUnits(Number(event.target.value))} required /></label>
          <label><span>业务编号 / 原因标识</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="例如 support-20260827-001" maxLength={200} required /><small>作为幂等键和审计依据，提交后不要复用给其他发放。</small></label>
          <label><span>有效期（可选）</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <button className="primary-button" disabled={!selected || busy === 'grant'}>{busy === 'grant' ? '正在发放…' : selected ? `给 ${selected.email} 增加额度` : '请先选择用户'}</button>
        </form>
      </section>
    </div>
  </div>
}

import type { ApiProfile, AppSettings } from '../types'
import { clearEmbeddedStorageUserId, isNanafoxEmbedded, setEmbeddedStorageUserId } from './deploymentFlavor'

const LEGACY_QUERY_KEYS = ['token', 'theme', 'lang', 'ui_mode', 'user_id', 'src_host', 'src_url']
const LAUNCH_FRAGMENT_KEYS = ['launch', 'theme', 'lang', 'ui_mode', 'src_host', 'src_url']

export interface EmbeddedPublicContext {
  theme: string
  lang: string
  uiMode: string
  userId: string
  srcHost: string
  srcUrl: string
  origin: string
}

export interface EmbeddedPublicKey {
  id: string
  name: string
}

export type EmbeddedSessionStatus = 'inactive' | 'loading' | 'auth-error' | 'load-error' | 'no-eligible-key' | 'selection-required' | 'ready'

export interface EmbeddedSessionState {
  status: EmbeddedSessionStatus
  keys: EmbeddedPublicKey[]
  selectedKeyId: string | null
  message?: string
}

interface EmbeddedContext extends EmbeddedPublicContext {
  launchTicket: string
  sessionToken: string
  role: string
  scope: string
}

interface EmbeddedRawKey extends EmbeddedPublicKey {
  value: string
}

interface RootElement {
  lang: string
  classList: Pick<DOMTokenList, 'toggle'>
}

interface EmbeddedSource {
  srcHost: string
  srcUrl: string
}

let context: EmbeddedContext | null = null
let rawKeys = new Map<string, EmbeddedRawKey>()
let rejectedKeyIds = new Set<string>()
let state: EmbeddedSessionState = { status: 'inactive', keys: [], selectedKeyId: null }
const listeners = new Set<() => void>()

function publish(next: EmbeddedSessionState) {
  state = next
  for (const listener of listeners) listener()
  return state
}

function clearKeys(next: EmbeddedSessionState) {
  rawKeys = new Map()
  return publish(next)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getSafeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function getEmbeddedSource(origin: string, value: unknown): EmbeddedSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.srcHost !== 'string' || typeof record.srcUrl !== 'string') return null
  const srcHost = record.srcHost.trim()
  const srcUrl = record.srcUrl.trim()
  const source = getSafeHttpUrl(srcHost)
  const reopen = getSafeHttpUrl(srcUrl)
  if (!source || !reopen || source.origin !== origin || reopen.origin !== origin) return null
  return { srcHost, srcUrl }
}

export function initializeEmbeddedContext(
  href = window.location.href,
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void = window.history.replaceState.bind(window.history),
  root: RootElement = document.documentElement,
  embedded = isNanafoxEmbedded(),
  historyState?: unknown,
): EmbeddedPublicContext | null {
  if (!embedded) {
    clearEmbeddedSession()
    return null
  }

  clearEmbeddedStorageUserId()
  const url = new URL(href)
  const params = url.searchParams
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
  const savedHistoryState = historyState === undefined && typeof window !== 'undefined'
    ? window.history.state
    : historyState
  const fragmentSource = getEmbeddedSource(url.origin, {
    srcHost: fragment.get('src_host') ?? '',
    srcUrl: fragment.get('src_url') ?? '',
  })
  const savedSource = getEmbeddedSource(
    url.origin,
    savedHistoryState && typeof savedHistoryState === 'object' && !Array.isArray(savedHistoryState)
      ? (savedHistoryState as Record<string, unknown>).nanafoxEmbeddedSource
      : null,
  )
  const fragmentHasSource = fragment.has('src_host') || fragment.has('src_url')
  const source = fragmentHasSource ? fragmentSource : savedSource

  context = {
    launchTicket: fragment.get('launch')?.trim() ?? '',
    sessionToken: '',
    role: '',
    scope: '',
    theme: fragment.get('theme')?.trim() ?? params.get('theme')?.trim() ?? '',
    lang: fragment.get('lang')?.trim() ?? params.get('lang')?.trim() ?? '',
    uiMode: fragment.get('ui_mode')?.trim() ?? params.get('ui_mode')?.trim() ?? '',
    userId: '',
    srcHost: source?.srcHost ?? '',
    srcUrl: source?.srcUrl ?? '',
    origin: url.origin,
  }
  rawKeys = new Map()
  rejectedKeyIds = new Set()
  publish({ status: 'inactive', keys: [], selectedKeyId: null })

  if (context.theme === 'dark' || context.theme === 'light') root.classList.toggle('dark', context.theme === 'dark')
  if (context.lang) root.lang = context.lang

  const hadLegacyContext = LEGACY_QUERY_KEYS.some((key) => params.has(key))
  const hadLaunchContext = LAUNCH_FRAGMENT_KEYS.some((key) => fragment.has(key))
  for (const key of LEGACY_QUERY_KEYS) params.delete(key)
  if (hadLegacyContext || hadLaunchContext) {
    const search = params.toString()
    replaceState(source ? { nanafoxEmbeddedSource: source } : null, '', `${url.pathname}${search ? `?${search}` : ''}${hadLaunchContext ? '' : url.hash}`)
  }

  return getEmbeddedContext()
}

export function getEmbeddedContext(): EmbeddedPublicContext | null {
  if (!context) return null
  return {
    theme: context.theme,
    lang: context.lang,
    uiMode: context.uiMode,
    userId: context.userId,
    srcHost: context.srcHost,
    srcUrl: context.srcUrl,
    origin: context.origin,
  }
}

export function isEmbeddedSessionActive() {
  return context !== null
}

export function getEmbeddedSessionState() {
  return state
}

export function hasEmbeddedRuntimeKey() {
  return state.status === 'ready' && Boolean(state.selectedKeyId && rawKeys.has(state.selectedKeyId))
}

export function subscribeEmbeddedSession(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearEmbeddedSession() {
  context = null
  rawKeys = new Map()
  rejectedKeyIds = new Set()
  clearEmbeddedStorageUserId()
  publish({ status: 'inactive', keys: [], selectedKeyId: null })
}

export async function bootstrapEmbeddedSession(selectedKeyId: string | null | undefined, request: typeof fetch = fetch) {
  if (!context) return state
  if (!context.launchTicket) {
    return clearKeys({
      status: 'auth-error',
      keys: [],
      selectedKeyId: null,
      message: '嵌入会话缺少启动凭证，请重新打开菜单。',
    })
  }

  publish({ status: 'loading', keys: [], selectedKeyId: null })
  try {
    const response = await request('/api/v1/image-creation/sessions', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: context.launchTicket }),
      cache: 'no-store',
    })
    context.launchTicket = ''
    if (response.status === 401 || response.status === 403) {
      return clearKeys({ status: 'auth-error', keys: [], selectedKeyId: null, message: '嵌入会话已失效，请重新打开菜单。' })
    }
    if (!response.ok) throw new Error(`嵌入会话加载失败：HTTP ${response.status}`)

    const payload = await response.json() as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('嵌入会话响应格式无效')
    const envelope = payload as Record<string, unknown>
    if (envelope.code !== 0 || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) throw new Error('嵌入会话响应格式无效')
    const data = envelope.data as Record<string, unknown>
    const viewer = data.viewer
    if (!viewer || typeof viewer !== 'object' || Array.isArray(viewer)) throw new Error('嵌入会话用户格式无效')
    const viewerRecord = viewer as Record<string, unknown>
    const userId = typeof viewerRecord.id === 'number' || typeof viewerRecord.id === 'string' ? String(viewerRecord.id).trim() : ''
    const sessionToken = typeof data.session_token === 'string' ? data.session_token.trim() : ''
    const role = typeof viewerRecord.role === 'string' ? viewerRecord.role.trim() : ''
    const scope = typeof viewerRecord.scope === 'string' ? viewerRecord.scope.trim() : ''
    if (!/^[1-9]\d*$/.test(userId) || !sessionToken || !['user', 'admin'].includes(scope) || !Array.isArray(data.api_keys)) throw new Error('嵌入会话响应格式无效')

    const loaded: EmbeddedRawKey[] = []
    for (const item of data.api_keys) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('API Key 记录格式无效')
      const key = item as Record<string, unknown>
      const id = typeof key.id === 'number' || typeof key.id === 'string' ? String(key.id).trim() : ''
      const value = typeof key.key === 'string' ? key.key.trim() : ''
      if (!id || !value || loaded.some((entry) => entry.id === id)) throw new Error('API Key 记录格式无效')
      if (rejectedKeyIds.has(id)) continue
      loaded.push({ id, name: typeof key.name === 'string' && key.name.trim() ? key.name.trim() : `API Key ${id}`, value })
    }

    context.userId = userId
    context.role = role
    context.scope = scope
    context.sessionToken = sessionToken
    setEmbeddedStorageUserId(userId)
    rawKeys = new Map(loaded.map((key) => [key.id, key]))
    const keys = loaded.map(({ id, name }) => ({ id, name }))
    if (!keys.length) return publish({ status: 'no-eligible-key', keys, selectedKeyId: null })
    const savedId = selectedKeyId ? String(selectedKeyId) : null
    const resolvedId = savedId ? rawKeys.has(savedId) ? savedId : null : keys.length === 1 ? keys[0].id : null
    if (!resolvedId) return publish({ status: 'selection-required', keys, selectedKeyId: null })
    return publish({ status: 'ready', keys, selectedKeyId: resolvedId })
  } catch (error) {
    return clearKeys({ status: 'load-error', keys: [], selectedKeyId: null, message: getErrorMessage(error) })
  }
}

export async function loadEmbeddedKeys(selectedKeyId: string | null | undefined, request: typeof fetch = fetch) {
  if (!context) return state
  if (context.launchTicket) return bootstrapEmbeddedSession(selectedKeyId, request)
  const savedId = selectedKeyId ? String(selectedKeyId) : ''
  if (savedId && rawKeys.has(savedId) && state.selectedKeyId !== savedId) {
    return publish({ status: 'ready', keys: state.keys, selectedKeyId: savedId })
  }
  return state
}

export function getEmbeddedSessionAuthorization() {
  return context?.sessionToken ? `Bearer ${context.sessionToken}` : null
}

export function getEmbeddedSessionScope() {
  return context?.scope ?? ''
}

export function invalidateEmbeddedSession(message = '嵌入会话已失效，请返回 NanaFox 后重新打开。') {
  if (context) context.sessionToken = ''
  return clearKeys({ status: 'auth-error', keys: [], selectedKeyId: null, message })
}

export function selectEmbeddedKey(id: string) {
  if (!rawKeys.has(id)) return false
  publish({ status: 'ready', keys: state.keys, selectedKeyId: id })
  return true
}

export function invalidateEmbeddedSelectedKey() {
  if (!state.selectedKeyId) return false
  rejectedKeyIds.add(state.selectedKeyId)
  rawKeys.delete(state.selectedKeyId)
  const keys = state.keys.filter((key) => key.id !== state.selectedKeyId)
  const selectedKeyId = keys.length === 1 ? keys[0].id : null
  publish({
    status: selectedKeyId ? 'ready' : keys.length ? 'selection-required' : 'no-eligible-key',
    keys,
    selectedKeyId,
  })
  return true
}

export function resolveEmbeddedApiProfile(profile: ApiProfile): ApiProfile {
  if (!context) return profile
  if (state.status !== 'ready' || !state.selectedKeyId) throw new Error('请选择一个可用的 Sub2API API Key')
  const key = rawKeys.get(state.selectedKeyId)
  if (!key) throw new Error('选择的 Sub2API API Key 已不可用，请重新选择')
  return {
    ...profile,
    name: key.name,
    provider: 'openai',
    baseUrl: `${context.origin}/v1`,
    apiKey: key.value,
    model: 'gpt-image-2',
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
  }
}

export function sanitizeEmbeddedProfiles(profiles: ApiProfile[]) {
  if (!isEmbeddedSessionActive() && !isNanafoxEmbedded()) return profiles
  return profiles.map((profile) => ({ ...profile, apiKey: '' }))
}

export function sanitizeEmbeddedSettings(settings: AppSettings): AppSettings {
  if (!isEmbeddedSessionActive() && !isNanafoxEmbedded()) return settings
  return { ...settings, apiKey: '', profiles: sanitizeEmbeddedProfiles(settings.profiles) }
}

export function getEmbeddedKeysUrl() {
  const source = context ? getSafeHttpUrl(context.srcHost) : null
  return source ? new URL('/user/keys', source.origin).toString() : null
}

export function getEmbeddedReopenUrl() {
  if (!context) return null
  const source = getSafeHttpUrl(context.srcHost)
  const reopen = getSafeHttpUrl(context.srcUrl)
  if (!source || !reopen || source.origin !== context.origin || reopen.origin !== context.origin) return null
  return reopen.toString()
}

import type { ApiProfile, AppSettings } from '../types'
import { isNanafoxEmbedded } from './deploymentFlavor'

const EMBEDDED_CONTEXT_KEYS = ['token', 'theme', 'lang', 'ui_mode', 'user_id', 'src_host', 'src_url']
const KEY_PAGE_SIZE = 100

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
  token: string
}

interface EmbeddedRawKey extends EmbeddedPublicKey {
  value: string
}

interface RootElement {
  lang: string
  classList: Pick<DOMTokenList, 'toggle'>
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

export function initializeEmbeddedContext(
  href = window.location.href,
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void = window.history.replaceState.bind(window.history),
  root: RootElement = document.documentElement,
  embedded = isNanafoxEmbedded(),
): EmbeddedPublicContext | null {
  if (!embedded) {
    clearEmbeddedSession()
    return null
  }

  const url = new URL(href)
  const params = url.searchParams
  context = {
    token: params.get('token')?.trim() ?? '',
    theme: params.get('theme')?.trim() ?? '',
    lang: params.get('lang')?.trim() ?? '',
    uiMode: params.get('ui_mode')?.trim() ?? '',
    userId: params.get('user_id')?.trim() ?? '',
    srcHost: params.get('src_host')?.trim() ?? '',
    srcUrl: params.get('src_url')?.trim() ?? '',
    origin: url.origin,
  }
  rawKeys = new Map()
  rejectedKeyIds = new Set()
  publish({ status: 'inactive', keys: [], selectedKeyId: null })

  if (context.theme === 'dark' || context.theme === 'light') {
    root.classList.toggle('dark', context.theme === 'dark')
  }
  if (context.lang) root.lang = context.lang

  const hadContext = EMBEDDED_CONTEXT_KEYS.some((key) => params.has(key))
  for (const key of EMBEDDED_CONTEXT_KEYS) params.delete(key)
  if (hadContext) {
    const search = params.toString()
    replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
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
  publish({ status: 'inactive', keys: [], selectedKeyId: null })
}

export async function loadEmbeddedKeys(selectedKeyId: string | null | undefined, request: typeof fetch = fetch) {
  if (!context) return state
  if (!context.token) {
    return clearKeys({
      status: 'auth-error',
      keys: [],
      selectedKeyId: null,
      message: '嵌入会话缺少身份凭证，请重新打开菜单。',
    })
  }

  publish({ status: 'loading', keys: [], selectedKeyId: null })
  try {
    const loaded: EmbeddedRawKey[] = []
    let page = 1
    let pages = 1

    do {
      const response = await request(`/api/v1/keys?page=${page}&page_size=${KEY_PAGE_SIZE}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${context.token}`,
        },
        cache: 'no-store',
      })
      if (response.status === 401 || response.status === 403) {
        return clearKeys({
          status: 'auth-error',
          keys: [],
          selectedKeyId: null,
          message: '嵌入会话已失效，请重新打开菜单。',
        })
      }
      if (!response.ok) throw new Error(`API Key 列表加载失败：HTTP ${response.status}`)

      const payload = await response.json() as unknown
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('API Key 列表响应格式无效')
      const record = payload as Record<string, unknown>
      if (record.code !== 0 || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) {
        throw new Error('API Key 列表响应格式无效')
      }
      const data = record.data as Record<string, unknown>
      if (!Array.isArray(data.items) || !Number.isInteger(data.page) || !Number.isInteger(data.pages)) {
        throw new Error('API Key 列表响应格式无效')
      }
      if (data.page !== page || (data.pages as number) < 1 || (data.pages as number) > 1000) {
        throw new Error('API Key 列表分页信息无效')
      }
      pages = data.pages as number

      for (const item of data.items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('API Key 记录格式无效')
        const key = item as Record<string, unknown>
        if (key.status !== 'active') continue
        const id = typeof key.id === 'number' || typeof key.id === 'string' ? String(key.id).trim() : ''
        const value = typeof key.key === 'string' ? key.key.trim() : ''
        if (!id || !value || loaded.some((entry) => entry.id === id)) throw new Error('API Key 记录格式无效')
        if (rejectedKeyIds.has(id)) continue
        loaded.push({
          id,
          name: typeof key.name === 'string' && key.name.trim() ? key.name.trim() : `API Key ${id}`,
          value,
        })
      }
      page++
    } while (page <= pages)

    rawKeys = new Map(loaded.map((key) => [key.id, key]))
    const keys = loaded.map(({ id, name }) => ({ id, name }))
    if (!keys.length) return publish({ status: 'no-eligible-key', keys, selectedKeyId: null })

    const savedId = selectedKeyId ? String(selectedKeyId) : null
    const resolvedId = savedId
      ? rawKeys.has(savedId) ? savedId : null
      : keys.length === 1 ? keys[0].id : null
    if (!resolvedId) return publish({ status: 'selection-required', keys, selectedKeyId: null })
    return publish({ status: 'ready', keys, selectedKeyId: resolvedId })
  } catch (error) {
    return clearKeys({
      status: 'load-error',
      keys: [],
      selectedKeyId: null,
      message: getErrorMessage(error),
    })
  }
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
  publish({
    status: 'selection-required',
    keys: state.keys.filter((key) => key.id !== state.selectedKeyId),
    selectedKeyId: null,
  })
  return true
}

export function resolveEmbeddedApiProfile(profile: ApiProfile): ApiProfile {
  if (!context) return profile
  if (state.status !== 'ready' || !state.selectedKeyId) {
    throw new Error('请选择一个可用的 Sub2API API Key')
  }
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
  return {
    ...settings,
    apiKey: '',
    profiles: sanitizeEmbeddedProfiles(settings.profiles),
  }
}

export function getEmbeddedKeysUrl() {
  const source = context ? getSafeHttpUrl(context.srcHost) : null
  return source ? new URL('/user/keys', source.origin).toString() : null
}

export function getEmbeddedReopenUrl() {
  if (!context) return null
  const source = getSafeHttpUrl(context.srcHost)
  const reopen = getSafeHttpUrl(context.srcUrl)
  if (!source || !reopen || source.origin !== reopen.origin) return null
  return reopen.toString()
}

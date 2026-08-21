import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import {
  getEmbeddedKeysUrl,
  getEmbeddedReopenUrl,
  getEmbeddedSessionState,
  loadEmbeddedKeys,
  selectEmbeddedKey,
  subscribeEmbeddedSession,
} from '../lib/embeddedSession'

export default function EmbeddedKeySelector() {
  const session = useSyncExternalStore(subscribeEmbeddedSession, getEmbeddedSessionState)
  const selectedKeyId = useStore((state) => state.settings.selectedKeyId)
  const setSettings = useStore((state) => state.setSettings)

  useEffect(() => {
    if (session.status === 'ready' && session.selectedKeyId !== selectedKeyId) {
      setSettings({ selectedKeyId: session.selectedKeyId })
    }
  }, [selectedKeyId, session.selectedKeyId, session.status, setSettings])

  if (session.status === 'inactive') return null

  if (session.status === 'loading') {
    return <span className="hidden text-xs text-gray-500 sm:inline">正在加载 API Key…</span>
  }

  if (session.status === 'no-eligible-key') {
    const url = getEmbeddedKeysUrl()
    return url ? (
      <a className="text-xs font-medium text-amber-600 hover:underline" href={url} target="_top">创建 API Key</a>
    ) : <span className="text-xs text-amber-600">没有可用的 API Key</span>
  }

  if (session.status === 'auth-error') {
    const url = getEmbeddedReopenUrl()
    return url ? (
      <a className="text-xs font-medium text-red-600 hover:underline" href={url} target="_top">重新打开菜单</a>
    ) : <span className="text-xs text-red-600">嵌入会话已失效</span>
  }

  if (session.status === 'load-error') {
    return (
      <button
        type="button"
        className="text-xs font-medium text-red-600 hover:underline"
        onClick={() => void loadEmbeddedKeys(selectedKeyId)}
      >
        API Key 加载失败，重试
      </button>
    )
  }

  if (session.keys.length === 1) {
    return <span className="hidden max-w-40 truncate text-xs text-gray-500 sm:inline" title={session.keys[0].name}>{session.keys[0].name}</span>
  }

  return (
    <select
      aria-label="Sub2API API Key"
      className="max-w-40 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200"
      value={session.selectedKeyId ?? ''}
      onChange={(event) => {
        if (!selectEmbeddedKey(event.target.value)) return
        setSettings({ selectedKeyId: event.target.value })
      }}
    >
      <option value="" disabled>选择 API Key</option>
      {session.keys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}
    </select>
  )
}

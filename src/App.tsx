import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { initStore, restoreExplicitPresetConfig, useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, getExplicitUrlSettingsIds, hasUrlSettingParams } from './lib/urlSettings'
import { createDefaultOpenAIProfile, hasDefaultPresetConfig, isAgentTextApiProfile, normalizeSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, hasEmbeddedDefaultConfig, loadCustomProviderSettingsFromUrl, loadEmbeddedDefaultConfig } from './lib/customProviderConfigUrl'
import { getDefaultPresetProfileId, getPresetProfileIds, isPresetConfigOnlyEnabled, setPresetConfig } from './lib/presetConfig'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import ImageCreationAdmin from './components/ImageCreationAdmin'
import ImageCreationUser from './components/ImageCreationUser'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { getEmbeddedSessionScope, getEmbeddedSessionState, loadEmbeddedKeys, subscribeEmbeddedSession } from './lib/embeddedSession'
import { isEmbeddedFeatureEnabled } from './lib/deploymentFlavor'

let defaultConfigImportStarted = false
const EMBEDDED_BUILD = import.meta.env.VITE_DEPLOYMENT_FLAVOR === 'nanafox-embedded'
const AgentWorkspace = EMBEDDED_BUILD ? null : lazy(() => import('./components/AgentWorkspace'))
const SettingsModal = EMBEDDED_BUILD ? null : lazy(() => import('./components/SettingsModal'))
const SupportPromptModal = EMBEDDED_BUILD ? null : lazy(() => import('./components/SupportPromptModal'))

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const agentEnabled = isEmbeddedFeatureEnabled('agent')
  const settingsEnabled = isEmbeddedFeatureEnabled('settings')
  const supportPromptEnabled = isEmbeddedFeatureEnabled('support-prompt')
  const configTransferEnabled = isEmbeddedFeatureEnabled('config-transfer')
  const embeddedSession = useSyncExternalStore(subscribeEmbeddedSession, getEmbeddedSessionState)
  const embeddedAdmin = EMBEDDED_BUILD && getEmbeddedSessionScope() === 'admin'
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    if (defaultConfigImportStarted) return
    defaultConfigImportStarted = true

    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = configTransferEnabled ? getCustomProviderConfigUrl() : null
    const embeddedDefaultConfig = configTransferEnabled && hasEmbeddedDefaultConfig()
    const loadDefaultConfig = () => embeddedDefaultConfig
      ? Promise.resolve().then(() => loadEmbeddedDefaultConfig())
      : customProviderConfigUrl
        ? loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        : Promise.resolve(null)

    const applyUrlSettings = async (baseSettings: Partial<AppSettings>) => {
      const ids = configTransferEnabled ? getExplicitUrlSettingsIds(searchParams) : { providerIds: [], profileIds: [] }
      const restored = configTransferEnabled && await restoreExplicitPresetConfig(ids)
      const restoredSettings = useStore.getState().settings
      const sourceSettings = restored
        ? { ...restoredSettings, ...baseSettings, customProviders: restoredSettings.customProviders, profiles: restoredSettings.profiles }
        : baseSettings
      const nextSettings = buildSettingsFromUrlParams(sourceSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : sourceSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    void initStore()
      .then(async () => {
        const importedSettings = embeddedDefaultConfig || customProviderConfigUrl
          ? await loadDefaultConfig()
          : configTransferEnabled && hasDefaultPresetConfig()
            ? {
                customProviders: [],
                profiles: [{ ...createDefaultOpenAIProfile(), isDefault: true }],
              }
            : null
        setPresetConfig(importedSettings)

        const state = useStore.getState()
        if (importedSettings) {
          await state.setPresetImportedSettings(importedSettings)
        } else if (state.previousPresetConfig) {
          await state.setPresetImportedSettings({ customProviders: [], profiles: [] })
        }

        const syncedState = useStore.getState()
        if (!importedSettings) {
          useStore.setState({ dismissedPresetProfileIds: [], dismissedPresetProviderIds: [] })
          if (syncedState.settings.profiles.some((profile) => profile.isDefault)) {
            syncedState.setSettings({
              profiles: syncedState.settings.profiles.map((profile) => profile.isDefault ? { ...profile, isDefault: undefined } : profile),
            })
          }
        }

        const current = useStore.getState()
        const presetIds = getPresetProfileIds()
        const defaultPresetId = getDefaultPresetProfileId()
        const settings = isPresetConfigOnlyEnabled()
          ? normalizeSettings({
              ...current.settings,
              activeProfileId: presetIds.has(current.settings.activeProfileId)
                ? current.settings.activeProfileId
                : defaultPresetId ?? [...presetIds][0],
              agentTextProfileId: current.settings.agentTextProfileId && presetIds.has(current.settings.agentTextProfileId)
                ? current.settings.agentTextProfileId
                : current.settings.profiles.find((profile) => presetIds.has(profile.id) && isAgentTextApiProfile(profile))?.id ?? null,
              agentImageProfileId: current.settings.agentImageProfileId && presetIds.has(current.settings.agentImageProfileId)
                ? current.settings.agentImageProfileId
                : defaultPresetId ?? [...presetIds][0],
            })
          : current.settings
        current.setSettings(await applyUrlSettings(settings))
        clearAppliedUrlSettings()
        const selectedKeyId = useStore.getState().settings.selectedKeyId
        const session = await loadEmbeddedKeys(selectedKeyId)
        if (session.status === 'ready' && session.selectedKeyId !== selectedKeyId) {
          useStore.getState().setSettings({ selectedKeyId: session.selectedKeyId })
        }
      })
      .catch((error) => {
        console.warn('Failed to import preset config:', error)
        setPresetConfig(null)
        const state = useStore.getState()
        void applyUrlSettings(state.settings).then(async (settings) => {
          useStore.getState().setSettings(settings)
          clearAppliedUrlSettings()
          const selectedKeyId = useStore.getState().settings.selectedKeyId
          const session = await loadEmbeddedKeys(selectedKeyId)
          if (session.status === 'ready' && session.selectedKeyId !== selectedKeyId) {
            useStore.getState().setSettings({ selectedKeyId: session.selectedKeyId })
          }
        })
      })
  }, [configTransferEnabled])

  useEffect(() => {
    if (!agentEnabled && appMode !== 'gallery') useStore.getState().setAppMode('gallery')
  }, [agentEnabled, appMode])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <Header embeddedAdmin={embeddedAdmin} />
      {EMBEDDED_BUILD && embeddedSession.status === 'auth-error' ? (
        <main className="safe-area-x mx-auto max-w-7xl py-16 text-center"><h1 className="text-lg font-semibold text-gray-900 dark:text-white">图像创作会话已失效</h1><p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{embeddedSession.message}</p><p className="mt-1 text-xs text-gray-400">请返回 NanaFox 后重新打开“图像创作”。本地创作记录不会删除。</p></main>
      ) : EMBEDDED_BUILD ? embeddedAdmin ? (
        <ImageCreationAdmin />
      ) : (
        <ImageCreationUser localGallery={<><SearchBar />{filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}</>} />
      ) : agentEnabled && AgentWorkspace && appMode === 'agent' ? (
        <Suspense fallback={null}><AgentWorkspace /></Suspense>
      ) : (
        <main data-home-main data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
          </div>
        </main>
      )}
      {!embeddedAdmin && <InputBar mobileDefaultCollapsed={EMBEDDED_BUILD} />}
      <DetailModal />
      <Lightbox />
      {settingsEnabled && SettingsModal && <Suspense fallback={null}><SettingsModal /></Suspense>}
      <ConfirmDialog />
      {supportPromptEnabled && SupportPromptModal && <Suspense fallback={null}><SupportPromptModal /></Suspense>}
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}

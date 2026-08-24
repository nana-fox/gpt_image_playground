import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import type { TaskParams } from '../types'
import { distributeGalleryItems } from '../lib/galleryColumns'
import {
  applyImageCreationTemplate,
  getImageCreationAssetUrl,
  getImageCreationTemplate,
  ImageCreationApiError,
  listImageCreationTemplates,
  setImageCreationTemplateFavorite,
  type ImageCreationTemplateDetail,
  type ImageCreationTemplateListItem,
} from '../lib/imageCreationApi'
import { CloseIcon, ExpandIcon, FavoriteIcon } from './icons'

const CATEGORIES = [
  ['portrait', '人像'],
  ['product', '产品'],
  ['illustration', '插画'],
  ['design', '设计'],
  ['architecture', '建筑'],
  ['food', '美食'],
  ['landscape', '风景'],
] as const

function categoryLabel(category: string) {
  return CATEGORIES.find(([value]) => value === category)?.[1] ?? category
}

function inputModeLabel(mode: ImageCreationTemplateListItem['input_mode']) {
  if (mode === 'reference_required') return '需要参考图'
  if (mode === 'reference_optional') return '可添加参考图'
  return '文字创作'
}

function TemplateCover({ template, alt = '', className = '', eager = false, natural = false, onCoverLoad }: {
  template: ImageCreationTemplateListItem
  alt?: string
  className?: string
  eager?: boolean
  natural?: boolean
  onCoverLoad?: (width: number, height: number) => void
}) {
  if (!template.cover_asset_id) {
    return <div data-template-cover className={`flex items-center justify-center bg-gradient-to-br from-teal-50 to-cyan-100 text-sm text-teal-700 dark:from-teal-950/40 dark:to-cyan-950/40 dark:text-teal-300 ${natural ? 'aspect-[4/5]' : ''} ${className}`}>等待封面</div>
  }
  const src = getImageCreationAssetUrl(template.cover_asset_id)
  const contained = !natural && template.cover_fit === 'contain'
  return (
    <div data-template-cover className={`relative overflow-hidden bg-gray-100 dark:bg-gray-900 ${className}`}>
      {contained && <><img src={src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-xl dark:opacity-25" /><span className="absolute inset-0 bg-black/10 dark:bg-black/35" /></>}
      <img
        src={src}
        alt={alt}
        className={`relative w-full ${natural ? 'block h-auto object-contain' : `h-full transition duration-300 group-hover:scale-[1.015] ${contained ? 'object-contain p-2' : 'object-cover'}`}`}
        loading={eager ? 'eager' : 'lazy'}
        onLoad={(event) => onCoverLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
      />
    </div>
  )
}

function TemplateCard({ template, onDetail, onUse, onFavorite }: {
  template: ImageCreationTemplateListItem
  onDetail: () => void
  onUse: () => void
  onFavorite?: () => void
}) {
  const [aspectRatio, setAspectRatio] = useState(4 / 5)
  const onCoverLoad = (width: number, height: number) => {
    if (width > 0 && height > 0) setAspectRatio(width / height)
  }

  return (
    <article data-template-card data-auto-aspect style={{ aspectRatio }} className="group relative w-full overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-100 shadow-sm focus-within:ring-2 focus-within:ring-teal-500 focus-within:ring-offset-2 dark:border-white/[0.08] dark:bg-gray-900 dark:focus-within:ring-offset-gray-950">
      <button type="button" onClick={onDetail} className="relative block w-full text-left" aria-label={`查看${template.title}`}>
        <TemplateCover template={template} className="w-full" natural onCoverLoad={onCoverLoad} />
      </button>
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/20 group-focus-within:bg-black/20" />
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">{categoryLabel(template.category)}</span>
      {onFavorite && <button type="button" onClick={onFavorite} className="absolute right-3 top-3 rounded-full bg-black/45 p-2 text-white backdrop-blur-sm transition hover:bg-white hover:text-rose-500 focus:bg-white focus:text-rose-500" aria-label={template.favorited ? '取消收藏' : '收藏模板'}><FavoriteIcon filled={template.favorited} className={`h-4 w-4 ${template.favorited ? 'text-rose-400' : ''}`} /></button>}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-4 pt-16 text-white">
        <h3 className="line-clamp-2 text-base font-semibold leading-6">{template.title}</h3>
        <p className="mt-1 line-clamp-1 text-xs text-white/70">{inputModeLabel(template.input_mode)}</p>
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" onClick={onDetail} className="inline-flex items-center gap-1.5 rounded-xl bg-white/95 px-3 py-2 text-xs font-medium text-gray-800 shadow-sm backdrop-blur"><ExpandIcon className="h-4 w-4" />预览</button>
        <button type="button" onClick={onUse} className="rounded-xl bg-teal-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-teal-700">用此灵感</button>
      </div>
    </article>
  )
}

function FeaturedCard({ template, featured, onDetail, onUse }: {
  template: ImageCreationTemplateListItem
  featured: boolean
  onDetail: () => void
  onUse: () => void
}) {
  const [aspectRatio, setAspectRatio] = useState(4 / 5)
  const onCoverLoad = (width: number, height: number) => {
    if (width > 0 && height > 0) setAspectRatio(width / height)
  }

  return (
    <article data-featured-card data-auto-aspect style={{ aspectRatio }} className="group relative h-[250px] w-auto shrink-0 snap-start overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-100 shadow-sm focus-within:ring-2 focus-within:ring-teal-500 focus-within:ring-offset-2 dark:border-white/[0.08] dark:bg-gray-900 dark:focus-within:ring-offset-gray-950 sm:h-[290px] lg:h-[330px]">
      <button type="button" onClick={onDetail} className="absolute inset-0 h-full w-full text-left" aria-label={`查看${template.title}`}><TemplateCover template={template} className="h-full w-full" eager={featured} onCoverLoad={onCoverLoad} /></button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-4 pt-20 text-white">
        {featured && <span className="mb-2 inline-flex rounded-full bg-teal-500/90 px-2.5 py-1 text-[10px] font-semibold backdrop-blur">本周精选</span>}
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 sm:text-base">{template.title}</h3>
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100 group-focus-within:bg-black/20 group-focus-within:opacity-100">
        <button type="button" onClick={onDetail} className="inline-flex items-center gap-1.5 rounded-xl bg-white/95 px-3 py-2 text-xs font-medium text-gray-800 shadow-sm"><ExpandIcon className="h-4 w-4" />预览</button>
        <button type="button" onClick={onUse} className="rounded-xl bg-teal-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-teal-700">用此灵感</button>
      </div>
    </article>
  )
}

function FeaturedShelf({ templates, onDetail, onUse }: {
  templates: ImageCreationTemplateListItem[]
  onDetail: (template: ImageCreationTemplateListItem) => void
  onUse: (template: ImageCreationTemplateListItem) => void
}) {
  if (!templates.length) return null

  return (
    <div data-featured-shelf className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
      {templates.map((template, index) => <FeaturedCard key={template.id} template={template} featured={index === 0} onDetail={() => onDetail(template)} onUse={() => onUse(template)} />)}
    </div>
  )
}

function TemplateDetail({ template, loading, onClose, onUse }: {
  template: ImageCreationTemplateDetail | null
  loading: boolean
  onClose: () => void
  onUse: () => void
}) {
  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <section role="dialog" aria-modal="true" className="h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-gray-950 sm:max-w-lg" onClick={(event) => event.stopPropagation()} aria-label="灵感详情">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/90 px-5 py-4 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90">
          <h2 className="font-semibold text-gray-900 dark:text-white">灵感详情</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]" aria-label="关闭灵感详情"><CloseIcon className="h-5 w-5" /></button>
        </div>
        {loading || !template ? (
          <div className="p-8 text-center text-sm text-gray-500">正在加载...</div>
        ) : (
          <div className="p-5 pb-28">
            <div data-template-detail-cover><TemplateCover template={template} alt={template.cover_alt} className="w-full rounded-2xl" eager natural /></div>
            <h2 className="mt-5 text-xl font-bold text-gray-900 dark:text-white">{template.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{template.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">{categoryLabel(template.category)}</span>
              {template.tags.map((tag) => <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{tag}</span>)}
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 p-4 text-sm dark:border-white/[0.08]">
              <div><dt className="text-xs text-gray-400">输入方式</dt><dd className="mt-1 text-gray-700 dark:text-gray-200">{inputModeLabel(template.input_mode)}</dd></div>
              <div><dt className="text-xs text-gray-400">推荐尺寸</dt><dd className="mt-1 text-gray-700 dark:text-gray-200">{template.defaults.size}</dd></div>
              <div><dt className="text-xs text-gray-400">推荐质量</dt><dd className="mt-1 text-gray-700 dark:text-gray-200">{template.defaults.quality}</dd></div>
              <div><dt className="text-xs text-gray-400">输出格式</dt><dd className="mt-1 uppercase text-gray-700 dark:text-gray-200">{template.defaults.output_format}</dd></div>
            </dl>
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">提示词预览</h3>
              <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-gray-50 p-4 text-sm leading-6 text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">{template.prompt}</p>
            </div>
            {template.source?.url && <a href={template.source.url} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex text-xs text-teal-600 hover:underline dark:text-teal-400">查看灵感来源与许可说明</a>}
          </div>
        )}
        <div className="fixed bottom-0 right-0 w-full border-t border-gray-200 bg-white/95 p-4 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95 sm:max-w-lg">
          <button type="button" disabled={!template || loading} onClick={onUse} className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">使用此灵感</button>
        </div>
      </section>
    </div>
  )
}

export default function ImageCreationUser({ localSearch, localGallery }: { localSearch: ReactNode, localGallery: ReactNode }) {
  const prompt = useStore((state) => state.prompt)
  const params = useStore((state) => state.params)
  const setPrompt = useStore((state) => state.setPrompt)
  const setParams = useStore((state) => state.setParams)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const [view, setView] = useState<'create' | 'inspiration'>('create')
  const [featured, setFeatured] = useState<ImageCreationTemplateListItem[]>([])
  const [featuredError, setFeaturedError] = useState('')
  const [items, setItems] = useState<ImageCreationTemplateListItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [recent, setRecent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [galleryError, setGalleryError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [detail, setDetail] = useState<ImageCreationTemplateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [undo, setUndo] = useState<{ prompt: string, params: TaskParams } | null>(null)
  const [galleryColumnCount, setGalleryColumnCount] = useState(() => {
    if (typeof window === 'undefined') return 1
    if (window.innerWidth >= 1280) return 4
    if (window.innerWidth >= 1024) return 3
    if (window.innerWidth >= 460) return 2
    return 1
  })
  const galleryColumns = useMemo(() => distributeGalleryItems(items, galleryColumnCount), [items, galleryColumnCount])

  useEffect(() => {
    let cancelled = false
    listImageCreationTemplates({ home: true, pageSize: 20 })
      .then((result) => {
        if (!cancelled) setFeatured(result.items)
      })
      .catch((error) => {
        if (!cancelled) setFeaturedError(error instanceof Error ? error.message : '精选灵感加载失败')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (view !== 'inspiration') return
    const update = () => {
      if (window.innerWidth >= 1280) {
        setGalleryColumnCount(4)
        return
      }
      if (window.innerWidth >= 1024) {
        setGalleryColumnCount(3)
        return
      }
      setGalleryColumnCount(window.innerWidth >= 460 ? 2 : 1)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [view])

  useEffect(() => {
    if (view !== 'inspiration') return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setGalleryError('')
      listImageCreationTemplates({ q: query, category, tag, favorite, recent, page, pageSize: 20 })
        .then((result) => {
          if (cancelled) return
          setItems((current) => page === 1 ? result.items : [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))])
          setTotal(result.total)
          setTotalPages(result.pages)
        })
        .catch((error) => {
          if (!cancelled) setGalleryError(error instanceof ImageCreationApiError && error.status >= 500 ? '筛选暂时不可用，请重试或清除筛选。' : error instanceof Error ? error.message : '灵感库加载失败')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [view, query, category, tag, favorite, recent, page, reloadKey])

  const resetPage = (change: () => void) => {
    change()
    setPage(1)
    setItems([])
    setTotal(0)
  }

  useEffect(() => {
    if (view !== 'inspiration') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (detail) {
        setDetail(null)
        return
      }
      setView('create')
    }
    window.addEventListener('keydown', close)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', close)
    }
  }, [view, detail])

  const openDetail = async (template: ImageCreationTemplateListItem) => {
    setDetailLoading(true)
    setDetail({ ...template, prompt: '', cover_alt: '' })
    try {
      setDetail(await getImageCreationTemplate(template.id))
    } catch (error) {
      setDetail(null)
      showToast(error instanceof Error ? error.message : '灵感详情加载失败', 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  const useTemplate = async (template: ImageCreationTemplateListItem) => {
    const apply = async () => {
      try {
        const application = await applyImageCreationTemplate(template.id, template.published_version)
        setUndo({ prompt, params: { ...params } })
        setPrompt(application.prompt)
        setParams(application.defaults)
        setDetail(null)
        setView('create')
        showToast(application.input_mode === 'reference_required' ? '灵感已应用，请再添加参考图' : '灵感已应用到创作区', 'success')
      } catch (error) {
        showToast(error instanceof Error ? error.message : '应用灵感失败', 'error')
      }
    }
    if (!prompt.trim()) {
      await apply()
      return
    }
    setConfirmDialog({
      title: '替换当前提示词？',
      message: `使用「${template.title}」会替换当前提示词和推荐参数，API Key 与模型不会改变。`,
      confirmText: '替换并应用',
      awaitAction: true,
      action: apply,
    })
  }

  const toggleFavorite = async (template: ImageCreationTemplateListItem) => {
    const next = !template.favorited
    setItems((current) => current.map((item) => item.id === template.id ? { ...item, favorited: next } : item))
    try {
      await setImageCreationTemplateFavorite(template.id, next)
      if (favorite && !next) setItems((current) => current.filter((item) => item.id !== template.id))
    } catch (error) {
      setItems((current) => current.map((item) => item.id === template.id ? { ...item, favorited: !next } : item))
      showToast(error instanceof Error ? error.message : '收藏操作失败', 'error')
    }
  }

  const filters = (
    <>
      <select value={category} onChange={(event) => resetPage(() => setCategory(event.target.value))} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-teal-400 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200" aria-label="灵感分类">
        <option value="">全部分类</option>
        {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input value={tag} onChange={(event) => resetPage(() => setTag(event.target.value))} placeholder="标签" className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08] dark:bg-gray-900" />
      <button type="button" onClick={() => resetPage(() => setFavorite((value) => !value))} className={`rounded-xl border px-3 py-2 text-sm ${favorite ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10' : 'border-gray-200 text-gray-600 dark:border-white/[0.08] dark:text-gray-300'}`}>我的收藏</button>
      <button type="button" onClick={() => resetPage(() => setRecent((value) => !value))} className={`rounded-xl border px-3 py-2 text-sm ${recent ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10' : 'border-gray-200 text-gray-600 dark:border-white/[0.08] dark:text-gray-300'}`}>最近使用</button>
    </>
  )

  return (
    <>
      <main data-image-creation-home className="safe-area-x mx-auto max-w-7xl pb-48">
        <section className="mb-7 rounded-2xl border border-gray-200/80 bg-white/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">从灵感开始</h2>
            <button type="button" onClick={() => setView('inspiration')} className="shrink-0 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:border-teal-300 hover:bg-teal-100 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300">浏览全部 →</button>
          </div>
          {featuredError ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{featuredError}，你的本地创作不受影响。</p> : featured.length ? (
            <FeaturedShelf templates={featured} onDetail={openDetail} onUse={useTemplate} />
          ) : <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-white/[0.03]">暂时没有精选灵感，你仍可继续自己的创作。</p>}
        </section>
        <section data-recent-creations className="rounded-2xl border border-gray-200/80 bg-white/40 p-4 dark:border-white/[0.08] dark:bg-white/[0.015]">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-base font-semibold text-gray-900 dark:text-white">最近创作</h2><p className="mt-1 text-xs text-gray-400">历史作品只保存在当前账号的浏览器空间</p></div>
            <div className="min-w-0 sm:w-[480px]">{localSearch}</div>
          </div>
          {localGallery}
        </section>
      </main>

      {view === 'inspiration' && (
        <section data-inspiration-overlay role="dialog" aria-modal="true" aria-label="灵感画廊" className="fixed inset-0 z-[80] overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95">
            <div className="safe-area-x mx-auto flex max-w-7xl items-center justify-between py-4">
              <div><h1 className="text-xl font-bold text-gray-900 dark:text-white">灵感画廊</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">浏览模板，预览效果，一键应用到创作区。</p></div>
              <button type="button" onClick={() => setView('create')} className="rounded-xl p-2.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]" aria-label="返回创作台"><CloseIcon className="h-5 w-5" /></button>
            </div>
          </header>
          <div className="safe-area-x mx-auto max-w-7xl py-6 pb-24">
            <div className="mb-5 flex gap-2">
              <input value={query} onChange={(event) => resetPage(() => setQuery(event.target.value))} placeholder="搜索标题或描述" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08] dark:bg-gray-900" />
              <button type="button" onClick={() => setFiltersOpen(true)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-white/[0.08] dark:text-gray-300 sm:hidden">筛选</button>
              <div className="hidden gap-2 sm:flex">{filters}</div>
            </div>
            {galleryError && <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"><span>{galleryError}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 font-medium dark:border-red-500/30 dark:bg-transparent">重新加载</button></div>}
            {!loading && !galleryError && items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-white/[0.12]">没有找到符合条件的灵感，试试清除筛选。</div>
            ) : (
              <div data-inspiration-masonry className="grid grid-cols-1 items-start gap-4 min-[460px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{galleryColumns.map((column, index) => <div key={index} className="space-y-4">{column.map((template) => <TemplateCard key={template.id} template={template} onDetail={() => openDetail(template)} onUse={() => useTemplate(template)} onFavorite={() => toggleFavorite(template)} />)}</div>)}</div>
            )}
            <p aria-live="polite" className="mt-5 text-center text-xs text-gray-400">{loading ? '正在加载灵感…' : `已显示 ${items.length} / ${total} 个灵感`}</p>
            {(loading || page < totalPages) && <div className="mt-3 text-center"><button type="button" disabled={loading} onClick={() => setPage((value) => value + 1)} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]">{loading ? '正在加载…' : '加载更多'}</button></div>}
          </div>
        </section>
      )}

      {filtersOpen && <div className="fixed inset-0 z-[85] flex items-end bg-black/30 sm:hidden" onClick={() => setFiltersOpen(false)}><div className="w-full rounded-t-3xl bg-white p-5 dark:bg-gray-950" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">筛选灵感</h2><button type="button" onClick={() => setFiltersOpen(false)} aria-label="关闭筛选"><CloseIcon className="h-5 w-5" /></button></div><div className="grid gap-3">{filters}</div><button type="button" onClick={() => setFiltersOpen(false)} className="mt-5 w-full rounded-xl bg-teal-600 py-3 text-sm font-medium text-white">查看结果</button></div></div>}
      {detail !== null && <TemplateDetail template={detail} loading={detailLoading} onClose={() => setDetail(null)} onUse={() => useTemplate(detail)} />}
      {undo && <div className="fixed bottom-32 left-1/2 z-[75] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl"><span>已应用灵感</span><button type="button" onClick={() => { setPrompt(undo.prompt); setParams(undo.params); setUndo(null) }} className="font-semibold text-teal-300 hover:underline">撤销</button><button type="button" onClick={() => setUndo(null)} className="text-gray-400" aria-label="关闭撤销提示"><CloseIcon className="h-4 w-4" /></button></div>}
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { getImage } from '../lib/db'
import { ensureImageCached, getCachedImage } from '../lib/imageCache'
import {
  changeImageCreationTemplateState,
  createImageCreationTemplate,
  getImageCreationAdminTemplate,
  getImageCreationAssetUrl,
  getImageCreationHomeFeatured,
  ImageCreationApiError,
  listImageCreationAdminTemplates,
  replaceImageCreationHomeFeatured,
  updateImageCreationTemplate,
  uploadImageCreationAsset,
  type ImageCreationAdminTemplate,
  type ImageCreationTemplateDocument,
} from '../lib/imageCreationApi'
import { useStore } from '../store'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon } from './icons'

const EMPTY_DOCUMENT: ImageCreationTemplateDocument = {
  schema_version: 1,
  title: '',
  summary: '',
  category: 'portrait',
  tags: [],
  prompt: '',
  input_mode: 'text',
  cover_alt: '',
  defaults: { size: '1024x1024', quality: 'high', output_format: 'png' },
}

const STATE_LABELS = { draft: '草稿', published: '已发布', archived: '已归档' }

function LocalImageThumb({ imageId, selected, onSelect }: { imageId: string, selected: boolean, onSelect: () => void }) {
  const [src, setSrc] = useState(getCachedImage(imageId) ?? '')

  useEffect(() => {
    let cancelled = false
    ensureImageCached(imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => { cancelled = true }
  }, [imageId])

  return <button type="button" onClick={onSelect} className={`aspect-square overflow-hidden rounded-xl border-2 bg-gray-100 ${selected ? 'border-teal-500' : 'border-transparent'}`} aria-label="选择本地生成作品">{src && <img src={src} alt="" className="h-full w-full object-cover" />}</button>
}

function TemplatePreview({ document, coverUrl, onClose }: { document: ImageCreationTemplateDocument, coverUrl: string, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <article className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">用户端预览</h2><button type="button" onClick={onClose} aria-label="关闭预览"><CloseIcon className="h-5 w-5" /></button></div>
        <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-gray-100 dark:bg-white/[0.04]">{coverUrl && <img src={coverUrl} alt={document.cover_alt} className="h-full w-full object-cover" />}</div>
        <h3 className="mt-4 text-xl font-bold">{document.title || '未命名模板'}</h3>
        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{document.summary || '还没有填写摘要'}</p>
        <div className="mt-3 flex flex-wrap gap-2">{document.tags.map((tag) => <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-white/[0.06]">{tag}</span>)}</div>
        <p className="mt-5 whitespace-pre-wrap rounded-2xl bg-gray-50 p-4 text-sm leading-6 text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">{document.prompt || '还没有填写提示词'}</p>
      </article>
    </div>
  )
}

function TemplateEditor({ template, onClose, onSaved }: {
  template: ImageCreationAdminTemplate | null
  onClose: () => void
  onSaved: (template: ImageCreationAdminTemplate) => void
}) {
  const tasks = useStore((state) => state.tasks)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const [document, setDocument] = useState<ImageCreationTemplateDocument>(template?.draft_data ?? EMPTY_DOCUMENT)
  const [coverAssetId, setCoverAssetId] = useState(template?.draft_cover_asset_id ?? '')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState(template?.draft_cover_asset_id ? getImageCreationAssetUrl(template.draft_cover_asset_id) : '')
  const [localImageId, setLocalImageId] = useState('')
  const [localPickerOpen, setLocalPickerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const localImages = useMemo(() => tasks.flatMap((task) => task.outputImages ?? []).filter((id, index, all) => all.indexOf(id) === index).slice(0, 12), [tasks])

  useEffect(() => {
    if (!coverFile) return
    const url = URL.createObjectURL(coverFile)
    setCoverPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [coverFile])

  const patchDocument = (patch: Partial<ImageCreationTemplateDocument>) => setDocument((current) => ({ ...current, ...patch }))
  const dirty = JSON.stringify(document) !== JSON.stringify(template?.draft_data ?? EMPTY_DOCUMENT) || coverAssetId !== (template?.draft_cover_asset_id ?? '') || coverFile !== null
  const requestClose = () => {
    if (!dirty) {
      onClose()
      return
    }
    setConfirmDialog({
      title: '放弃未保存的修改？',
      message: '关闭后，本次尚未保存的字段和封面选择将丢失。',
      confirmText: '放弃修改',
      tone: 'danger',
      action: onClose,
    })
  }

  const chooseLocalImage = async (imageId: string) => {
    const image = await getImage(imageId)
    if (!image) {
      showToast('这张本地作品已不可用', 'error')
      return
    }
    const blob = await fetch(image.dataUrl).then((response) => response.blob())
    const type = blob.type === 'image/jpeg' || blob.type === 'image/webp' ? blob.type : 'image/png'
    setCoverFile(new File([blob], `generated-${imageId}.${type.split('/')[1]}`, { type }))
    setLocalImageId(imageId)
    setLocalPickerOpen(false)
  }

  const save = async () => {
    setBusy(true)
    try {
      const nextDocument = { ...document, tags: document.tags.map((tag) => tag.trim()).filter(Boolean) }
      const nextCoverId = coverFile ? (await uploadImageCreationAsset(coverFile, localImageId ? 'generated' : 'uploaded')).id : coverAssetId
      const saved = template
        ? await updateImageCreationTemplate(template.id, template.revision, nextDocument, nextCoverId)
        : await createImageCreationTemplate(nextDocument, nextCoverId)
      setDocument(nextDocument)
      setCoverAssetId(nextCoverId)
      setCoverFile(null)
      onSaved(saved)
      showToast('草稿已保存', 'success')
    } catch (error) {
      showToast(error instanceof ImageCreationApiError && error.status === 409 ? '草稿已被其他管理员修改，请关闭后重新打开。' : error instanceof Error ? error.message : '保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95">
        <div className="safe-area-x mx-auto flex max-w-6xl items-center justify-between py-3">
          <div><h1 className="font-semibold text-gray-900 dark:text-white">{template ? '编辑模板' : '新建模板'}</h1><p className="text-xs text-gray-400">{template ? `模板 #${template.id} · 修订 ${template.revision}` : '先保存草稿，再决定是否发布'}</p></div>
          <div className="flex gap-2"><button type="button" onClick={() => setPreviewOpen(true)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">预览</button><button type="button" disabled={busy} onClick={save} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? '保存中...' : '保存草稿'}</button><button type="button" onClick={requestClose} className="rounded-xl p-2 hover:bg-gray-100 dark:hover:bg-white/[0.06]" aria-label="关闭编辑器"><CloseIcon className="h-5 w-5" /></button></div>
        </div>
      </header>
      <div className="safe-area-x mx-auto grid max-w-6xl gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <label className="block"><span className="mb-1.5 block text-sm font-medium">标题</span><input value={document.title} onChange={(event) => patchDocument({ title: event.target.value })} maxLength={120} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08]" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">摘要</span><textarea value={document.summary} onChange={(event) => patchDocument({ summary: event.target.value })} maxLength={300} rows={3} className="w-full resize-y rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08]" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-sm font-medium">分类代码</span><input value={document.category} onChange={(event) => patchDocument({ category: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} maxLength={64} placeholder="portrait" className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08]" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">标签</span><input value={document.tags.join(', ')} onChange={(event) => patchDocument({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).slice(0, 8) })} placeholder="人像, 电影感" className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08]" /></label>
          </div>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">提示词</span><textarea value={document.prompt} onChange={(event) => patchDocument({ prompt: event.target.value })} maxLength={12000} rows={12} className="w-full resize-y rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 font-mono text-sm leading-6 outline-none focus:border-teal-400 dark:border-white/[0.08]" /></label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className="mb-1.5 block text-sm font-medium">输入方式</span><select value={document.input_mode} onChange={(event) => patchDocument({ input_mode: event.target.value as ImageCreationTemplateDocument['input_mode'] })} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm dark:border-white/[0.08]"><option value="text">仅文字</option><option value="reference_optional">参考图可选</option><option value="reference_required">必须参考图</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">尺寸</span><select value={document.defaults.size} onChange={(event) => patchDocument({ defaults: { ...document.defaults, size: event.target.value as ImageCreationTemplateDocument['defaults']['size'] } })} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm dark:border-white/[0.08]"><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">质量</span><select value={document.defaults.quality} onChange={(event) => patchDocument({ defaults: { ...document.defaults, quality: event.target.value as ImageCreationTemplateDocument['defaults']['quality'] } })} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm dark:border-white/[0.08]"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">格式</span><select value={document.defaults.output_format} onChange={(event) => patchDocument({ defaults: { ...document.defaults, output_format: event.target.value as ImageCreationTemplateDocument['defaults']['output_format'] } })} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm dark:border-white/[0.08]"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
          </div>
          <details className="rounded-2xl border border-gray-200 p-4 dark:border-white/[0.08]"><summary className="cursor-pointer text-sm font-medium">来源与许可说明</summary><div className="mt-4 grid gap-3"><input value={document.source?.name ?? ''} onChange={(event) => patchDocument({ source: { ...document.source, name: event.target.value } })} maxLength={120} placeholder="来源名称" className="rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/[0.08]" /><input value={document.source?.url ?? ''} onChange={(event) => patchDocument({ source: { ...document.source, url: event.target.value } })} maxLength={500} placeholder="https://..." className="rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/[0.08]" /><input value={document.source?.license ?? ''} onChange={(event) => patchDocument({ source: { ...document.source, license: event.target.value } })} maxLength={120} placeholder="许可协议" className="rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/[0.08]" /><textarea value={document.source?.notes ?? ''} onChange={(event) => patchDocument({ source: { ...document.source, notes: event.target.value } })} maxLength={500} placeholder="改写或审核说明" className="rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/[0.08]" /></div></details>
        </div>
        <aside className="space-y-5">
          <section className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]"><h2 className="text-sm font-semibold">模板封面</h2><div className="mt-3 aspect-[4/3] overflow-hidden rounded-2xl bg-gray-100 dark:bg-white/[0.04]">{coverPreview && <img src={coverPreview} alt="封面预览" className="h-full w-full object-cover" />}</div><div className="mt-3 grid grid-cols-2 gap-2"><label className="cursor-pointer rounded-xl border border-gray-200 px-3 py-2 text-center text-xs dark:border-white/[0.08]">上传图片<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setCoverFile(file); setLocalImageId('') } }} /></label><button type="button" onClick={() => setLocalPickerOpen((value) => !value)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs dark:border-white/[0.08]">选择我的作品</button></div>{localPickerOpen && <div className="mt-3 grid grid-cols-3 gap-2">{localImages.length ? localImages.map((id) => <LocalImageThumb key={id} imageId={id} selected={id === localImageId} onSelect={() => chooseLocalImage(id)} />) : <p className="col-span-3 py-4 text-center text-xs text-gray-400">当前浏览器还没有可用作品</p>}</div>}<label className="mt-4 block"><span className="mb-1.5 block text-xs text-gray-500">封面替代文本</span><input value={document.cover_alt} onChange={(event) => patchDocument({ cover_alt: event.target.value })} maxLength={200} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/[0.08]" /></label></section>
          <section className="rounded-3xl border border-teal-200 bg-teal-50/60 p-4 text-xs leading-5 text-teal-800 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-200"><strong className="block text-sm">发布前检查</strong><span>封面、标题、提示词和参数会组成用户可见快照。保存草稿不会立即影响线上模板。</span></section>
        </aside>
      </div>
      {previewOpen && <TemplatePreview document={document} coverUrl={coverPreview} onClose={() => setPreviewOpen(false)} />}
    </div>
  )
}

function HomeFeaturedManager() {
  const showToast = useStore((state) => state.showToast)
  const [templates, setTemplates] = useState<ImageCreationAdminTemplate[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [etag, setEtag] = useState('')
  const [candidate, setCandidate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [home, published] = await Promise.all([getImageCreationHomeFeatured(), listImageCreationAdminTemplates({ state: 'published', pageSize: 100 })])
      setSelected(home.template_ids)
      setEtag(home.etag)
      setTemplates(published.items.filter((template) => template.state === 'published'))
    } catch (error) {
      showToast(error instanceof Error ? error.message : '首页精选加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const move = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= selected.length) return
    setSelected((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      const home = await replaceImageCreationHomeFeatured(etag, selected)
      setEtag(home.etag)
      showToast('首页精选已发布', 'success')
    } catch (error) {
      showToast(error instanceof ImageCreationApiError && error.status === 409 ? '首页精选已被其他管理员修改，请刷新后重试。' : error instanceof Error ? error.message : '发布失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="py-12 text-center text-sm text-gray-400">正在加载首页精选...</p>

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">首页精选</h2><p className="mt-1 text-xs text-gray-400">最多 6 个，顺序即用户“今日灵感”的展示顺序。</p></div><div className="flex gap-2"><button type="button" onClick={load} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">刷新</button><button type="button" disabled={saving} onClick={save} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '发布中...' : '发布首页'}</button></div></div>
      <div className="mt-5 flex gap-2"><select value={candidate} onChange={(event) => setCandidate(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-white/[0.08]"><option value="">选择已发布模板</option>{templates.filter((template) => !selected.includes(template.id)).map((template) => <option key={template.id} value={template.id}>{template.published_data?.title ?? template.draft_data.title}</option>)}</select><button type="button" disabled={!candidate || selected.length >= 6} onClick={() => { setSelected((current) => [...current, Number(candidate)]); setCandidate('') }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/[0.08]">添加</button></div>
      <ol className="mt-5 space-y-3">{selected.map((id, index) => { const template = templates.find((item) => item.id === id); if (!template) return null; const doc = template.published_data ?? template.draft_data; return <li key={id} className="flex items-center gap-3 rounded-2xl border border-gray-200 p-3 dark:border-white/[0.08]"><div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-white/[0.04]">{template.published_cover_asset_id && <img src={getImageCreationAssetUrl(template.published_cover_asset_id)} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0 flex-1"><span className="text-xs text-gray-400">位置 {index + 1}</span><h3 className="truncate text-sm font-medium">{doc.title}</h3></div><div className="flex gap-1"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="rounded-lg border border-gray-200 p-2 disabled:opacity-30 dark:border-white/[0.08]" aria-label="上移"><ChevronLeftIcon className="h-4 w-4 rotate-90" /></button><button type="button" disabled={index === selected.length - 1} onClick={() => move(index, 1)} className="rounded-lg border border-gray-200 p-2 disabled:opacity-30 dark:border-white/[0.08]" aria-label="下移"><ChevronRightIcon className="h-4 w-4 rotate-90" /></button><button type="button" onClick={() => setSelected((current) => current.filter((value) => value !== id))} className="rounded-lg border border-red-200 p-2 text-red-500 dark:border-red-500/20" aria-label="移除"><CloseIcon className="h-4 w-4" /></button></div></li> })}</ol>
      {!selected.length && <p className="mt-5 rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-white/[0.12]">当前首页没有精选模板</p>}
    </section>
  )
}

export default function ImageCreationAdmin() {
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const [view, setView] = useState<'templates' | 'home'>('templates')
  const [templates, setTemplates] = useState<ImageCreationAdminTemplate[]>([])
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ImageCreationAdminTemplate | null | undefined>(undefined)

  const load = async () => {
    setLoading(true)
    try {
      const result = await listImageCreationAdminTemplates({ q: query, state, pageSize: 100 })
      setTemplates(result.items)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '模板列表加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (view !== 'templates') return
    const timer = window.setTimeout(() => { void load() }, 250)
    return () => window.clearTimeout(timer)
  }, [view, query, state])

  const edit = async (template: ImageCreationAdminTemplate) => {
    try {
      setEditing(await getImageCreationAdminTemplate(template.id))
    } catch (error) {
      showToast(error instanceof Error ? error.message : '模板加载失败', 'error')
    }
  }

  const changeState = (template: ImageCreationAdminTemplate, action: 'publish' | 'archive' | 'restore') => {
    const label = action === 'publish' ? '发布' : action === 'archive' ? '归档' : '恢复为草稿'
    setConfirmDialog({
      title: `${label}模板？`,
      message: action === 'publish' ? '发布后，用户将看到当前草稿与封面的新快照。' : action === 'archive' ? '归档后用户不可见，并会自动从首页精选移除。' : '恢复后仍是草稿，不会自动公开。',
      confirmText: label,
      awaitAction: true,
      action: async () => {
        try {
          await changeImageCreationTemplateState(template.id, action, action === 'publish' ? template.revision : undefined)
          await load()
          showToast(`模板已${label}`, 'success')
        } catch (error) {
          showToast(error instanceof Error ? error.message : `${label}失败`, 'error')
          return false
        }
      },
    })
  }

  return (
    <>
      <main className="safe-area-x mx-auto max-w-7xl pb-12">
        <nav className="mb-5 flex border-b border-gray-200 dark:border-white/[0.08]" aria-label="图像创作管理视图"><button type="button" onClick={() => setView('templates')} className={`border-b-2 px-4 py-3 text-sm font-medium ${view === 'templates' ? 'border-teal-500 text-teal-700 dark:text-teal-300' : 'border-transparent text-gray-500'}`}>模板管理</button><button type="button" onClick={() => setView('home')} className={`border-b-2 px-4 py-3 text-sm font-medium ${view === 'home' ? 'border-teal-500 text-teal-700 dark:text-teal-300' : 'border-transparent text-gray-500'}`}>首页精选</button></nav>
        {view === 'home' ? <HomeFeaturedManager /> : <section><div className="mb-5 flex flex-col gap-3 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板标题或摘要" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-white/[0.08] dark:bg-gray-900" /><select value={state} onChange={(event) => setState(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-white/[0.08] dark:bg-gray-900"><option value="">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select><button type="button" onClick={() => setEditing(null)} className="inline-flex items-center justify-center gap-1 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white"><PlusIcon className="h-4 w-4" />新建模板</button></div>
          {loading ? <p className="py-12 text-center text-sm text-gray-400">正在加载模板...</p> : templates.length ? <div className="space-y-3">{templates.map((template) => <article key={template.id} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02] sm:flex-row sm:items-center"><div className="h-24 w-full shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-white/[0.04] sm:w-32">{template.draft_cover_asset_id && <img src={getImageCreationAssetUrl(template.draft_cover_asset_id)} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{template.draft_data.title}</h2><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] dark:bg-white/[0.06]">{STATE_LABELS[template.state]}</span>{template.home_position && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">首页 {template.home_position}</span>}</div><p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{template.draft_data.summary}</p><p className="mt-2 text-xs text-gray-400">修订 {template.revision} · 发布版本 {template.published_version}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => edit(template)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">编辑</button>{template.state !== 'archived' && <button type="button" onClick={() => changeState(template, 'publish')} className="rounded-xl bg-teal-600 px-3 py-2 text-sm text-white">{template.state === 'published' ? '重新发布' : '发布'}</button>}{template.state !== 'archived' ? <button type="button" onClick={() => changeState(template, 'archive')} className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-500 dark:border-red-500/20">归档</button> : <button type="button" onClick={() => changeState(template, 'restore')} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">恢复</button>}</div></article>)}</div> : <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 dark:border-white/[0.12]">还没有模板，点击“新建模板”开始。</div>}
        </section>}
      </main>
      {editing !== undefined && <TemplateEditor template={editing} onClose={() => setEditing(undefined)} onSaved={(saved) => { setEditing(saved); void load() }} />}
    </>
  )
}

import { getEmbeddedSessionAuthorization, invalidateEmbeddedSession } from './embeddedSession'

export interface ImageCreationTemplateDefaults {
  size: '1024x1024' | '1536x1024' | '1024x1536'
  quality: 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
}

export interface ImageCreationTemplateSource {
  name?: string
  url?: string
  license?: string
  notes?: string
}

export interface ImageCreationTemplateDocument {
  schema_version: 1
  title: string
  summary: string
  category: string
  tags: string[]
  prompt: string
  input_mode: 'text' | 'reference_optional' | 'reference_required'
  cover_alt: string
  cover_fit?: 'cover' | 'contain'
  defaults: ImageCreationTemplateDefaults
  source?: ImageCreationTemplateSource
}

export interface ImageCreationTemplateListItem {
  id: number
  title: string
  summary: string
  category: string
  tags: string[]
  cover_asset_id?: string
  cover_fit?: ImageCreationTemplateDocument['cover_fit']
  published_version: number
  defaults: ImageCreationTemplateDefaults
  input_mode: ImageCreationTemplateDocument['input_mode']
  home_position?: number
  favorited: boolean
}

export interface ImageCreationTemplateDetail extends ImageCreationTemplateListItem {
  prompt: string
  cover_alt: string
  source?: ImageCreationTemplateSource
}

export interface ImageCreationAdminTemplate {
  id: number
  state: 'draft' | 'published' | 'archived'
  draft_data: ImageCreationTemplateDocument
  published_data?: ImageCreationTemplateDocument
  revision: number
  published_version: number
  draft_cover_asset_id?: string
  published_cover_asset_id?: string
  home_position?: number
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
  published_at?: string
}

export interface ImageCreationPage<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface ImageCreationTemplateApplication {
  template_id: number
  published_version: number
  prompt: string
  defaults: ImageCreationTemplateDefaults
  input_mode: ImageCreationTemplateDocument['input_mode']
}

export interface ImageCreationHomeFeatured {
  template_ids: number[]
  templates: ImageCreationAdminTemplate[]
  etag: string
}

export class ImageCreationApiError extends Error {
  status: number
  reason: string

  constructor(message: string, status: number, reason = '') {
    super(message)
    this.name = 'ImageCreationApiError'
    this.status = status
    this.reason = reason
  }
}

async function imageCreationRequest<T>(path: string, init: RequestInit = {}, request: typeof fetch = fetch) {
  const authorization = getEmbeddedSessionAuthorization()
  if (!authorization) throw new ImageCreationApiError('图像创作会话不可用，请返回 NanaFox 后重新打开。', 401, 'IMAGE_CREATION_SESSION_INVALID')
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('Authorization', authorization)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const response = await request(path, { ...init, headers, cache: 'no-store' })
  const payload = await response.json().catch(() => null) as { code?: number, message?: string, reason?: string, data?: T } | null
  if (!response.ok || !payload || payload.code !== 0 || payload.data === undefined) {
    const message = payload?.message || `图像创作请求失败：HTTP ${response.status}`
    if (response.status === 401 || response.status === 403) invalidateEmbeddedSession(message)
    throw new ImageCreationApiError(message, response.status, payload?.reason)
  }
  return { data: payload.data, response }
}

function ensureImageCreationPage<T>(value: unknown): ImageCreationPage<T> {
  if (!value || typeof value !== 'object') throw new ImageCreationApiError('图像创作服务返回了无效数据', 502)
  const page = value as Partial<ImageCreationPage<T>>
  if (!Array.isArray(page.items) || typeof page.total !== 'number' || typeof page.page !== 'number' || typeof page.page_size !== 'number' || typeof page.pages !== 'number') {
    throw new ImageCreationApiError('图像创作服务返回了无效数据', 502)
  }
  return page as ImageCreationPage<T>
}

export function getImageCreationAssetUrl(id: string | undefined) {
  return id ? `/api/v1/image-creation/assets/${encodeURIComponent(id)}/content` : ''
}

export async function listImageCreationTemplates(
  filters: { q?: string, category?: string, tag?: string, favorite?: boolean, recent?: boolean, home?: boolean, page?: number, pageSize?: number } = {},
  request: typeof fetch = fetch,
) {
  const query = new URLSearchParams()
  if (filters.q?.trim()) query.set('q', filters.q.trim())
  if (filters.category) query.set('category', filters.category)
  if (filters.tag) query.set('tag', filters.tag)
  if (filters.favorite) query.set('favorite', 'true')
  if (filters.recent) query.set('recent', 'true')
  if (filters.home) query.set('home', 'true')
  query.set('page', String(filters.page ?? 1))
  query.set('page_size', String(filters.pageSize ?? 24))
  return ensureImageCreationPage<ImageCreationTemplateListItem>((await imageCreationRequest<unknown>(`/api/v1/image-creation/templates?${query}`, {}, request)).data)
}

export async function getImageCreationTemplate(id: number, request: typeof fetch = fetch) {
  return (await imageCreationRequest<ImageCreationTemplateDetail>(`/api/v1/image-creation/templates/${id}`, {}, request)).data
}

export async function setImageCreationTemplateFavorite(id: number, favorite: boolean, request: typeof fetch = fetch) {
  await imageCreationRequest(`/api/v1/image-creation/templates/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' }, request)
}

export async function applyImageCreationTemplate(id: number, publishedVersion: number, request: typeof fetch = fetch) {
  return (await imageCreationRequest<ImageCreationTemplateApplication>(`/api/v1/image-creation/templates/${id}/apply`, {
    method: 'POST',
    body: JSON.stringify({ published_version: publishedVersion }),
  }, request)).data
}

export async function listImageCreationAdminTemplates(filters: { q?: string, state?: string, page?: number, pageSize?: number } = {}) {
  const query = new URLSearchParams()
  if (filters.q?.trim()) query.set('q', filters.q.trim())
  if (filters.state) query.set('state', filters.state)
  query.set('page', String(filters.page ?? 1))
  query.set('page_size', String(filters.pageSize ?? 50))
  return ensureImageCreationPage<ImageCreationAdminTemplate>((await imageCreationRequest<unknown>(`/api/v1/admin/image-creation/templates?${query}`)).data)
}

export async function getImageCreationAdminTemplate(id: number) {
  return (await imageCreationRequest<ImageCreationAdminTemplate>(`/api/v1/admin/image-creation/templates/${id}`)).data
}

export async function createImageCreationTemplate(document: ImageCreationTemplateDocument, coverAssetId?: string) {
  return (await imageCreationRequest<ImageCreationAdminTemplate>('/api/v1/admin/image-creation/templates', {
    method: 'POST',
    body: JSON.stringify({ document, cover_asset_id: coverAssetId || null }),
  })).data
}

export async function updateImageCreationTemplate(id: number, revision: number, document: ImageCreationTemplateDocument, coverAssetId?: string) {
  return (await imageCreationRequest<ImageCreationAdminTemplate>(`/api/v1/admin/image-creation/templates/${id}/draft`, {
    method: 'PUT',
    headers: { 'If-Match': String(revision) },
    body: JSON.stringify({ document, cover_asset_id: coverAssetId || null }),
  })).data
}

export async function changeImageCreationTemplateState(id: number, action: 'publish' | 'archive' | 'restore', revision?: number) {
  const headers = revision ? { 'If-Match': String(revision) } : undefined
  return (await imageCreationRequest<ImageCreationAdminTemplate>(`/api/v1/admin/image-creation/templates/${id}/${action}`, { method: 'POST', headers })).data
}

export async function uploadImageCreationAsset(file: File, sourceType: 'uploaded' | 'generated' = 'uploaded') {
  const form = new FormData()
  form.set('file', file)
  form.set('source_type', sourceType)
  return (await imageCreationRequest<{ id: string }>('/api/v1/admin/image-creation/assets', { method: 'POST', body: form })).data
}

export async function getImageCreationHomeFeatured() {
  const result = await imageCreationRequest<{ template_ids: number[], templates: ImageCreationAdminTemplate[] }>('/api/v1/admin/image-creation/home-featured')
  return { ...result.data, etag: result.response.headers.get('ETag') ?? '' }
}

export async function replaceImageCreationHomeFeatured(etag: string, templateIds: number[]) {
  const result = await imageCreationRequest<{ template_ids: number[], templates: ImageCreationAdminTemplate[] }>('/api/v1/admin/image-creation/home-featured', {
    method: 'PUT',
    headers: { 'If-Match': etag },
    body: JSON.stringify({ template_ids: templateIds }),
  })
  return { ...result.data, etag: result.response.headers.get('ETag') ?? '' }
}

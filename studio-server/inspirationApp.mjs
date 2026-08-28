const SESSION_COOKIE = 'nanafox_studio_session'

export function createStudioInspirationApp(options = {}) {
  const sessions = options.sessions
  const inspirations = options.inspirations
  if (!sessions?.getSession || !inspirations?.listPublished) {
    throw new Error('Studio inspiration dependencies are required')
  }

  return {
    async handle(request) {
      const url = new URL(request.url)
      if (request.method !== 'GET' || url.pathname !== '/api/inspirations' || url.search) {
        return jsonError(404, 'NOT_FOUND', '接口不存在')
      }
      const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE] ?? ''
      const session = token ? await sessions.getSession(token) : null
      if (!session) return jsonError(401, 'UNAUTHENTICATED', '请先登录')
      try {
        const items = await inspirations.listPublished()
        return Response.json({ ok: true, data: items.map(publicInspiration) })
      } catch (error) {
        console.error('Studio inspiration request failed', error)
        return jsonError(500, 'INTERNAL_ERROR', '灵感暂时无法读取，请稍后重试')
      }
    },
  }
}

function publicInspiration(item) {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    description: item.description,
    prompt: item.prompt,
    image: item.image,
    featured: item.featured,
    sortOrder: item.sortOrder,
    version: item.version,
  }
}

function parseCookies(header) {
  const result = {}
  for (const part of String(header ?? '').split(';')) {
    const idx = part.indexOf('=')
    if (idx < 1) continue
    result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return result
}

function jsonError(status, reason, message) {
  return Response.json({ ok: false, error: { reason, message } }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

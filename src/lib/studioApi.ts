export function studioApiPath(path: string, base = import.meta.env.BASE_URL) {
  return `${base}api/${path.replace(/^\/+/, '')}`
}

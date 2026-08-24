export function distributeGalleryItems<T>(items: T[], columnCount: number) {
  const columns = Array.from({ length: Math.max(1, columnCount) }, () => [] as T[])
  items.forEach((item, index) => columns[index % columns.length].push(item))
  return columns
}

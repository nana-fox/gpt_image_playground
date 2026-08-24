export function distributeGalleryItems<T>(items: T[], columnCount: number, getHeight: (item: T) => number = () => 1) {
  const columns = Array.from({ length: Math.max(1, columnCount) }, () => [] as T[])
  const heights = columns.map(() => 0)
  items.forEach((item) => {
    const index = heights.indexOf(Math.min(...heights))
    columns[index].push(item)
    const height = getHeight(item)
    heights[index] += Number.isFinite(height) && height > 0 ? height : 1
  })
  return columns
}

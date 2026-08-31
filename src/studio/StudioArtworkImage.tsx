import { useEffect, useState } from 'react'
import { ImageBroken } from '@phosphor-icons/react'

export function StudioArtworkImage({ src, alt }: { src: string, alt: string }) {
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setRetry(0)
    setFailed(false)
  }, [src])

  if (failed) {
    return <span className="artwork-load-error" role="status"><ImageBroken size={23} />作品暂时无法显示</span>
  }

  const separator = src.includes('?') ? '&' : '?'
  return <img src={retry ? `${src}${separator}retry=${retry}` : src} alt={alt} onError={() => retry < 2 ? setRetry(retry + 1) : setFailed(true)} />
}

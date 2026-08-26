import { describe, expect, it } from 'vitest'

import mainSource from '../main.tsx?raw'
import viteSource from '../../vite.config.ts?raw'
import source from './StudioApp.tsx?raw'

describe('NanaFox Studio product shell', () => {
  it('loads only in the Studio deployment flavor', () => {
    expect(mainSource).toContain('isNanafoxStudio')
    expect(mainSource).toContain("import('./studio/StudioApp')")
    expect(mainSource).toContain("document.title = 'NanaFox Studio'")
    expect(viteSource).toContain("mode === 'nanafox-studio'")
    expect(viteSource).toContain('nanafox-studio-index')
    expect(viteSource).toContain("'/api'")
  })

  it('provides native email login, registration, verification and 2FA', () => {
    expect(source).toContain('data-studio-auth')
    expect(source).toContain('登录 NanaFox Studio')
    expect(source).toContain('创建账户')
    expect(source).toContain('发送验证码')
    expect(source).toContain('两步验证')
    expect(source).toContain('loginStudio2FA')
  })

  it('does not redirect users to ChatGPT, Google, or Router login', () => {
    expect(source).not.toContain('ChatGPT')
    expect(source).not.toContain('Google')
    expect(source).not.toContain('router.nanafox.com')
    expect(source).not.toContain('oauth')
    expect(source).not.toContain('window.location.href')
  })

  it('does not present mock quota or fake generation as production state', () => {
    expect(source).not.toContain('今日 2/3 次')
    expect(source).not.toContain('setTimeout')
    expect(source).not.toContain('生成成功')
    expect(source).toContain('创作服务正在接入此账户')
    expect(source).toContain('账户服务暂时不可用，请稍后重试')
    expect(source).toContain('getStudioQuota')
    expect(source).toContain('今日免费剩余')
    expect(source).toContain('购买或订阅额度')
  })
})

import { describe, expect, it } from 'vitest'

import mainSource from '../main.tsx?raw'
import viteSource from '../../vite.config.ts?raw'
import source from './StudioApp.tsx?raw'
import adminSource from './StudioAdminPage.tsx?raw'

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

  it('uses the real quota, generation, and artwork APIs without mock production state', () => {
    expect(source).not.toContain('今日 2/3 次')
    expect(source).not.toContain('setTimeout')
    expect(source).not.toContain('生成成功')
    expect(source).toContain('账户服务暂时不可用，请稍后重试')
    expect(source).toContain('getStudioQuota')
    expect(source).toContain('createStudioGeneration')
    expect(source).toContain('listStudioGenerations')
    expect(source).toContain('开始创作')
    expect(source).toContain('作品库')
    expect(source).toContain('今日免费额度')
    expect(source).toContain('购买或订阅额度')
    expect(source).not.toContain('创作服务正在接入此账户')
    expect(source).toContain("err.reason !== 'GENERATION_FINALIZATION_PENDING'")
  })

  it('implements the approved Demo product shell instead of an alternate workspace', () => {
    expect(source).toContain("import './studio.css'")
    expect(source).toContain('首页')
    expect(source).toContain('灵感')
    expect(source).toContain('作品')
    expect(source).toContain('今天想做什么')
    expect(source).toContain('从灵感开始')
    expect(source).toContain('最近创作')
    expect(source).toContain('先找到感觉，再开始创作')
    expect(source).toContain('作品库')
    expect(source).not.toContain("lg:grid-cols-[390px_minmax(0,1fr)]")
  })

  it('shows the real operations tools only to configured operators', () => {
    expect(source).toContain('getStudioAdminSession')
    expect(source).toContain("type StudioRoute = 'create' | 'inspiration' | 'works' | 'points' | 'settings' | 'admin'")
    expect(source).toContain('运营管理')
    expect(adminSource).toContain('每日免费额度')
    expect(adminSource).toContain('给单个用户增加额度')
    expect(adminSource).toContain('searchStudioUsers')
    expect(adminSource).toContain('grantStudioCredits')
    expect(`${source}${adminSource}`).not.toContain('模拟支付成功')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import mainSource from '../main.tsx?raw'
import viteSource from '../../vite.config.ts?raw'
import source from './StudioApp.tsx?raw'
import adminSource from './StudioAdminPage.tsx?raw'

const styles = readFileSync(new URL('./studio.css', import.meta.url), 'utf8')

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
    expect(source).toContain('忘记密码')
    expect(source).toContain('重置密码')
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
    expect(source).toContain('listStudioInspirations')
    expect(source).toContain('createStudioGeneration')
    expect(source).toContain('listStudioGenerations')
    expect(source).toContain('开始创作')
    expect(source).toContain('作品库')
    expect(source).toContain('今日免费额度')
    expect(source).toContain('购买或订阅额度')
    expect(source).toContain('最近删除')
    expect(source).toContain('deleteStudioGeneration')
    expect(source).toContain('restoreStudioGeneration')
    expect(source).not.toContain('创作服务正在接入此账户')
    expect(source).toContain("err.reason !== 'GENERATION_FINALIZATION_PENDING'")
  })

  it('blocks creation while quota is unavailable and exposes a retry', () => {
    expect(source).toContain('disabled={generating || quota === undefined || quota === null}')
    expect(source).toContain('额度暂时无法读取，请重试后再创作')
    expect(source).toContain('重新读取额度')
  })

  it('keeps failed work requests distinct from an empty library and exposes a retry', () => {
    expect(source).toContain("setTasks(tasksResult.status === 'fulfilled' ? tasksResult.value : undefined)")
    expect(source).toContain("setTasksError(tasksResult.status === 'rejected' ? '作品记录暂时无法读取，请重试' : '')")
    expect(source).toContain('tasksError={tasksError}')
    expect(source).toContain('重新读取作品')
    expect(source).not.toContain('setDeletedTasks([])')
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
    expect(source).toContain('listStudioPaymentPlans')
    expect(source).toContain('createStudioPaymentOrder')
    expect(source).not.toContain('订阅即将开放')
    expect(source).toContain('运营管理')
    expect(adminSource).toContain('每日免费额度')
    expect(adminSource).toContain('给用户增加额度')
    expect(adminSource).toContain('searchStudioUsers')
    expect(adminSource).toContain('grantStudioCredits')
    expect(adminSource).toContain('getStudioPaymentPlans')
    expect(adminSource).toContain('updateStudioPaymentPlan')
    expect(adminSource).toContain('getStudioPaymentChannel')
    expect(adminSource).toContain('updateStudioPaymentChannel')
    expect(adminSource).toContain('支付渠道')
    expect(adminSource).toContain('生图服务')
    expect(adminSource).toContain('getStudioGenerationChannel')
    expect(adminSource).toContain('updateStudioGenerationChannel')
    expect(adminSource).toContain('灵感内容')
    expect(adminSource).toContain('getStudioAdminInspirations')
    expect(adminSource).toContain('createStudioInspiration')
    expect(adminSource).toContain('updateStudioInspiration')
    expect(adminSource).toContain('服务端凭证')
    expect(adminSource).not.toContain('APIv3 Key')
    expect(adminSource).not.toContain('商户私钥')
    expect(adminSource).not.toContain('ROUTER_IMAGE_API_KEY')
    expect(adminSource).not.toContain('ROUTER_IMAGE_BASE_URL')
    expect(`${source}${adminSource}`).not.toContain('模拟支付成功')
    expect(source).toContain('支付宝扫码支付')
    expect(source).toContain('className="studio-alipay-checkout"')
    expect(source).not.toContain('window.location.assign(next.payUrl)')
  })

  it('crops the embedded Alipay cashier to the QR code size', () => {
    expect(styles).toMatch(/\.studio-alipay-checkout\s*\{[^}]*width:\s*236px;[^}]*height:\s*236px;/s)
  })

  it('uses a task-oriented operations console instead of exposing every write form at once', () => {
    expect(adminSource).toContain('data-admin-shell')
    expect(adminSource).toContain('aria-label="运营模块"')
    expect(adminSource).toContain('运营总览')
    expect(adminSource).toContain('用户额度')
    expect(adminSource).toContain('套餐与价格')
    expect(adminSource).toContain('确认发放')
    expect(adminSource).toContain('编辑套餐')
  })

  it('does not present unfinished controls as working product features', () => {
    expect(source).not.toContain('aria-label="作品筛选"')
    expect(source).toContain('秒后重新发送')
    expect(source).toContain('账户资料')
    expect(source).not.toContain('<input value={displayName} readOnly />')
  })

  it('closes account navigation before opening another module', () => {
    expect(source).toContain("setAccountOpen(false); navigate('points')")
    expect(source).toContain("setAccountOpen(false); navigate('settings')")
    expect(source).toContain("setAccountOpen(false); navigate('admin')")
  })

  it('keeps header popovers and long account identities usable on narrow screens', () => {
    expect(source).toContain('aria-label="账户菜单"')
    expect(source).toContain('aria-expanded={accountOpen}')
    expect(source).toContain('aria-expanded={quotaOpen}')
    expect(styles).toContain('.account-summary > span:last-child')
    expect(styles).toContain('overflow-wrap: anywhere')
    expect(styles).toContain('position: fixed')
    expect(styles).toContain('width: 280px')
    expect(styles).toContain('width: min(320px, calc(100vw - 24px))')
    expect(styles).toContain('right: 12px')
    expect(styles).toContain('min-width: 0')
    expect(styles).not.toContain('width: 100vw')
    expect(source).toContain("document.addEventListener('pointerdown', closeOnPointerDown)")
    expect(source).toContain("if (event.key !== 'Escape') return")
    expect(source).toContain("document.documentElement.style.overflow = 'hidden'")
  })

  it('reuses defined visual tokens in the live quota card', () => {
    expect(styles).not.toContain('var(--panel)')
    expect(styles).not.toContain('var(--border)')
    expect(styles).not.toContain('var(--blue-soft)')
  })
})

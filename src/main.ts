import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { createScheduler } from './domain/scheduler'
import { LocalStorageRepo } from './storage/repo'
import { App } from './ui/app'

const root = document.getElementById('app')!

async function main(): Promise<void> {
  registerSW({ immediate: true })
  // ブラウザにデータを消されにくくする（対応していない環境では何もしない）
  navigator.storage?.persist?.().catch(() => {})
  const scheduler = await createScheduler()
  new App(root, new LocalStorageRepo(), scheduler).start()
}

main().catch((e: unknown) => {
  root.textContent = `起動できませんでした: ${e instanceof Error ? e.message : String(e)}`
})

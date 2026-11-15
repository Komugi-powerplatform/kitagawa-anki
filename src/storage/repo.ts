import type { AppData } from '../domain/card'
import { emptyData, isAppData } from './backup'

export interface Repo {
  load(): AppData
  save(data: AppData): void
}

export const STORAGE_KEY = 'kitagawa-anki:v1'

/** 端末のブラウザに保存する（iPhone ではホーム画面に追加したアプリ内に残る） */
export class LocalStorageRepo implements Repo {
  load(): AppData {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyData()
    const parsed: unknown = JSON.parse(raw)
    if (!isAppData(parsed)) throw new Error('保存データの形式が読めません。バックアップから取り込み直してください。')
    return parsed
  }
  save(data: AppData): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

/** テスト用 */
export class MemoryRepo implements Repo {
  private raw: string | null = null
  load(): AppData {
    return this.raw ? (JSON.parse(this.raw) as AppData) : emptyData()
  }
  save(data: AppData): void {
    this.raw = JSON.stringify(data)
  }
}

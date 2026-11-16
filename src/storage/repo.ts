import type { AppData } from '../domain/card'
import { emptyData } from './backup'
import { migrate } from './migrate'

export interface Repo {
  load(): AppData
  save(data: AppData): void
}

/** 保存先のキー（名前は第1弾のまま。中身は version 2） */
export const STORAGE_KEY = 'kitagawa-anki:v1'
/** 第1弾の形から移行したとき、移行前のデータを1世代だけ残しておくキー */
export const PRE_MIGRATION_KEY = 'kitagawa-anki:before-v2'
/** 読めなかった保存データを残しておくキー */
export const CORRUPT_KEY = 'kitagawa-anki:unreadable'

/** 端末のブラウザに保存する（iPhone ではホーム画面に追加したアプリ内に残る） */
export class LocalStorageRepo implements Repo {
  load(): AppData {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyData()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const data = parsed === undefined ? null : migrate(parsed)
    if (!data) {
      try {
        localStorage.setItem(CORRUPT_KEY, raw)
      } catch {
        // 残せなくても、元のキーは次に保存するまで上書きされない
      }
      throw new Error('保存データが読めませんでした。バックアップのファイルを選んで取り込み直してください。')
    }
    if ((parsed as { version?: number }).version !== data.version || data !== parsed) {
      // 移行に成功したときだけ、移行前を残してから新しい形で保存する
      try {
        localStorage.setItem(PRE_MIGRATION_KEY, raw)
        this.save(data)
      } catch {
        // 容量不足などで保存できなくても、読み込んだデータでそのまま使える（次の保存時に再挑戦）
      }
    }
    return data
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

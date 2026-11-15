/** 出題の計算に必要な状態。ts-fsrs のカードを JSON で保存できる形にしたもの（日時は ISO 文字列）。 */
export interface Sched {
  dueAt: string
  lastReviewAt: string | null
  reps: number
  lapses: number
  /** 0=新規 1=学習中 2=復習 3=再学習（ts-fsrs の State と同じ値） */
  state: number
  [key: string]: unknown
}

export interface Deck {
  id: string
  name: string
  /** 1日の新規カードの上限。未指定なら全体の設定 */
  newPerDay?: number
  /** 1日の復習カードの上限。未指定なら全体の設定 */
  reviewPerDay?: number
}

/** ノートの型: 基本／基本（逆向きも）／穴埋め */
export type NoteType = 'basic' | 'reverse' | 'cloze'

/** 入力の単位。穴埋めでは front が {{c1::…}} を含む文、back が補足 */
export interface Note {
  id: string
  deckId: string
  type: NoteType
  front: string
  back: string
  createdAt: string
}

/** 出題の単位。ord は基本=0、逆向き=0/1、穴埋め=穴の番号 */
export interface CardRec {
  id: string
  noteId: string
  deckId: string
  ord: number
  /** 新規カードの出す順に使う */
  createdAt: string
  sched: Sched
  /** 保留: この日時まで出さない */
  buried?: string
  /** 停止: 再開するまで出さない */
  suspended?: boolean
}

export interface LogRec {
  cardId: string
  /** 第2弾から記録。デッキごとの上限を数えるのに使う */
  deckId?: string
  at: string
  rating: number
  /** このカードを初めて答えた記録か（1日の新規枚数を数えるのに使う） */
  wasNew: boolean
  /** 答える前の状態。2（復習）なら1日の復習枚数に数える */
  prevState?: number
}

export interface AppData {
  version: 2
  decks: Deck[]
  notes: Note[]
  cards: CardRec[]
  logs: LogRec[]
}

export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const

export function newId(): string {
  return crypto.randomUUID()
}

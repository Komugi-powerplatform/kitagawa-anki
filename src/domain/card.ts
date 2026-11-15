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
}

export interface CardRec {
  id: string
  deckId: string
  front: string
  back: string
  createdAt: string
  sched: Sched
}

export interface LogRec {
  cardId: string
  at: string
  rating: number
  /** このカードを初めて答えた記録か（1日の新規枚数を数えるのに使う） */
  wasNew: boolean
}

export interface AppData {
  version: 1
  decks: Deck[]
  cards: CardRec[]
  logs: LogRec[]
}

export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const

export function newId(): string {
  return crypto.randomUUID()
}

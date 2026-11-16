import { newId, type AppData, type CardRec, type Deck, type Note, type NoteType } from '../domain/card'
import { applyLeech, LEECH_THRESHOLD } from '../domain/leech'
import { renderCard, syncCards, validateNote, type Seg } from '../domain/note'
import { buildQueue, countsForDeck, nextDayStart, nextLearningDue, type Limits } from '../domain/queue'
import { formatInterval, GRADES, Rating, type Grade, type Scheduler } from '../domain/scheduler'
import { exportJson, importJson, pruneDecks, removeDeck, removeNote } from '../storage/backup'
import type { Repo } from '../storage/repo'
import { h } from './dom'

type Screen =
  | { name: 'home' }
  | { name: 'review'; deckId?: string }
  | { name: 'cards' }
  | { name: 'note'; noteId?: string; returnTo?: Screen }
  | { name: 'deck'; deckId: string }
  | { name: 'settings' }

const SETTINGS_KEY = 'kitagawa-anki:settings'
const LAST_DECK_KEY = 'kitagawa-anki:lastDeck'
const LAST_TYPE_KEY = 'kitagawa-anki:lastType'
/** 学習中カードは、ほかに出すものが無ければ20分先までは前倒しで出す（Anki の初期設定と同じ） */
const LEARN_AHEAD_MS = 20 * 60_000
const DEFAULT_LIMITS: Limits = { newPerDay: 20, reviewPerDay: 200 }
/** 答えを出した直後は、この時間だけ答えのボタンを受け付けない（「答えを見る」の2度押しで答えてしまうのを防ぐ） */
export const GRADE_GUARD_MS = 350

const GRADE_LABEL: Record<Grade, string> = {
  [Rating.Again]: 'もう一度',
  [Rating.Hard]: '難しい',
  [Rating.Good]: '普通',
  [Rating.Easy]: '簡単',
}

const TYPE_LABEL: Record<NoteType, string> = { basic: '基本', reverse: '基本（逆向きも）', cloze: '穴埋め' }

type StatusFilter = 'all' | 'new' | 'buried' | 'suspended' | 'leech'

function readLimit(v: unknown, fallback: number): number {
  return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fallback
}

function loadSettings(): Limits {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return { newPerDay: readLimit(s.newPerDay, DEFAULT_LIMITS.newPerDay), reviewPerDay: readLimit(s.reviewPerDay, DEFAULT_LIMITS.reviewPerDay) }
  } catch {
    return { ...DEFAULT_LIMITS }
  }
}

/** 0〜9999 の整数にする。空欄は undefined（＝全体の設定に従う） */
function parseLimit(text: string): number | undefined {
  if (!text.trim()) return undefined
  return Math.max(0, Math.min(9999, Math.floor(Number(text) || 0)))
}

function segsEl(segs: Seg[], cls: string): HTMLElement {
  return h('div', { class: cls }, ...segs.map((s) => (s.kind === 'plain' ? s.text : h('span', { class: `seg-${s.kind}` }, s.text))))
}

export class App {
  private data: AppData
  private settings = loadSettings()
  private screen: Screen = { name: 'home' }
  /** 答えを表示しているカードの ID。カードが変わったら自動で問題側に戻るよう、真偽値でなく ID で持つ */
  private revealedId: string | null = null
  /** 取り消し用。操作前のカードと、その時点の回答記録の件数 */
  private undoStack: { cards: CardRec[]; logsLen: number; label: string }[] = []
  /** 取り消し・編集の直後は、そのカードをもう一度出す */
  private forcedCardId: string | null = null
  private menuOpen = false
  /** 答えを出した時刻（performance.now） */
  private revealedAt = 0
  /** バックアップで置き換える前の確認待ち */
  private pendingReplace: AppData | null = null
  private filter: { q: string; deckId: string; status: StatusFilter } = { q: '', deckId: '', status: 'all' }
  private flash: { text: string; kind: 'ok' | 'error' } | null = null

  constructor(
    private root: HTMLElement,
    private repo: Repo,
    private scheduler: Scheduler,
    private now: () => Date = () => new Date(),
  ) {
    try {
      this.data = repo.load()
    } catch (e) {
      // 保存データが読めないときも、取り込み画面からバックアップで戻せるように空の状態で始める（壊れたデータは repo が別のキーに残す）
      this.data = { version: 2, decks: [], notes: [], cards: [], logs: [] }
      this.screen = { name: 'settings' }
      this.say(`${e instanceof Error ? e.message : String(e)} 読めなかったデータは端末に残してあります。`, 'error')
    }
  }

  start(): void {
    this.render()
    document.addEventListener('visibilitychange', () => {
      // 入力中の画面は描き直さない（書きかけが消えるため）
      if (document.visibilityState === 'visible' && this.screen.name !== 'note' && this.screen.name !== 'deck') this.render()
    })
  }

  private go(screen: Screen): void {
    this.screen = screen
    this.revealedId = null
    this.menuOpen = false
    this.pendingReplace = null
    this.render()
    window.scrollTo(0, 0)
  }

  /** 保存できたときだけ画面のデータを差し替える。容量オーバーなどで失敗したら知らせて、元のままにする */
  private commit(data: AppData): boolean {
    try {
      this.repo.save(data)
    } catch (e) {
      this.say(`保存できませんでした（${e instanceof Error ? e.name : '不明なエラー'}）。設定からバックアップを書き出してください。`, 'error')
      return false
    }
    this.data = data
    return true
  }

  private say(text: string, kind: 'ok' | 'error' = 'ok'): void {
    this.flash = { text, kind }
  }

  private opts(deckId?: string) {
    return { defaults: this.settings, deckId }
  }

  private deckName(id: string): string {
    return this.data.decks.find((d) => d.id === id)?.name ?? ''
  }

  private noteOf(card: CardRec): Note | undefined {
    return this.data.notes.find((n) => n.id === card.noteId)
  }

  render(): void {
    const s = this.screen
    let body: HTMLElement
    try {
      body =
        s.name === 'home' ? this.home()
        : s.name === 'review' ? this.review(s.deckId)
        : s.name === 'cards' ? this.cards()
        : s.name === 'note' ? this.noteEditor(s.noteId, s.returnTo)
        : s.name === 'deck' ? this.deckScreen(s.deckId)
        : this.settingsScreen()
    } catch (e) {
      // 画面が黙って止まらないよう、原因を出して戻れるようにする
      console.error(e)
      body = h('div', { class: 'panel confirm', role: 'alert' }, h('h2', {}, 'この画面を表示できませんでした'), h('p', {}, e instanceof Error ? e.message : String(e)), h('p', { class: 'hint' }, 'データは保存されたままです。設定からバックアップを書き出しておくと安心です。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'home' }) }, 'ホームへ'))
    }
    const flash = this.flash
    this.flash = null
    this.root.replaceChildren(
      h('main', { class: `screen screen-${s.name}` }, flash && h('p', { class: `flash flash-${flash.kind}`, role: 'status' }, flash.text), body),
      this.nav(),
    )
  }

  private nav(): HTMLElement {
    const active = this.screen.name === 'note' ? 'cards' : this.screen.name === 'deck' || this.screen.name === 'review' ? 'home' : this.screen.name
    const item = (name: 'home' | 'cards' | 'settings', label: string) =>
      h('button', { class: `nav-item${active === name ? ' active' : ''}`, onclick: () => this.go({ name }) }, label)
    return h('nav', { class: 'nav' }, item('home', 'ホーム'), item('cards', 'カード'), item('settings', '設定'))
  }

  // ---------- ホーム ----------
  private home(): HTMLElement {
    const now = this.now()
    if (this.data.cards.length === 0) {
      return h(
        'section',
        {},
        h('h1', {}, 'KitagawaAnki'),
        h('div', { class: 'empty' }, h('p', {}, 'カードがまだありません。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'settings' }) }, 'ファイルから取り込む'), h('button', { class: 'ghost', onclick: () => this.go({ name: 'note' }) }, '自分で追加する')),
      )
    }
    const all = countsForDeck(this.data, now, this.opts())
    const rows = [...this.data.decks]
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      .map((d) => {
        const c = countsForDeck(this.data, now, this.opts(d.id))
        return h(
          'div',
          { class: 'deck' },
          h('button', { class: 'deck-main', onclick: () => this.go({ name: 'review', deckId: d.id }) }, h('span', { class: 'deck-name' }, d.name), h('span', { class: 'deck-total' }, `${c.total}枚`), this.counts(c)),
          h('button', { class: 'deck-more', 'aria-label': `${d.name} の設定`, onclick: () => this.go({ name: 'deck', deckId: d.id }) }, '⋯'),
        )
      })
    const remaining = all.new + all.learning + all.review
    return h(
      'section',
      {},
      h('h1', {}, 'KitagawaAnki'),
      h('div', { class: 'today' }, h('p', { class: 'today-label' }, '今日の残り'), this.counts(all), h('p', { class: 'hint legend' }, h('span', { class: 'n-new' }, '新規'), ' ・ ', h('span', { class: 'n-learn' }, '学習中'), ' ・ ', h('span', { class: 'n-review' }, '復習')), h('button', { class: 'primary big', disabled: remaining === 0, onclick: () => this.go({ name: 'review' }) }, remaining === 0 ? '今日の分は終わりました' : 'すべてのデッキを学習する')),
      h('div', { class: 'section-head' }, h('h2', {}, 'デッキ'), h('button', { class: 'ghost small', onclick: () => this.go({ name: 'note' }) }, '＋ カードを追加')),
      h('div', { class: 'decks' }, ...rows),
    )
  }

  private counts(c: { new: number; learning: number; review: number }): HTMLElement {
    return h('span', { class: 'counts' }, h('span', { class: 'n-new', title: '新規' }, String(c.new)), h('span', { class: 'n-learn', title: '学習中' }, String(c.learning)), h('span', { class: 'n-review', title: '復習' }, String(c.review)))
  }

  // ---------- 復習 ----------
  private currentCard(deckId?: string): { card: CardRec; ahead: boolean } | null {
    const now = this.now()
    if (this.forcedCardId) {
      const forced = this.data.cards.find((c) => c.id === this.forcedCardId && (!deckId || c.deckId === deckId) && this.isActiveNow(c, now))
      if (forced) return { card: forced, ahead: false }
      this.forcedCardId = null
    }
    const q = buildQueue(this.data, now, this.opts(deckId))
    if (q.length) return { card: q[0], ahead: false }
    const ahead = buildQueue(this.data, new Date(now.getTime() + LEARN_AHEAD_MS), { defaults: { newPerDay: 0, reviewPerDay: 0 }, deckId })
    // 先出しは20分先の時刻で選ぶので、保留・停止は「今」の時刻で確かめ直す
    const next = ahead.find((c) => this.isActiveNow(c, now))
    return next ? { card: next, ahead: true } : null
  }

  private isActiveNow(c: CardRec, now: Date): boolean {
    return !c.suspended && !(c.buried && new Date(c.buried).getTime() > now.getTime())
  }

  private review(deckId?: string): HTMLElement {
    const now = this.now()
    const current = this.currentCard(deckId)
    const counts = countsForDeck(this.data, now, this.opts(deckId))
    // 先出し中は今の1枚を学習中として数える（0 0 0 と出さない）
    if (current?.ahead) counts.learning += 1
    const header = h(
      'header',
      { class: 'review-head' },
      h('button', { class: 'back', onclick: () => this.go({ name: 'home' }) }, '‹ 戻る'),
      h('span', { class: 'review-deck' }, deckId ? this.deckName(deckId) : 'すべてのデッキ'),
      this.undoStack.length > 0 && h('button', { class: 'undo', onclick: () => this.undo() }, '↶ 取り消す'),
      current && h('button', { class: 'more', 'aria-label': 'カードの操作', onclick: () => ((this.menuOpen = !this.menuOpen), this.render()) }, '⋯'),
      this.counts(counts),
    )

    if (!current) {
      const next = nextLearningDue(this.data, now, deckId)
      return h(
        'section',
        {},
        header,
        h('div', { class: 'done' }, h('p', { class: 'done-title' }, 'おつかれさまでした'), h('p', {}, next ? `次のカードは ${next.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ごろに出せます。` : '今日のカードはすべて終わりました。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'home' }) }, 'ホームへ')),
      )
    }

    const card = current.card
    const note = this.noteOf(card)
    if (!note) {
      // 通常は起動時の normalize で外れるが、念のため外して先へ進めるようにする
      return h('section', {}, header, h('div', { class: 'panel confirm' }, h('p', {}, 'このカードのノートが見つかりません。'), h('button', { class: 'danger', onclick: () => {
        if (this.commit({ ...this.data, cards: this.data.cards.filter((c) => c.id !== card.id) })) this.say('ノートの無いカードを外しました。')
        this.render()
      } }, 'このカードを外して次へ')))
    }
    const r = renderCard(note, card.ord)
    const revealed = this.revealedId === card.id
    const reveal = () => {
      this.revealedId = card.id
      this.revealedAt = performance.now()
      this.menuOpen = false
      this.render()
      // 受け付けない間はボタンを薄くして、まだ押せないことを見せる
      const bar = this.root.querySelector('.grades')
      bar?.classList.add('arming')
      setTimeout(() => bar?.classList.remove('arming'), GRADE_GUARD_MS)
    }

    const menu =
      this.menuOpen &&
      h(
        'div',
        { class: 'menu', role: 'menu' },
        h('button', { role: 'menuitem', onclick: () => this.go({ name: 'note', noteId: note.id, returnTo: { name: 'review', deckId } }) }, '✎ 編集'),
        h('button', { role: 'menuitem', onclick: () => this.bury(card) }, '今日は保留（明日また出す）'),
        h('button', { role: 'menuitem', class: 'danger-text', onclick: () => this.suspend(card) }, '停止（再開するまで出さない）'),
        h('button', { role: 'menuitem', class: 'ghost', onclick: () => ((this.menuOpen = false), this.render()) }, '閉じる'),
      )

    const face = h(
      'div',
      { class: `card-face${note.type === 'cloze' ? ' cloze' : ''}`, onclick: revealed ? undefined : reveal },
      revealed && !r.showQuestionOnAnswer ? segsEl(r.answer, 'front') : segsEl(r.question, 'front'),
      revealed && r.showQuestionOnAnswer && h('hr', {}),
      revealed && r.showQuestionOnAnswer && segsEl(r.answer, 'back-text'),
    )
    const actions = revealed
      ? h(
          'div',
          { class: 'grades' },
          ...this.scheduler.preview(card.sched, now).map((p) =>
            h('button', { class: `grade grade-${p.rating}`, onclick: () => this.answer(card, p.rating) }, h('span', { class: 'grade-time' }, formatInterval(p.dueAt.getTime() - now.getTime())), h('span', { class: 'grade-label' }, GRADE_LABEL[p.rating])),
          ),
        )
      : h('div', { class: 'grades' }, h('button', { class: 'primary big reveal', onclick: reveal }, '答えを見る'))
    return h('section', {}, header, menu, face, actions)
  }

  /** カードを書き換えて保存し、取り消せるように元を積む */
  private changeCards(before: CardRec[], after: CardRec[], extra: Partial<AppData>, label: string): boolean {
    const byId = new Map(after.map((c) => [c.id, c]))
    const logsLen = this.data.logs.length
    const saved = this.commit({ ...this.data, ...extra, cards: this.data.cards.map((c) => byId.get(c.id) ?? c) })
    if (saved) {
      this.undoStack = [...this.undoStack.slice(-49), { cards: before, logsLen, label }]
      this.forcedCardId = null
      this.revealedId = null
      this.menuOpen = false
    }
    return saved
  }

  private answer(card: CardRec, rating: Grade): void {
    if (!GRADES.includes(rating)) return
    if (performance.now() - this.revealedAt < GRADE_GUARD_MS) return
    const r = this.scheduler.review(card.sched, rating, this.now())
    const leech = applyLeech(card, { ...card, sched: r.sched })
    const saved = this.changeCards([card], [leech.card], { logs: [...this.data.logs, { cardId: card.id, deckId: card.deckId, ...r.log }] }, '答え')
    if (saved && leech.leeched) this.say(`このカードは${leech.card.sched.lapses}回忘れたので停止しました（リーチ）。書き方を見直してから、カード画面で再開できます。`, 'error')
    this.render()
  }

  private bury(card: CardRec): void {
    if (this.changeCards([card], [{ ...card, buried: nextDayStart(this.now()).toISOString() }], {}, '保留')) this.say('今日は保留にしました。明日の朝にまた出ます。')
    this.render()
  }

  private suspend(card: CardRec): void {
    if (this.changeCards([card], [{ ...card, suspended: true }], {}, '停止')) this.say('停止しました。カード画面から再開できます。')
    this.render()
  }

  private undo(): void {
    const last = this.undoStack.at(-1)
    if (!last) return
    if (!last.cards.every((b) => this.data.cards.some((c) => c.id === b.id))) {
      // 編集や削除でカードが無くなっていたら、記録も含めて何も戻さない
      this.undoStack = this.undoStack.slice(0, -1)
      this.say(`${last.label}は取り消せませんでした（カードが編集・削除で無くなっています）。`, 'error')
      this.render()
      return
    }
    // 戻すのは出題に関わる状態だけ。デッキ・ノート・番号は今のまま（編集のあとに取り消してもノートとずれないように）
    const restore = new Map(last.cards.map((c) => [c.id, c]))
    const saved = this.commit({
      ...this.data,
      cards: this.data.cards.map((c) => {
        const b = restore.get(c.id)
        if (!b) return c
        const { buried, suspended, leech, ...rest } = c
        void buried, void suspended, void leech
        return { ...rest, sched: b.sched, ...(b.buried ? { buried: b.buried } : {}), ...(b.suspended ? { suspended: true } : {}), ...(b.leech ? { leech: true } : {}) }
      }),
      logs: this.data.logs.slice(0, last.logsLen),
    })
    if (saved) {
      this.undoStack = this.undoStack.slice(0, -1)
      const target = last.cards[0]
      this.forcedCardId = this.data.cards.some((c) => c.id === target.id) ? target.id : null
      this.revealedId = null
      this.menuOpen = false
      this.say(`${last.label}を取り消しました。`)
    }
    this.render()
  }

  // ---------- カード一覧 ----------
  private cardStatus(cards: CardRec[]): string {
    const now = this.now()
    if (cards.length && cards.every((c) => c.suspended)) return cards.some((c) => c.leech) ? '停止中（リーチ）' : '停止中'
    if (cards.some((c) => c.buried && new Date(c.buried) > now)) return '保留中'
    if (cards.every((c) => c.sched.reps === 0)) return '新規'
    const next = Math.min(...cards.filter((c) => c.sched.reps > 0 && !c.suspended).map((c) => new Date(c.sched.dueAt).getTime()))
    return Number.isFinite(next) ? `次回 ${new Date(next).toLocaleDateString('ja-JP')}` : ''
  }

  private matchesFilter(note: Note, cards: CardRec[]): boolean {
    const f = this.filter
    if (f.deckId && note.deckId !== f.deckId) return false
    const now = this.now()
    if (f.status === 'new' && !cards.some((c) => c.sched.reps === 0 && !c.suspended)) return false
    if (f.status === 'buried' && !cards.some((c) => c.buried && new Date(c.buried) > now)) return false
    if (f.status === 'suspended' && !cards.some((c) => c.suspended)) return false
    if (f.status === 'leech' && !cards.some((c) => c.leech)) return false
    const q = f.q.trim().toLowerCase()
    return !q || `${note.front}\n${note.back}`.toLowerCase().includes(q)
  }

  private noteList(): HTMLElement {
    const cardsByNote = new Map<string, CardRec[]>()
    for (const c of this.data.cards) cardsByNote.set(c.noteId, [...(cardsByNote.get(c.noteId) ?? []), c])
    const notes = [...this.data.notes].filter((n) => this.matchesFilter(n, cardsByNote.get(n.id) ?? [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return h(
      'div',
      { class: 'note-list-wrap' },
      h('p', { class: 'hint result-count' }, `${notes.length}件（ノート全${this.data.notes.length}件・カード${this.data.cards.length}枚）`),
      h(
        'ul',
        { class: 'card-list' },
        ...notes.map((n) => {
          const cards = cardsByNote.get(n.id) ?? []
          const front = n.type === 'cloze' ? n.front.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '[$1]') : n.front
          return h(
            'li',
            {},
            h(
              'button',
              { class: 'card-row', onclick: () => this.go({ name: 'note', noteId: n.id }) },
              h('span', { class: 'cr-front' }, front),
              h('span', { class: 'cr-back' }, n.back),
              h('span', { class: 'cr-meta' }, `${this.deckName(n.deckId)} ・ ${TYPE_LABEL[n.type]}${cards.length > 1 ? `（${cards.length}枚）` : ''} ・ ${this.cardStatus(cards)}`),
            ),
          )
        }),
      ),
    )
  }

  private cards(): HTMLElement {
    let listEl = this.noteList()
    // 検索欄は打つたびに一覧だけ描き直す（画面全体を描き直すと入力中の文字が消えるため）
    const refresh = () => {
      const next = this.noteList()
      listEl.replaceWith(next)
      listEl = next
    }
    const search = h('input', { type: 'search', placeholder: '表・裏・文で検索', value: this.filter.q, 'aria-label': '検索' })
    search.addEventListener('input', () => {
      this.filter = { ...this.filter, q: search.value }
      refresh()
    })
    const deckSel = h('select', { 'aria-label': 'デッキで絞り込む' }, h('option', { value: '' }, 'すべてのデッキ'), ...[...this.data.decks].sort((a, b) => a.name.localeCompare(b.name, 'ja')).map((d) => h('option', { value: d.id, selected: this.filter.deckId === d.id }, d.name)))
    deckSel.addEventListener('change', () => {
      this.filter = { ...this.filter, deckId: deckSel.value }
      refresh()
    })
    const statusOpts: [StatusFilter, string][] = [['all', 'すべて'], ['new', '新規'], ['buried', '保留中'], ['suspended', '停止中'], ['leech', `リーチ（${LEECH_THRESHOLD}回以上忘れた）`]]
    const statusSel = h('select', { 'aria-label': '状態で絞り込む' }, ...statusOpts.map(([v, label]) => h('option', { value: v, selected: this.filter.status === v }, label)))
    statusSel.addEventListener('change', () => {
      this.filter = { ...this.filter, status: statusSel.value as StatusFilter }
      refresh()
    })
    return h(
      'section',
      {},
      h('div', { class: 'section-head' }, h('h1', {}, 'カード'), h('button', { class: 'primary', onclick: () => this.go({ name: 'note' }) }, '＋ 追加')),
      h('div', { class: 'filters' }, search, h('div', { class: 'row' }, deckSel, statusSel)),
      listEl,
    )
  }

  // ---------- ノートの追加・編集 ----------
  private noteEditor(noteId?: string, returnTo?: Screen): HTMLElement {
    const editing = noteId ? this.data.notes.find((n) => n.id === noteId) : undefined
    if (noteId && !editing) return h('section', {}, h('p', {}, 'このノートは見つかりませんでした。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'cards' }) }, 'カード一覧へ'))
    const back: Screen = returnTo ?? { name: 'cards' }
    const decks = [...this.data.decks].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    const lastDeck = localStorage.getItem(LAST_DECK_KEY) ?? decks[0]?.name ?? 'デフォルト'
    let type: NoteType = editing?.type ?? ((localStorage.getItem(LAST_TYPE_KEY) as NoteType | null) ?? 'basic')
    if (!(type in TYPE_LABEL)) type = 'basic'

    const deckInput = h('input', { name: 'deck', list: 'deck-list', value: editing ? this.deckName(editing.deckId) : lastDeck, required: true, autocomplete: 'off' })
    const front = h('textarea', { name: 'front', rows: 3, value: editing?.front ?? '' })
    const backField = h('textarea', { name: 'back', rows: 3, value: editing?.back ?? '' })
    const frontLabel = h('span', {})
    const backLabel = h('span', {})
    const clozeTools = h(
      'div',
      { class: 'row cloze-tools' },
      h('button', { type: 'button', class: 'ghost small', onclick: () => this.wrapCloze(front, false) }, '[…] 穴にする'),
      h('button', { type: 'button', class: 'ghost small', onclick: () => this.wrapCloze(front, true) }, '[…] 同じ番号で穴にする'),
    )
    const clozeHint = h('p', { class: 'hint' }, '隠したい所を選んで「穴にする」を押すか、{{c1::答え}} と書きます。{{c1::答え::ヒント}} でヒントも出せます。番号ごとに1枚のカードになります。')
    const typeButtons = (Object.keys(TYPE_LABEL) as NoteType[]).map((t) =>
      h('button', { type: 'button', class: 'seg-btn', 'data-type': t, onclick: () => applyType(t) }, TYPE_LABEL[t]),
    )
    const applyType = (t: NoteType) => {
      type = t
      for (const b of typeButtons) b.classList.toggle('active', b.dataset.type === t)
      frontLabel.textContent = t === 'cloze' ? '文' : '表'
      backLabel.textContent = t === 'cloze' ? '補足（答えのあとに出る・空でも可）' : '裏'
      clozeTools.hidden = t !== 'cloze'
      clozeHint.hidden = t !== 'cloze'
    }
    applyType(type)

    const cardsOfNote = editing ? this.data.cards.filter((c) => c.noteId === editing.id).sort((a, b) => a.ord - b.ord) : []
    const form = h(
      'form',
      {
        class: 'card-form',
        onsubmit: (e: Event) => {
          e.preventDefault()
          this.saveNote(editing, { type, deckName: deckInput.value.trim(), front: front.value.trim(), back: backField.value.trim() }, back)
        },
      },
      h('div', { class: 'section-head' }, h('h1', {}, editing ? 'ノートを編集' : 'カードを追加'), h('button', { type: 'button', class: 'back', onclick: () => this.go(back) }, 'やめる')),
      h('div', { class: 'seg', role: 'group', 'aria-label': '型' }, ...typeButtons),
      h('label', {}, 'デッキ', deckInput),
      h('datalist', { id: 'deck-list' }, ...decks.map((d) => h('option', { value: d.name }))),
      h('label', {}, frontLabel, front),
      clozeTools,
      clozeHint,
      h('label', {}, backLabel, backField),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, editing ? '保存' : '追加'), editing && this.deleteNoteButton(editing)),
    )
    return h('section', {}, form, editing && this.cardStates(editing, cardsOfNote))
  }

  /** ノートにぶら下がるカードごとの状態と、保留解除・停止・再開 */
  private cardStates(note: Note, cards: CardRec[]): HTMLElement {
    const now = this.now()
    const label = (c: CardRec) => (note.type === 'cloze' ? `穴 ${c.ord}` : note.type === 'reverse' ? (c.ord === 0 ? '表 → 裏' : '裏 → 表') : 'カード')
    const update = (c: CardRec, patch: Partial<CardRec>, msg: string) => {
      const next = { ...c, ...patch }
      for (const k of Object.keys(patch) as (keyof CardRec)[]) if (patch[k] === undefined) delete next[k]
      if (this.commit({ ...this.data, cards: this.data.cards.map((x) => (x.id === c.id ? next : x)) })) this.say(msg)
      this.render()
    }
    return h(
      'div',
      { class: 'panel' },
      h('h2', {}, 'このノートのカード'),
      h(
        'ul',
        { class: 'card-states' },
        ...cards.map((c) => {
          const buried = c.buried && new Date(c.buried) > now
          return h(
            'li',
            {},
            h('span', { class: 'cs-label' }, label(c)),
            h('span', { class: 'cs-status' }, c.suspended ? (c.leech ? `停止中（リーチ・${c.sched.lapses}回忘れた）` : '停止中') : buried ? '保留中' : c.sched.reps === 0 ? '新規' : `次回 ${new Date(c.sched.dueAt).toLocaleDateString('ja-JP')}`),
            c.suspended
              ? h('button', { type: 'button', class: 'ghost small', onclick: () => update(c, { suspended: undefined }, `${label(c)}を再開しました。`) }, '再開')
              : h('button', { type: 'button', class: 'ghost small', onclick: () => update(c, { suspended: true }, `${label(c)}を停止しました。`) }, '停止'),
            buried && h('button', { type: 'button', class: 'ghost small', onclick: () => update(c, { buried: undefined }, `${label(c)}の保留を解除しました。`) }, '保留を解除'),
          )
        }),
      ),
    )
  }

  /** 選んだ文字を {{cN::…}} で囲む。sameNumber なら最後に使った番号、そうでなければ新しい番号 */
  private wrapCloze(area: HTMLTextAreaElement, sameNumber: boolean): void {
    const nums = [...area.value.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))
    const max = nums.length ? Math.max(...nums) : 0
    const n = sameNumber ? Math.max(1, max) : max + 1
    const { selectionStart: s, selectionEnd: e, value } = area
    const inner = value.slice(s, e)
    area.value = `${value.slice(0, s)}{{c${n}::${inner}}}${value.slice(e)}`
    const caret = s + `{{c${n}::`.length + inner.length
    area.focus()
    area.setSelectionRange(caret, caret)
  }

  private deleteNoteButton(note: Note): HTMLElement {
    const count = this.data.cards.filter((c) => c.noteId === note.id).length
    const btn = h('button', { class: 'danger', type: 'button' }, '削除')
    btn.addEventListener('click', () => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1'
        btn.textContent = count > 1 ? `もう一度押すと${count}枚とも削除` : 'もう一度押すと削除'
        return
      }
      if (this.commit(removeNote(this.data, note.id))) {
        this.undoStack = this.undoStack.filter((u) => u.cards.every((c) => c.noteId !== note.id))
        this.say('削除しました。')
      }
      this.go({ name: 'cards' })
    })
    return btn
  }

  private saveNote(editing: Note | undefined, input: { type: NoteType; deckName: string; front: string; back: string }, back: Screen): void {
    if (!input.deckName) {
      this.say('デッキを入れてください。', 'error')
      this.render()
      return
    }
    const decks: Deck[] = [...this.data.decks]
    let deck = decks.find((d) => d.name === input.deckName)
    if (!deck) {
      deck = { id: newId(), name: input.deckName }
      decks.push(deck)
    }
    const now = this.now()
    const note: Note = { id: editing?.id ?? newId(), createdAt: editing?.createdAt ?? now.toISOString(), deckId: deck.id, type: input.type, front: input.front, back: input.back }
    const problem = validateNote(note)
    if (problem) {
      this.say(problem, 'error')
      // 書いた内容を残したまま知らせる
      const flash = this.flash
      this.flash = null
      const main = this.root.querySelector('main')
      main?.querySelector('.flash')?.remove()
      if (flash && main) main.prepend(h('p', { class: 'flash flash-error', role: 'status' }, flash.text))
      window.scrollTo(0, 0)
      return
    }
    const cards = syncCards(note, this.data.cards, this.scheduler, now, editing?.type)
    const keep = new Set(cards.map((c) => c.id))
    const others = this.data.cards.filter((c) => c.noteId !== note.id)
    const removed = this.data.cards.filter((c) => c.noteId === note.id && !keep.has(c.id)).length
    const notes = editing ? this.data.notes.map((n) => (n.id === note.id ? note : n)) : [...this.data.notes, note]
    if (!this.commit(pruneDecks({ ...this.data, decks, notes, cards: [...others, ...cards] }))) {
      this.render()
      return
    }
    this.undoStack = this.undoStack.filter((u) => u.cards.every((c) => this.data.cards.some((x) => x.id === c.id)))
    localStorage.setItem(LAST_DECK_KEY, input.deckName)
    localStorage.setItem(LAST_TYPE_KEY, input.type)
    if (editing) {
      this.say(removed > 0 ? `保存しました（使わなくなったカード${removed}枚を外しました）。` : '保存しました。')
      if (back.name === 'review') this.forcedCardId = cards.some((c) => c.id === this.forcedCardId) ? this.forcedCardId : null
      this.go(back)
    } else {
      this.say(`${cards.length}枚のカードを追加しました。`)
      this.go({ name: 'note' })
    }
  }

  // ---------- デッキ ----------
  private deckScreen(deckId: string): HTMLElement {
    const deck = this.data.decks.find((d) => d.id === deckId)
    if (!deck) return h('section', {}, h('p', {}, 'このデッキは見つかりませんでした。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'home' }) }, 'ホームへ'))
    const count = this.data.cards.filter((c) => c.deckId === deckId).length
    const name = h('input', { name: 'deckName', value: deck.name, required: true })
    const newPer = h('input', { name: 'newPerDay', type: 'number', min: 0, inputmode: 'numeric', placeholder: `全体の設定（${this.settings.newPerDay}）`, value: deck.newPerDay === undefined ? '' : String(deck.newPerDay) })
    const revPer = h('input', { name: 'reviewPerDay', type: 'number', min: 0, inputmode: 'numeric', placeholder: `全体の設定（${this.settings.reviewPerDay}）`, value: deck.reviewPerDay === undefined ? '' : String(deck.reviewPerDay) })
    const del = h('button', { class: 'danger', type: 'button' }, 'デッキを削除')
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1'
        del.textContent = `もう一度押すと、中のカード${count}枚ごと削除`
        return
      }
      if (this.commit(removeDeck(this.data, deckId))) {
        this.undoStack = this.undoStack.filter((u) => u.cards.every((c) => this.data.cards.some((x) => x.id === c.id)))
        this.say(`「${deck.name}」を削除しました。`)
      }
      this.go({ name: 'home' })
    })
    return h(
      'section',
      {},
      h(
        'form',
        {
          class: 'card-form',
          onsubmit: (e: Event) => {
            e.preventDefault()
            const newName = name.value.trim()
            if (!newName) {
              this.say('デッキ名を入れてください。', 'error')
              return this.render()
            }
            if (this.data.decks.some((d) => d.id !== deckId && d.name === newName)) {
              this.say(`「${newName}」というデッキはもうあります。`, 'error')
              return this.render()
            }
            const updated: Deck = { id: deck.id, name: newName }
            const n = parseLimit(newPer.value)
            const r = parseLimit(revPer.value)
            if (n !== undefined) updated.newPerDay = n
            if (r !== undefined) updated.reviewPerDay = r
            if (this.commit({ ...this.data, decks: this.data.decks.map((d) => (d.id === deckId ? updated : d)) })) {
              if (localStorage.getItem(LAST_DECK_KEY) === deck.name) localStorage.setItem(LAST_DECK_KEY, newName)
              this.say('デッキの設定を保存しました。')
              this.go({ name: 'home' })
            } else this.render()
          },
        },
        h('div', { class: 'section-head' }, h('h1', {}, 'デッキの設定'), h('button', { type: 'button', class: 'back', onclick: () => this.go({ name: 'home' }) }, 'やめる')),
        h('label', {}, 'デッキ名', name),
        h('label', {}, '1日の新規カード（枚）', newPer),
        h('label', {}, '1日の復習カード（枚）', revPer),
        h('p', { class: 'hint' }, `空欄なら全体の設定に従います。カード ${count}枚。`),
        h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, '保存'), del),
      ),
    )
  }

  // ---------- 設定 ----------
  private settingsScreen(): HTMLElement {
    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'file' })
    file.addEventListener('change', async () => {
      const f = file.files?.[0]
      if (!f) return
      const r = importJson(await f.text(), this.data, this.scheduler, this.now())
      file.value = ''
      if (!r.ok) {
        this.say(r.error, 'error')
      } else if (r.kind === 'replace') {
        this.pendingReplace = r.data
      } else if (this.commit(r.data)) {
        this.say(r.added === 0 ? '新しいカードはありませんでした（すべて取り込み済みです）。' : `${r.added}枚を取り込みました。`)
      }
      this.render()
    })

    const limitInput = (key: keyof Limits, label: string) => {
      const input = h('input', { type: 'number', min: 0, max: 9999, inputmode: 'numeric', name: key, value: String(this.settings[key]) })
      input.addEventListener('change', () => {
        const n = parseLimit(input.value) ?? DEFAULT_LIMITS[key]
        this.settings = { ...this.settings, [key]: n }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
        this.say(`${label}を${n}枚にしました。`)
        this.render()
      })
      return h('label', {}, `${label}（枚）`, input)
    }

    return h(
      'section',
      {},
      h('h1', {}, '設定'),
      this.pendingReplace && this.replaceConfirm(this.pendingReplace),
      h('div', { class: 'panel' }, h('h2', {}, '取り込み'), h('p', { class: 'hint' }, 'Anki から書き出したカード（.json）か、このアプリのバックアップを選びます。バックアップを選ぶと、確認のあと今のデータと置き換わります。'), h('label', { class: 'primary file-label' }, 'ファイルを選ぶ', file)),
      h('div', { class: 'panel' }, h('h2', {}, 'バックアップ'), h('p', { class: 'hint' }, '復習の記録ごと .json に書き出します。機種変更やデータが消えたときに使います。'), h('button', { class: 'primary', onclick: () => this.exportBackup() }, '書き出す')),
      h('div', { class: 'panel' }, h('h2', {}, '学習（全体の設定）'), limitInput('newPerDay', '1日の新規カード'), limitInput('reviewPerDay', '1日の復習カード'), h('p', { class: 'hint' }, 'デッキごとに変えるときは、ホームのデッキの「⋯」から設定します。')),
      h('p', { class: 'credit' }, `出題の計算: ts-fsrs（FSRS-6, MIT License）／ データはこの端末の中だけに保存されます。ノート ${this.data.notes.length}件・カード ${this.data.cards.length}枚・復習記録 ${this.data.logs.length}件`),
    )
  }

  private replaceConfirm(next: AppData): HTMLElement {
    return h(
      'div',
      { class: 'panel confirm', role: 'alertdialog' },
      h('h2', {}, 'バックアップで置き換えますか？'),
      h('p', {}, `今のデータ（カード ${this.data.cards.length}枚・復習記録 ${this.data.logs.length}件）は消え、バックアップの内容（カード ${next.cards.length}枚・復習記録 ${next.logs.length}件）に置き換わります。`),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'danger', onclick: () => {
          this.pendingReplace = null
          if (this.commit(next)) {
            this.undoStack = []
            this.say(`バックアップから復元しました（カード ${next.cards.length}枚）。`)
          }
          this.render()
        } }, '置き換える'),
        h('button', { class: 'ghost', onclick: () => ((this.pendingReplace = null), this.render()) }, 'やめる'),
      ),
    )
  }

  private async exportBackup(): Promise<void> {
    const name = `kitagawa-anki-backup-${this.now().toISOString().slice(0, 10)}.json`
    const file = new File([exportJson(this.data)], name, { type: 'application/json' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    const a = h('a', { href: URL.createObjectURL(file), download: name })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }
}

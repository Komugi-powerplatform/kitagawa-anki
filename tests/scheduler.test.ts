import { describe, expect, it } from 'vitest'
import { createScheduler, formatInterval, Rating } from '../src/domain/scheduler'

const NOW = new Date('2026-11-15T12:00:00Z')
const MIN = 60_000
const DAY = 86_400_000

describe('scheduler', () => {
  it('新規カードは今すぐ出題できる', async () => {
    const s = await createScheduler()
    const sched = s.newSched(NOW)
    expect(new Date(sched.dueAt).getTime()).toBe(NOW.getTime())
    expect(sched.reps).toBe(0)
  })

  it('新規カードの4つの答え方ごとに次の出題時刻が出る（Again 1分・Good 10分・Easy は日単位）', async () => {
    const s = await createScheduler()
    const preview = s.preview(s.newSched(NOW), NOW)
    const byRating = Object.fromEntries(preview.map((p) => [p.rating, p.dueAt.getTime() - NOW.getTime()]))
    expect(byRating[Rating.Again]).toBe(1 * MIN)
    expect(byRating[Rating.Good]).toBe(10 * MIN)
    expect(byRating[Rating.Easy]).toBeGreaterThanOrEqual(1 * DAY)
    expect(byRating[Rating.Hard]).toBeGreaterThan(byRating[Rating.Again])
    expect(byRating[Rating.Hard]).toBeLessThan(byRating[Rating.Good])
  })

  it('復習結果はJSONで保存して読み戻しても続きから計算できる', async () => {
    const s = await createScheduler()
    const first = s.review(s.newSched(NOW), Rating.Good, NOW)
    const restored = JSON.parse(JSON.stringify(first.sched))
    const later = new Date(NOW.getTime() + 10 * MIN)
    const second = s.review(restored, Rating.Good, later)
    expect(second.sched.reps).toBe(2)
    expect(new Date(second.sched.dueAt).getTime() - later.getTime()).toBeGreaterThanOrEqual(1 * DAY)
    expect(first.log.rating).toBe(Rating.Good)
    expect(first.log.wasNew).toBe(true)
    expect(second.log.wasNew).toBe(false)
  })

  it('覚えたカードを忘れる（Again）と、日単位から分単位に戻る', async () => {
    const s = await createScheduler()
    let sched = s.review(s.newSched(NOW), Rating.Easy, NOW).sched
    const due = new Date(sched.dueAt)
    sched = s.review(sched, Rating.Again, due).sched
    expect(new Date(sched.dueAt).getTime() - due.getTime()).toBeLessThan(1 * DAY)
    expect(sched.lapses).toBe(1)
  })
})

describe('formatInterval', () => {
  it.each([
    [30_000, '1分未満'],
    [1 * MIN, '1分'],
    [10 * MIN, '10分'],
    [90 * MIN, '1.5時間'],
    [1 * DAY, '1日'],
    [8 * DAY, '8日'],
    [45 * DAY, '1.5か月'],
    [400 * DAY, '1.1年'],
  ])('%d ms → %s', (ms, label) => {
    expect(formatInterval(ms)).toBe(label)
  })
})

import { z } from 'zod'
import { indexedDbStore } from './indexedDb'

export const mangaReaderLayoutSchema = z.enum(['continuous', 'paged', 'double'])
export type MangaReaderLayout = z.infer<typeof mangaReaderLayoutSchema>

export const mangaReaderDirectionSchema = z.enum(['ltr', 'rtl'])
export type MangaReaderDirection = z.infer<typeof mangaReaderDirectionSchema>

/** How pages are sized against the reading canvas. */
export const mangaReaderFitSchema = z.enum(['fit-width', 'fit-screen', 'original'])
export type MangaReaderFit = z.infer<typeof mangaReaderFitSchema>

/** Reading canvas themes, from OLED-black to Kindle-style paper. */
export const mangaReaderBackgroundSchema = z.enum(['ink', 'black', 'sepia', 'paper'])
export type MangaReaderBackground = z.infer<typeof mangaReaderBackgroundSchema>

/** Vertical spacing between pages in continuous reading. */
export const mangaReaderGapSchema = z.enum(['none', 'small', 'large'])
export type MangaReaderGap = z.infer<typeof mangaReaderGapSchema>

export const mangaReaderSettingsSchema = z.object({
  layout: mangaReaderLayoutSchema,
  direction: mangaReaderDirectionSchema,
  fit: mangaReaderFitSchema,
  background: mangaReaderBackgroundSchema,
  gap: mangaReaderGapSchema,
})
export type MangaReaderSettings = z.infer<typeof mangaReaderSettingsSchema>

export const DEFAULT_MANGA_READER_SETTINGS: MangaReaderSettings = {
  layout: 'continuous',
  direction: 'rtl',
  fit: 'fit-width',
  background: 'ink',
  gap: 'small',
}

export const mangaReaderRecordSchema = z.object({
  anilistId: z.number().int().positive(),
  title: z.string(),
  cover: z.string().default(''),
  sourceId: z.string(),
  sourceName: z.string().default(''),
  mangaId: z.string(),
  mangaUrl: z.string().default(''),
  chapterId: z.string(),
  chapterNumber: z.number(),
  chapterTitle: z.string().default(''),
  pageIndex: z.number().int().nonnegative().default(0),
  pageCount: z.number().int().nonnegative().default(0),
  completed: z.boolean().default(false),
  layout: mangaReaderLayoutSchema.default('continuous'),
  direction: mangaReaderDirectionSchema.default('rtl'),
  fit: mangaReaderFitSchema.default('fit-width'),
  background: mangaReaderBackgroundSchema.default('ink'),
  gap: mangaReaderGapSchema.default('small'),
  updatedAt: z.number().nonnegative(),
})
export type MangaReaderRecord = z.infer<typeof mangaReaderRecordSchema>

export interface MangaReaderPersistence {
  get(anilistId: number): Promise<MangaReaderRecord | null>
  getDefaults(): Promise<MangaReaderSettings>
  list(): Promise<MangaReaderRecord[]>
  save(record: MangaReaderRecord): Promise<void>
  saveDefaults(settings: MangaReaderSettings): Promise<void>
  remove(anilistId: number): Promise<void>
}

const RECORD_PREFIX = 'manga-reader:'
const DEFAULTS_KEY = `${RECORD_PREFIX}defaults`
const recordDocument = z.object({ v: z.literal(1), data: mangaReaderRecordSchema })
const settingsDocument = z.object({ v: z.literal(1), data: mangaReaderSettingsSchema })

function recordKey(anilistId: number): string {
  return `${RECORD_PREFIX}${anilistId}`
}

export const mangaReaderData: MangaReaderPersistence = {
  get: (anilistId) => indexedDbStore.read(recordKey(anilistId), recordDocument),
  getDefaults: async () => (await indexedDbStore.read(DEFAULTS_KEY, settingsDocument)) ?? { ...DEFAULT_MANGA_READER_SETTINGS },
  list: async () => {
    const keys = await indexedDbStore.keys(RECORD_PREFIX)
    const records = await Promise.all(keys.filter((key) => key !== DEFAULTS_KEY).map((key) => indexedDbStore.read(key, recordDocument)))
    return records.filter((record): record is MangaReaderRecord => record !== null).sort((left, right) => right.updatedAt - left.updatedAt)
  },
  save: async (record) => {
    await indexedDbStore.write(recordKey(record.anilistId), 1, record, recordDocument)
  },
  saveDefaults: (settings) => indexedDbStore.write(DEFAULTS_KEY, 1, settings, settingsDocument),
  remove: (anilistId) => indexedDbStore.remove(recordKey(anilistId)),
}

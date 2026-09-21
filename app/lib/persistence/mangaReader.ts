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
  save(record: MangaReaderRecord): Promise<void>
  remove(anilistId: number): Promise<void>
}

const RECORD_PREFIX = 'manga-reader:'

function recordKey(anilistId: number): string {
  return `${RECORD_PREFIX}${anilistId}`
}

export const mangaReaderData: MangaReaderPersistence = {
  get: (anilistId) => indexedDbStore.read(recordKey(anilistId), z.object({ v: z.literal(1), data: mangaReaderRecordSchema })),
  save: async (record) => {
    await indexedDbStore.write(recordKey(record.anilistId), 1, record, z.object({ v: z.literal(1), data: mangaReaderRecordSchema }))
  },
  remove: (anilistId) => indexedDbStore.remove(recordKey(anilistId)),
}

import { z } from 'zod'
import { anilistClient, AniListError } from './client'

const publicListShape = z.object({
  MediaListCollection: z.object({
    lists: z.array(z.object({
      entries: z.array(z.object({
        status: z.string(),
        media: z.object({
          id: z.number().int().positive(),
          title: z.object({ romaji: z.string().nullable(), english: z.string().nullable(), native: z.string().nullable() }),
          coverImage: z.object({ large: z.string().nullable(), medium: z.string().nullable() }),
          format: z.string().nullable(),
          averageScore: z.number().nullable(),
        }),
      })),
    })),
  }),
})

export interface ImportedAniListFavorite {
  id: number
  title: string
  cover: string
  format: string | null
  averageScore: number | null
  status: 'WATCHING' | 'COMPLETED' | 'PLANNING' | 'PAUSED' | 'DROPPED'
}

function mapStatus(status: string): ImportedAniListFavorite['status'] {
  switch (status) {
    case 'CURRENT':
    case 'REPEATING':
      return 'WATCHING'
    case 'COMPLETED':
      return 'COMPLETED'
    case 'PAUSED':
      return 'PAUSED'
    case 'DROPPED':
      return 'DROPPED'
    default:
      return 'PLANNING'
  }
}

/** Imports a public AniList anime list without requiring an AniList account token. */
export async function importAniListPublicList(username: string, signal?: AbortSignal): Promise<ImportedAniListFavorite[]> {
  const normalized = username.trim()
  if (!normalized) throw new Error('Enter an AniList username first.')

  const query = `
    query($userName:String!) {
      MediaListCollection(userName:$userName, type:ANIME) {
        lists {
          entries {
            status
            media {
              id
              title { romaji english native }
              coverImage { large medium }
              format
              averageScore
            }
          }
        }
      }
    }
  `

  const raw = await anilistClient.request(query, { userName: normalized }, signal)
  let parsed: z.infer<typeof publicListShape>
  try {
    parsed = publicListShape.parse(raw)
  } catch {
    throw new AniListError('AniList returned an unexpected public list shape.')
  }

  const unique = new Map<number, ImportedAniListFavorite>()
  for (const list of parsed.MediaListCollection.lists) {
    for (const entry of list.entries) {
      const media = entry.media
      unique.set(media.id, {
        id: media.id,
        title: media.title.english ?? media.title.romaji ?? media.title.native ?? `AniList anime ${media.id}`,
        cover: media.coverImage.large ?? media.coverImage.medium ?? '',
        format: media.format,
        averageScore: media.averageScore,
        status: mapStatus(entry.status),
      })
    }
  }
  return [...unique.values()]
}

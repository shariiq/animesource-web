import type { AniListDetail } from '../../../data/anilist/types'
import { formatEnum, titleOf } from '../../../lib/format'

export interface DetailTitle {
  label: 'English' | 'Romaji' | 'Native' | 'Alias'
  value: string
}

export interface DetailStudio {
  id: number
  name: string
  isAnimationStudio: boolean
  siteUrl: string | null
}

export interface DetailStaffMember {
  id: number
  name: string
  nativeName: string | null
  image: string | null
  occupations: string[]
  roles: string[]
  siteUrl: string | null
}

export interface DetailExternalLink {
  id: number
  site: string
  type: string | null
  language: string | null
  icon: string | null
  url: string
}

export interface DetailTag {
  id: number
  name: string
  category: string | null
  rank: number | null
  description: string | null
}

export interface DetailTags {
  themes: DetailTag[]
  tags: DetailTag[]
}

export interface DetailRelation {
  id: number
  title: string
  cover: string
  format: string | null | undefined
  score: number | null | undefined
  label: string | undefined
}

export function isSafeExternalUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function getDetailTitles(detail: AniListDetail): DetailTitle[] {
  const candidates: DetailTitle[] = [
    { label: 'English', value: detail.title?.english ?? '' },
    { label: 'Romaji', value: detail.title?.romaji ?? '' },
    { label: 'Native', value: detail.title?.native ?? '' },
    ...(detail.synonyms ?? []).map((value): DetailTitle => ({ label: 'Alias', value: value ?? '' })),
  ]
  const primary = titleOf(detail).trim().toLocaleLowerCase()
  const seen = new Set<string>([primary])
  return candidates.filter((candidate) => {
    const value = candidate.value.trim()
    const key = value.toLocaleLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getStudios(detail: AniListDetail): DetailStudio[] {
  const seen = new Set<number>()
  return (detail.studios?.nodes ?? []).flatMap((studio) => {
    if (!studio?.name || seen.has(studio.id)) return []
    seen.add(studio.id)
    return [{
      id: studio.id,
      name: studio.name,
      isAnimationStudio: studio.isAnimationStudio ?? false,
      siteUrl: isSafeExternalUrl(studio.siteUrl) ? studio.siteUrl : null,
    }]
  })
}

export function getStaffMembers(detail: AniListDetail): DetailStaffMember[] {
  const members = new Map<number, DetailStaffMember>()
  for (const edge of detail.staff?.edges ?? []) {
    const node = edge?.node
    const name = node?.name?.full?.trim()
    if (!node || !name) continue
    const current = members.get(node.id)
    const roles = edge.role ? [edge.role] : []
    const occupations = (node.primaryOccupations ?? []).filter((occupation): occupation is string => Boolean(occupation))
    if (current) {
      current.roles = [...new Set([...current.roles, ...roles])]
      current.occupations = [...new Set([...current.occupations, ...occupations])]
      continue
    }
    members.set(node.id, {
      id: node.id,
      name,
      nativeName: node.name?.native?.trim() || null,
      image: node.image?.medium ?? null,
      occupations: [...new Set(occupations)],
      roles: [...new Set(roles)],
      siteUrl: isSafeExternalUrl(node.siteUrl) ? node.siteUrl : null,
    })
  }
  return [...members.values()]
}

function detailTag(tag: NonNullable<AniListDetail['tags']>[number]): DetailTag {
  return {
    id: tag.id,
    name: tag.name,
    category: tag.category ?? null,
    rank: tag.rank ?? null,
    description: tag.description ?? null,
  }
}

export function getDetailTags(detail: AniListDetail): DetailTags {
  const safe = (detail.tags ?? [])
    .filter((tag) => tag && !tag.isGeneralSpoiler && !tag.isMediaSpoiler && !tag.isAdult)
    .sort((a, b) => (b?.rank ?? 0) - (a?.rank ?? 0))
    .map((tag) => detailTag(tag!))
  return {
    themes: safe.filter((tag) => /theme|テーマ/i.test(tag.category ?? '')),
    tags: safe.filter((tag) => !/theme|テーマ/i.test(tag.category ?? '')),
  }
}

export function getDetailLinks(detail: AniListDetail): DetailExternalLink[] {
  return (detail.externalLinks ?? []).flatMap((link) => {
    if (!link || link.isDisabled || !link.site || !isSafeExternalUrl(link.url)) return []
    return [{
      id: link.id,
      site: link.site,
      type: link.type ?? null,
      language: link.language ?? null,
      icon: link.icon ?? null,
      url: link.url,
    }]
  })
}

const relationPriority: Record<string, number> = {
  PREQUEL: 0,
  PARENT: 1,
  SOURCE: 2,
  SEQUEL: 3,
  SIDE_STORY: 4,
  SPIN_OFF: 5,
  ALTERNATIVE: 6,
}

export function getOrderedRelations(detail: AniListDetail): DetailRelation[] {
  return (detail.relations?.edges ?? [])
    .flatMap((edge, index) => {
      const node = edge?.node
      if (!node) return []
      const relation = edge.relationType ?? undefined
      return [{
        id: node.id,
        title: titleOf(node),
        cover: node.coverImage?.large || node.coverImage?.extraLarge || '',
        format: node.format,
        score: node.averageScore,
        label: relation ? formatEnum(relation) : undefined,
        priority: relation ? relationPriority[relation] ?? 99 : 99,
        index,
      }]
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ priority: _priority, index: _index, ...relation }) => relation)
}

export interface DetailCharacter {
  id: number
  name: string
  role: string | null
  image: string | null
  siteUrl: string | null
  voiceActor: {
    id: number
    name: string
    nativeName: string | null
    language: string | null
    image: string | null
    siteUrl: string | null
  } | null
}

export function getCharacters(detail: AniListDetail): DetailCharacter[] {
  return (detail.characters?.edges ?? []).flatMap((edge) => {
    const character = edge?.node
    const name = character?.name?.full?.trim()
    if (!character || !name) return []
    const actor = edge.voiceActors?.[0]
    const actorName = actor?.name?.full?.trim()
    return [{
      id: character.id,
      name,
      role: edge.role ?? null,
      image: character.image?.medium ?? null,
      siteUrl: isSafeExternalUrl(character.siteUrl) ? character.siteUrl : null,
      voiceActor: actor && actorName ? {
        id: actor.id,
        name: actorName,
        nativeName: actor.name?.native?.trim() || null,
        language: actor.languageV2 ?? null,
        image: actor.image?.medium ?? null,
        siteUrl: isSafeExternalUrl(actor.siteUrl) ? actor.siteUrl : null,
      } : null,
    }]
  })
}

import { createEffect, onMount, untrack, type Accessor } from 'solid-js'
import type { CatalogMode } from '../../lib/catalog'
import { useOptionalCatalogMode } from './CatalogModeSwitch'

export function followCatalogModeRelation(props: {
  currentMode: CatalogMode
  currentId: Accessor<number>
  targetMode: CatalogMode
  relationId: Accessor<number | null>
  follow: (relationId: number) => void
}): void {
  const catalog = useOptionalCatalogMode()
  let handledSequence = catalog?.modeChange()?.sequence ?? 0

  onMount(() => {
    void catalog?.alignMode(props.currentMode)
  })

  createEffect(() => {
    const change = catalog?.modeChange()
    if (!change || change.sequence <= handledSequence) return
    handledSequence = change.sequence
    if (change.mode !== props.targetMode) return

    const currentId = props.currentId()
    const pair = catalog?.relationPair()
    const rememberedId = props.currentMode === 'ANIME'
      ? pair?.animeId === currentId ? pair.mangaId : null
      : pair?.mangaId === currentId ? pair.animeId : null
    const relationId = rememberedId ?? props.relationId()
    if (relationId === null) return

    catalog?.rememberRelationPair(props.currentMode === 'ANIME'
      ? { animeId: currentId, mangaId: relationId }
      : { animeId: relationId, mangaId: currentId })
    untrack(() => props.follow(relationId))
  })
}

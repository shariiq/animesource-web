import { For, Show } from 'solid-js'
import type { AniListDetail } from '../../../data/anilist/types'
import { getCharacters } from './model'
import { formatEnum } from '../../../lib/format'
import type { CatalogMode } from '../../../lib/catalog'

/** Characters and Japanese voice actors for the detail page. */
export function CharacterRail(props: { detail: AniListDetail; mode?: CatalogMode }) {
  const mode = () => props.mode ?? 'ANIME'
  const characters = () => getCharacters(props.detail).slice(0, 12)

  return (
    <Show when={characters().length > 0}>
      <section class="detail-section" aria-labelledby="characters-heading">
        <div class="detail-section-heading">
          <h2 id="characters-heading">Characters</h2>
        </div>
        <div class="detail-identity-rail">
          <For each={characters()}>
            {(character) => {
              const characterDetails = (
                <>
                  <Show when={character.image} fallback={<div class="detail-identity-placeholder" />}>
                    {(src) => <img src={src()} alt={`${character.name} portrait`} loading="lazy" />}
                  </Show>
                  <strong>{character.name}</strong>
                  <span>{character.role ? formatEnum(character.role) : 'Character'}</span>
                </>
              )

              return (
                <article class="detail-identity-card">
                  <Show when={character.siteUrl} fallback={characterDetails} keyed>
                    {(href) => <a class="block" href={href} target="_blank" rel="noopener noreferrer">{characterDetails}</a>}
                  </Show>
                  <Show when={mode() === 'ANIME' && character.voiceActor}>
                    {(voiceActor) => (
                      <div class="border-t border-line px-[13px] pb-[13px] pt-3">
                        <p class="detail-kicker">Japanese voice</p>
                        <Show when={voiceActor().siteUrl} fallback={<span class="mt-1 block truncate px-0 text-[10px] text-text-secondary">{voiceActor().name}</span>} keyed>
                          {(href) => <a class="mt-1 block truncate px-0 text-[10px] text-text-secondary underline underline-offset-2 hover:text-violet" href={href} target="_blank" rel="noopener noreferrer">{voiceActor().name} ↗</a>}
                        </Show>
                      </div>
                    )}
                  </Show>
                </article>
              )
            }}
          </For>
        </div>
      </section>
    </Show>
  )
}

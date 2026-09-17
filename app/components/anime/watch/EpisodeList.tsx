import { createSignal, For, Show } from 'solid-js'
import type { Episode } from '../../../data/anisource/schema'

export function EpisodeList(props: {
  episodes: Episode[]
  currentEpisodeId: string | null
  onEpisodeChange: (episodeId: string) => void
}) {
  const [filter, setFilter] = createSignal<'all' | 'sub' | 'dub'>('all')
  const [hideFillers, setHideFillers] = createSignal(false)

  const filteredEpisodes = () => {
    let episodes = [...props.episodes]
    if (hideFillers()) episodes = episodes.filter((episode) => !episode.is_filler)
    if (filter() === 'sub') episodes = episodes.filter((episode) => episode.has_sub)
    if (filter() === 'dub') episodes = episodes.filter((episode) => episode.has_dub)
    return episodes
  }

  return (
    <section class="rounded-panel border border-white/75 bg-white/62 p-5 shadow-[0_22px_50px_-28px_rgb(0_0_0/.38)] backdrop-blur-xl" aria-labelledby="episode-heading">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-black/12 pb-3">
        <div><p class="font-mono text-[9px] uppercase tracking-[.16em] text-[#4f4e57]">Episode list</p><h2 id="episode-heading" class="mt-1 font-display text-3xl leading-none">Episodes</h2></div>
        <div class="flex items-center gap-2">
          <label class="sr-only" for="episode-filter">Filter by audio</label>
          <select id="episode-filter" class="h-8 rounded-[8px] border border-black/18 bg-white/78 px-2 font-mono text-[10px] uppercase tracking-[.08em] outline-none focus:border-black" value={filter()} onChange={(event) => {
            const value = event.currentTarget.value
            if (value === 'all' || value === 'sub' || value === 'dub') setFilter(value)
          }}>
            <option value="all">All audio</option><option value="sub">Sub</option><option value="dub">Dub</option>
          </select>
          <label class="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.08em] text-[#42404b]"><input class="accent-black" type="checkbox" checked={hideFillers()} onChange={(event) => setHideFillers(event.currentTarget.checked)} /> Hide fillers</label>
        </div>
      </div>
      <Show when={filteredEpisodes().length > 0} fallback={<p class="py-8 text-center font-mono text-[10px] uppercase tracking-[.1em] text-[#4f4e57]">No episodes match the current filters.</p>}>
        <div class="max-h-[570px] space-y-1 overflow-y-auto pr-1">
          <For each={filteredEpisodes()}>{(episode) => <button type="button" class="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-transparent px-3 py-2.5 text-left transition hover:border-black hover:bg-black hover:text-white" classList={{ 'border-black bg-black text-white': episode.id === props.currentEpisodeId }} onClick={() => props.onEpisodeChange(episode.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onEpisodeChange(episode.id) } }} aria-label={`Episode ${episode.number}: ${episode.title}`}>
            <span class="font-mono text-[10px] tabular-nums opacity-65">{String(episode.number).padStart(2, '0')}</span>
            <span class="min-w-0 truncate text-xs font-bold">{episode.title || `Episode ${episode.number}`}</span>
            <span class="flex gap-1 font-mono text-[8px] font-bold tracking-[.08em]"><Show when={episode.has_sub}><span class="border border-current px-1 py-0.5">SUB</span></Show><Show when={episode.has_dub}><span class="border border-current px-1 py-0.5">DUB</span></Show><Show when={episode.is_filler}><span class="border border-current px-1 py-0.5 opacity-60">FILLER</span></Show></span>
          </button>}</For>
        </div>
      </Show>
    </section>
  )
}

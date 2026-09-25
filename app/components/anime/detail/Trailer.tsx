import { Show, createSignal } from 'solid-js'

/**
 * Trailer embed: shows a thumbnail with a play overlay and only mounts the
 * YouTube iframe on first click (lazy / intent-based), so the heavy embed
 * never loads until the user asks for it. site "youtube" is expected; any
 * other site falls back to no trailer rather than rendering a broken embed.
 */
export function Trailer(props: { trailer: { id: string; site?: string | null; thumbnail?: string | null } | null | undefined }) {
  const [playing, setPlaying] = createSignal(false)

  return (
    <Show when={props.trailer && props.trailer.site === 'youtube' && props.trailer.id}>
      <div class="trailer">
        <Show when={!playing()} fallback={
          <iframe
            title="Trailer"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(props.trailer?.id ?? '')}?autoplay=1&rel=0`}
            loading="lazy"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          />
        }>
          <Show when={props.trailer?.thumbnail} fallback={<button type="button" onClick={() => setPlaying(true)} aria-label="Play trailer">▶</button>}>
            <button type="button" onClick={() => setPlaying(true)} aria-label="Play trailer">
              <Show when={props.trailer?.thumbnail}>
                <img src={props.trailer?.thumbnail ?? ''} alt="" loading="lazy" decoding="async" />
              </Show>
              <span class="trailer-play">▶</span>
            </button>
          </Show>
        </Show>
      </div>
    </Show>
  )
}

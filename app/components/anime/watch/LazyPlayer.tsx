import { onMount, Show, createSignal, type Component } from 'solid-js'
import { PlayerLoadingSkeleton } from '../../ui/LoadingSkeleton'
import type { WatchPlayerProps } from './VidstackPlayer'

export type { WatchPlayerProps }

/**
 * SSR-safe boundary for the watch player.
 *
 * Vidstack ships as custom elements plus theme CSS: importing it during SSR
 * would execute player code on the server and bloat the shared bundle, which
 * the AniSource/client-only architecture forbids. The real player chunk is
 * therefore requested after mount, and only a skeleton renders until then.
 * The props contract is unchanged, so the watch session is untouched.
 */
export function LazyPlayer(props: WatchPlayerProps) {
  const [Player, setPlayer] = createSignal<Component<WatchPlayerProps> | null>(null)
  const [bootFailed, setBootFailed] = createSignal(false)

  const boot = () => {
    setBootFailed(false)
    void import('./VidstackPlayer').then(
      (module) => setPlayer(() => module.VidstackPlayer),
      (cause) => {
        console.error('Failed to load the video player.', cause)
        setBootFailed(true)
      },
    )
  }

  onMount(boot)

  return (
    <Show when={props.streams.length > 0} fallback={null}>
      <Show
        when={Player()}
        fallback={
          <Show
            when={!bootFailed()}
            fallback={
              <div
                class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white sm:aspect-video sm:p-8"
                role="alert"
              >
                <div>
                  <p class="font-mono text-[10px] uppercase tracking-[.12em]">The video player could not be loaded.</p>
                  <button
                    type="button"
                    class="mt-3 min-h-11 border border-white/45 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] transition hover:border-white"
                    onClick={boot}
                  >
                    Retry player
                  </button>
                </div>
              </div>
            }
          >
            <PlayerLoadingSkeleton message="Preparing the player…" />
          </Show>
        }
      >
        {(ready) => {
          const Ready = ready()
          return Ready ? (
            <Ready
              streams={props.streams}
              identity={props.identity}
              serverName={props.serverName}
              resumeAt={props.resumeAt}
              preferences={props.preferences}
              onPreferencesChange={props.onPreferencesChange}
              onProgress={props.onProgress}
              onEnded={props.onEnded}
              onMediaError={props.onMediaError}
              onRetry={props.onRetry}
            />
          ) : null
        }}
      </Show>
    </Show>
  )
}

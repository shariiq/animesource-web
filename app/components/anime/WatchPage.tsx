import {
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/solid-router'
import { ANISOURCE_OVERFLOW_BASE, ANISOURCE_PROXY_BASE, createAniSourceClient, warmOverflowOrigin } from '../../data/anisource/client'
import type { AniListDetail } from '../../data/anilist/types'
import { titleVariants } from '../../data/matching'
import { viewerData } from '../../lib/persistence/active'
import { titleOf } from '../../lib/format'
import {
  createWatchSession,
  type WatchSourceClient,
  type WatchPersistence,
} from './watch/createWatchSession'
import { EpisodeList } from './watch/EpisodeList'
import { ServerPicker } from './watch/ServerPicker'
import { LazyPlayer } from './watch/LazyPlayer'
import { MatchPicker } from './watch/MatchPicker'

/**
 * Overflow-capable gateway client: the primary origin serves until measured
 * latency or origin-health failures move a session to the overflow
 * deployment, which shares the same gateway under `/fallback`. Media tickets
 * stay origin-bound either way, so no session state changes on a switch.
 */
const watchApi: WatchSourceClient = createAniSourceClient({ baseUrl: ANISOURCE_PROXY_BASE, overflowBaseUrl: ANISOURCE_OVERFLOW_BASE })
const watchPersistence: WatchPersistence = viewerData

/**
 * Client-only streaming flow. AniList detail data is passed from the route
 * loader; AniSource is deliberately not touched until this page is mounted.
 */
export function WatchPage(props: { anime: AniListDetail }) {
  const params = useParams({ from: '/anime/$animeId/watch/$episodeId' })
  const navigate = useNavigate()
  const location = useLocation()
  const routeEpisodeId = () => params().episodeId
  const sourceSearchParam = () => {
    if (typeof window === 'undefined') return undefined
    return new URLSearchParams(window.location.search).get('source') ?? undefined
  }
  const fromSchedule = () => location().state.watchIntent === 'schedule'

  // The route loader supplies an immutable anime record for this page instance.
  const session = createWatchSession({
    // eslint-disable-next-line solid/reactivity -- this session is created once per route instance.
    anime: props.anime,
    routeEpisodeId,
    sourceSearchParam,
    fromSchedule,
    api: watchApi,
    persistence: watchPersistence,
    navigateToEpisode: async (episodeId, sourceId) => {
      await navigate({
        to: '/anime/$animeId/watch/$episodeId',
        params: { animeId: String(props.anime.id), episodeId },
        search: sourceId ? { source: sourceId } : undefined,
        state: fromSchedule() ? { watchIntent: 'schedule' } : undefined,
        replace: true,
      })
    },
  })
  const variants = () => titleVariants(props.anime)

  onMount(() => {
    void session.initialize()
    warmOverflowOrigin()
  })
  onCleanup(session.dispose)

  return (
    <section
      class="editorial-page !w-[min(100%-28px,1480px)] !px-0 !py-8 sm:!py-10"
      aria-labelledby="watch-title"
    >
      <header class="grid gap-8 rounded-shell border border-white/75 bg-white/42 p-6 shadow-glass backdrop-blur-[40px] sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <Link
            class="font-mono text-[10px] uppercase tracking-[.12em] text-[#42404b] transition hover:text-black"
            to="/anime/$animeId"
            params={{ animeId: String(props.anime.id) }}
          >
            ← Back to details
          </Link>
          <p class="mt-8 font-mono text-[10px] uppercase tracking-[.18em] text-[#4f4e57]">
            Watch anime / choose an episode
          </p>
          <h1
            id="watch-title"
            class="mt-2 max-w-4xl break-words font-display text-[clamp(40px,11vw,96px)] leading-[.88] tracking-[-.03em] [overflow-wrap:anywhere]"
          >
            {titleOf(props.anime)}
          </h1>
          <p class="mt-5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[.1em] text-[#4f4e57]">
            <span>
              Episode{' '}
              {session.episodes().find((episode) => episode.id === session.selectedEpisode())?.number ??
                '—'}
            </span>
            <span>
              {session.episodes().find((episode) => episode.id === session.selectedEpisode())?.title ||
                'Choose a source to begin'}
            </span>
          </p>
        </div>
        <div class="self-end rounded-panel border border-white/80 bg-white/62 p-5 shadow-[0_16px_36px_-12px_rgb(0_0_0/.08)] backdrop-blur-[30px]">
          <span class="font-mono text-[9px] uppercase tracking-[.16em] text-[#4f4e57]">
            Streaming source
          </span>
          <Show when={session.sources().length > 0}>
            <select
              id="watch-source"
              class="mt-3 h-10 w-full rounded-[10px] border border-black/18 bg-white/78 px-3 text-xs font-semibold outline-none transition focus:border-black"
              aria-label="Streaming source"
              value={session.selectedSource()}
              onChange={(event) => {
                void session.chooseSource(event.currentTarget.value)
              }}
            >
              <For each={session.sources()}>
                {(source) => <option value={source.id}>{source.name}</option>}
              </For>
            </select>
          </Show>
          <span
            class="mt-3 block font-mono text-[9px] uppercase tracking-[.1em]"
            classList={{
              'text-emerald-700': session.sourceHealth()[session.selectedSource()]?.status === 'healthy',
              'text-amber-800': session.slow() || session.sourceHealth()[session.selectedSource()]?.status === 'checking' || session.sourceHealth()[session.selectedSource()]?.status === 'degraded',
              'text-red-800': session.sourceHealth()[session.selectedSource()]?.status === 'unavailable',
            }}
            role="status"
          >
            ● {session.slow()
              ? 'Waking source'
              : session.sourceHealth()[session.selectedSource()]?.status === 'checking'
                ? 'Checking source'
                : session.sourceHealth()[session.selectedSource()]?.status === 'degraded'
                  ? 'Source degraded'
                  : session.sourceHealth()[session.selectedSource()]?.status === 'unavailable'
                    ? 'Source unavailable'
                    : 'Source ready'}
          </span>
        </div>
      </header>

      <p
        class="my-5 rounded-[12px] border border-white/75 bg-white/58 px-4 py-3 font-mono text-[10px] uppercase tracking-[.08em] text-[#42404b] shadow-[0_12px_30px_-20px_rgb(0_0_0/.35)] backdrop-blur-xl"
        aria-live="polite"
      >
        {session.statusText()}
      </p>
      <Show when={session.notice()}>
        {(message) => <p class="mb-5 rounded-[12px] border border-amber-700/25 bg-amber-50/75 px-4 py-3 font-mono text-[10px] uppercase tracking-[.08em] text-amber-950 shadow-[0_12px_30px_-20px_rgb(0_0_0/.35)]" role="status">{message()}</p>}
      </Show>
      <Show when={session.error()}>
        {(message) => (
          <div
            class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-red-800/25 bg-red-50/75 p-4 text-sm text-red-900 shadow-[0_16px_36px_-24px_rgb(0_0_0/.25)] backdrop-blur-xl"
            role="alert"
          >
            <div>
              <p>{message()}</p>
              <Show when={session.watchError()}>
                {(diagnostic) => (
                  <p class="mt-2 font-mono text-[10px] uppercase tracking-[.08em] text-red-900/75">
                    <Show when={diagnostic().sourceName}>
                      {(source) => <span>Source: {source()}.</span>}
                    </Show>{' '}
                    <Show when={diagnostic().serverName}>
                      {(server) => <span>Server: {server()}.</span>}
                    </Show>{' '}
                    <span>{diagnostic().kind.replaceAll('-', ' ')} failure.</span>{' '}
                    <Show when={diagnostic().retryCount > 0}>
                      <span>Retry {diagnostic().retryCount}.</span>
                    </Show>
                  </p>
                )}
              </Show>
            </div>
            <div class="flex flex-wrap gap-2">
              <Show when={session.watchError()?.retryable !== false}>
                <button
                  class="min-h-11 border border-red-900 bg-red-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-white"
                  type="button"
                  onClick={() => {
                    if (session.watchError()?.operation === 'streams') void session.retryStreams()
                    else void session.initialize()
                  }}
                >
                  {session.watchError()?.operation === 'streams'
                    ? `Retry ${session.selectedServerName()}`
                    : 'Retry connection'}
                </button>
              </Show>
              <Show when={session.fallbackSource()}>
                <button
                  class="min-h-11 border border-red-900/50 px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-red-900 transition hover:bg-red-900 hover:text-white"
                  type="button"
                  onClick={() => {
                    const alternate = session.fallbackSource()
                    if (alternate) void session.chooseSource(alternate.id)
                  }}
                >
                  Try another available source
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>

      <Show when={session.match()?.kind === 'picker' || session.match()?.kind === 'empty'}>
        <MatchPicker
          anime={props.anime}
          sourceName={session.sourceName()}
          variants={variants()}
          ranked={session.pickerCandidates()}
          query={session.manualQuery()}
          loading={session.pickerLoading()}
          onQuery={session.onManualQueryInput}
          onVariantSearch={(title) => {
            void session.searchVariant(title)
          }}
          onChoose={(candidate) => {
            void session.changeMatch(candidate)
          }}
        />
      </Show>

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="min-w-0">
          <Switch>
            <Match when={session.playerStage() === 'player'}>
              <LazyPlayer
                streams={session.streams()}
                identity={session.playbackIdentity() ?? undefined}
                serverName={session.selectedServerName()}
                resumeAt={session.resumeAt()}
                preferences={session.preferences()}
                onPreferencesChange={session.savePlaybackPreferences}
                onProgress={session.updatePlaybackProgress}
                onEnded={session.markPlaybackComplete}
                onMediaError={session.reportMediaFailure}
                onRetry={() => { void session.retryCurrentServer() }}
              />
            </Match>
            <Match when={session.playerStage() === 'streams-loading'}>
              <div
                class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8"
                role="status"
              >
                <div>
                  <div class="player-spinner" aria-hidden="true" />
                  <h2>Resolving {session.selectedServerName()} stream…</h2>
                  <p>The player will appear here as soon as the stream is found.</p>
                </div>
              </div>
            </Match>
            <Match when={session.playerStage() === 'streams-empty'}>
              <div
                class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8"
                role="status"
              >
                <div>
                  <div class="player-stage-mark" aria-hidden="true">
                    ▶
                  </div>
                  <h2>No playable streams from {session.selectedServerName()}</h2>
                  <p>
                    This server returned no streams for this episode. Try another server — the panel
                    below lists the options.
                  </p>
                </div>
              </div>
            </Match>
            <Match when={session.playerStage() === 'stream-error'}>
              <div
                class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8"
                role="status"
              >
                <div>
                  <div class="player-stage-mark" aria-hidden="true">
                    ▶
                  </div>
                  <h2>Streams could not be loaded</h2>
                  <p>
                    Something went wrong with {session.selectedServerName()}. Try another server, or
                    retry the connection above.
                  </p>
                </div>
              </div>
            </Match>
            <Match when={session.playerStage() === 'servers-loading'}>
              <div
                class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8"
                role="status"
              >
                <div>
                  <div class="player-spinner" aria-hidden="true" />
                  <h2>Finding servers…</h2>
                  <p>Looking for stream sources for this episode.</p>
                </div>
              </div>
            </Match>
            <Match when={session.playerStage() === 'servers-empty'}>
              <div
                class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8"
                role="status"
              >
                <div>
                  <div class="player-stage-mark" aria-hidden="true">
                    ▶
                  </div>
                  <h2>No servers available</h2>
                  <p>This episode has no stream servers. Try another episode from the queue.</p>
                </div>
              </div>
            </Match>
            <Match when={session.playerStage() === 'server'}>
              <div class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8">
                <div>
                  <div class="player-stage-mark" aria-hidden="true">
                    ▶
                  </div>
                  <h2>Choose a server</h2>
                  <p>Pick a streaming server below to start watching this episode.</p>
                </div>
              </div>
            </Match>
            <Match when={session.playerStage() === 'episode'}>
              <div class="grid min-h-[260px] place-items-center overflow-hidden rounded-panel border border-black/15 bg-[#121217] p-5 text-center text-white shadow-[0_24px_60px_rgb(0_0_0/.22)] sm:aspect-video sm:p-8">
                <div>
                  <div class="player-stage-mark" aria-hidden="true">
                    ▶
                  </div>
                  <h2>Choose an episode and server</h2>
                  <p>The player will appear here once a stream is resolved.</p>
                </div>
              </div>
            </Match>
          </Switch>
          <Show when={session.continueNext()}>
            {(episode) => (
              <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-emerald-700/25 bg-emerald-50/75 p-4 text-sm text-emerald-950 shadow-[0_16px_36px_-24px_rgb(0_0_0/.25)] backdrop-blur-xl" role="status">
                <p><span class="font-mono text-[9px] uppercase tracking-[.12em]">Episode complete</span><br />Continue to episode {episode().number}: {episode().title || `Episode ${episode().number}`}</p>
                <button class="border border-emerald-900 bg-emerald-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-white" type="button" onClick={() => { void session.chooseEpisode(episode().id) }}>Continue next</button>
              </div>
            )}
          </Show>
          <Show when={session.navigationReliable() && (session.previousEpisode() || session.nextEpisode())}>
            <div class="mt-4 flex flex-wrap gap-2" aria-label="Episode navigation">
              <button class="border border-black/18 px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!session.previousEpisode()} onClick={() => { const episode = session.previousEpisode(); if (episode) void session.chooseEpisode(episode.id) }}>Previous episode</button>
              <button class="border border-black/18 px-3 py-2 font-mono text-[10px] uppercase tracking-[.1em] transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!session.nextEpisode()} onClick={() => { const episode = session.nextEpisode(); if (episode) void session.chooseEpisode(episode.id) }}>Next episode</button>
            </div>
          </Show>
          <Show when={session.selectedEpisode()}>
            <ServerPicker
              servers={session.servers()}
              currentServerId={session.selectedServer()}
              onServerChange={(id) => {
                void session.chooseServer(id)
              }}
              loading={session.loading() === 'servers'}
            />
          </Show>
          <Show when={session.matchedAnime()}>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-white/75 bg-white/62 p-4 font-mono text-[10px] uppercase tracking-[.08em] shadow-[0_16px_36px_-24px_rgb(0_0_0/.38)] backdrop-blur-xl">
              <span>
                <small class="mr-2 text-[#4f4e57]">Source mapping</small>
                Matched to <b>{session.matchedAnime()!.title}</b> on <b>{session.sourceName()}</b>
              </span>
              <button
                class="border border-black/18 px-3 py-2 text-[9px] transition hover:bg-black hover:text-white"
                type="button"
                onClick={session.openMatchPicker}
              >
                Change match
              </button>
            </div>
          </Show>
        </div>
        <aside class="min-w-0">
          <Show when={session.episodes().length > 0}>
            <EpisodeList
              episodes={session.episodes()}
              currentEpisodeId={session.selectedEpisode()}
              onEpisodeChange={(id) => {
                void session.chooseEpisode(id)
              }}
            />
          </Show>
        </aside>
      </div>
    </section>
  )
}

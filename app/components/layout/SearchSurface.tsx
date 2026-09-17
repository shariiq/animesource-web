import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@tanstack/solid-router'
import type { AniListMedia } from '../../data/anilist/types'
import { suggestQuery } from '../../data/options'
import { makeBrowseSearch } from '../../lib/browse'
import { formatEnum, titleOf } from '../../lib/format'
import {
  groupSuggestions,
  intentForQuery,
  intentForSuggestion,
  normalizeSearchQuery,
  SEARCH_HISTORY_CHANGED_EVENT,
} from '../../lib/search'
import {
  browserSearchHistory,
  type SearchHistoryItem,
} from '../../lib/persistence/searchHistory'

const SEARCH_DELAY_MS = 320
const SEARCH_FIELD_ID = 'global-search-field'
const SEARCH_LIST_ID = 'global-search-suggestions'

/**
 * The single site-wide search hub. Input stays local until an explicit action
 * commits a suggestion or query, keeping ordinary typing an in-place update.
 */
export function SearchSurface() {
  const navigate = useNavigate()
  const [input, setInput] = createSignal('')
  const [query, setQuery] = createSignal('')
  const [open, setOpen] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [activeIndex, setActiveIndex] = createSignal(-1)
  const [history, setHistory] = createSignal<SearchHistoryItem[]>([])
  const [historyError, setHistoryError] = createSignal<string | null>(null)
  let root: HTMLDivElement | undefined
  let field: HTMLInputElement | undefined
  let debounceTimer: number | undefined

  const suggestions = createQuery(() => suggestQuery(query()))
  // Solid Query's data accessor suspends while an enabled query has no data.
  // Never read it during that state: this search lives above the route-level
  // Suspense boundary, so suspending here would temporarily replace the root
  // layout and steal focus from the field.
  const items = () => (suggestions.isPending ? [] : suggestions.data ?? [])
  const groups = createMemo(() => groupSuggestions(items(), query()))
  const suggestionItems = createMemo(() => groups().flatMap((group) => group.items))
  const showHistory = () => input().trim().length === 0 && history().length > 0
  const showList = () => ready() && open() && (showHistory() || query().length > 1)

  onMount(() => {
    const refreshHistory = () => {
      void browserSearchHistory.get()
        .then(setHistory)
        .catch(() => setHistoryError('Recent searches are unavailable in this browser.'))
    }
    refreshHistory()
    setReady(true)
    // A browser can restore text into the field before hydration finishes.
    if (field?.value) applyValue(field.value)

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false)
    }
    const focusShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.key === '/' &&
        target?.tagName !== 'INPUT' &&
        target?.tagName !== 'TEXTAREA'
      ) {
        event.preventDefault()
        field?.focus()
      }
    }

    window.addEventListener(SEARCH_HISTORY_CHANGED_EVENT, refreshHistory)
    document.addEventListener('click', closeOnOutsideClick)
    document.addEventListener('keydown', focusShortcut)
    onCleanup(() => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
      window.removeEventListener(SEARCH_HISTORY_CHANGED_EVENT, refreshHistory)
      document.removeEventListener('click', closeOnOutsideClick)
      document.removeEventListener('keydown', focusShortcut)
    })
  })

  const remember = (value: string) => {
    void browserSearchHistory.record(value)
      .then(() => browserSearchHistory.get().then(setHistory))
      .catch(() => setHistoryError('Recent searches could not be saved.'))
  }

  /**
   * The one place a field value becomes reactive state. The field itself is
   * deliberately uncontrolled: re-asserting `value` from a signal on every
   * keystroke makes Solid rewrite `input.value`, which collapses the caret to
   * the start of the field and scrambles the text as the user types.
   */
  const applyValue = (value: string) => {
    setInput(value)
    setActiveIndex(-1)
    setQuery(normalizeSearchQuery(value) ?? '')
  }

  /** Programmatic text changes must also write the DOM the user types into. */
  const writeField = (value: string) => {
    if (field) field.value = value
    applyValue(value)
  }

  const updateInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const value = event.currentTarget.value
    const trimmed = value.trim()
    const normalized = normalizeSearchQuery(value)
    applyValue(value)
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)

    setOpen(trimmed.length > 1 || (trimmed.length === 0 && history().length > 0))
    if (trimmed.length <= 1) return

    // Retain a short quiet period before surfacing network state changes while
    // the query itself remains fully reactive to the current Solid signal.
    debounceTimer = window.setTimeout(() => {
      setOpen(Boolean(normalized))
    }, SEARCH_DELAY_MS)
  }

  const openAnime = async (anime: AniListMedia) => {
    const intent = intentForSuggestion(anime)
    const value = normalizeSearchQuery(input())
    if (value) remember(value)
    setOpen(false)
    field?.blur()
    await navigate({
      to: '/anime/$animeId',
      params: { animeId: String(intent.animeId) },
    })
  }

  const submitSearch = async (value = input()) => {
    const intent = intentForQuery(value)
    if (!intent || value.trim().length > 100) return
    remember(intent.query)
    setOpen(false)
    field?.blur()
    await navigate({
      to: '/explore',
      search: makeBrowseSearch({ query: intent.query }),
    })
  }

  const submitForm = (event: SubmitEvent) => {
    event.preventDefault()
    void submitSearch()
  }

  const openRecent = (item: SearchHistoryItem) => {
    writeField(item.query)
    void submitSearch(item.query)
  }

  const clearHistory = () => {
    void browserSearchHistory.clear()
      .then(() => {
        setHistory([])
        setHistoryError(null)
      })
      .catch(() => setHistoryError('Recent searches could not be cleared.'))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      field?.blur()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = suggestionItems()[activeIndex()]
      void (item ? openAnime(item) : submitSearch())
      return
    }
    if (!open() || suggestionItems().length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestionItems().length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        index <= 0 ? suggestionItems().length - 1 : index - 1,
      )
    }
  }

  const suggestionIndex = (anime: AniListMedia) =>
    suggestionItems().findIndex((item) => item.id === anime.id)
  const resultMeta = (anime: AniListMedia) =>
    [anime.format ? formatEnum(anime.format) : null, anime.seasonYear]
      .filter(Boolean)
      .join(' · ') || 'Anime'

  return (
    <div
      class="search-surface search-surface-compact"
      ref={root}
      role="search"
      aria-label="Quick anime search"
    >
      <div class="search-surface-query">
        <form class="search-surface-form" onSubmit={submitForm}>
          <div class="search-surface-control">
            <label class="sr-only" for={SEARCH_FIELD_ID}>
              Search anime
            </label>
            <span class="search-surface-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              id={SEARCH_FIELD_ID}
              ref={field}
              class="editorial-field search-surface-input"
              type="search"
              placeholder="Search anime…"
              autocomplete="off"
              maxlength="100"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-controls={ready() ? SEARCH_LIST_ID : undefined}
              aria-expanded={showList()}
              aria-activedescendant={
                activeIndex() >= 0
                  ? `${SEARCH_LIST_ID}-option-${activeIndex()}`
                  : undefined
              }
              onInput={updateInput}
              onFocus={() => setOpen(input().trim().length > 1 || showHistory())}
              onKeyDown={onKeyDown}
            />
            <button
              class="search-surface-submit ink-control"
              type="submit"
              aria-label="Search"
            >
              <span class="search-submit-label">Search</span>
              <span class="search-submit-icon" aria-hidden="true">
                ↗
              </span>
            </button>
          </div>
        </form>

        <Show when={showList()}>
          <div
            id={SEARCH_LIST_ID}
            class="search-surface-popover material-panel"
            role="listbox"
            aria-label="Search suggestions"
          >
            <Show when={showHistory()}>
              <div class="search-history-popover">
                <div class="search-surface-list-heading">
                  <span>Recent searches</span>
                  <button type="button" onClick={clearHistory}>
                    Clear
                  </button>
                </div>
                <For each={history()}>
                  {(item) => (
                    <button
                      class="search-history-item"
                      type="button"
                      role="option"
                      onClick={() => openRecent(item)}
                    >
                      <span>{item.query}</span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={query().length > 1}>
              <Show
                when={input().trim().length <= 100}
                fallback={
                  <p class="search-surface-state" role="alert">
                    Keep searches to 100 characters or fewer.
                  </p>
                }
              >
                <Show
                  when={!suggestions.isPending}
                  fallback={<p class="search-surface-state">Searching AniList…</p>}
                >
                  <Show
                    when={!suggestions.isError}
                    fallback={
                      <p class="search-surface-state" role="alert">
                        Search is temporarily unavailable.
                      </p>
                    }
                  >
                    <Show
                      when={suggestionItems().length > 0}
                      fallback={
                        <p class="search-surface-state">
                          No matching anime found. Press Enter to browse this
                          exact query.
                        </p>
                      }
                    >
                      <For each={groups()}>
                        {(group) => (
                          <section
                            class="search-surface-group"
                            aria-label={group.label}
                          >
                            <p class="search-surface-list-heading">
                              {group.label}
                            </p>
                            <For each={group.items}>
                              {(anime) => {
                                const index = () => suggestionIndex(anime)
                                return (
                                  <button
                                    id={`${SEARCH_LIST_ID}-option-${index()}`}
                                    class="search-result editorial-row"
                                    data-active={
                                      activeIndex() === index()
                                    }
                                    type="button"
                                    role="option"
                                    aria-selected={
                                      activeIndex() === index()
                                    }
                                    onMouseEnter={() =>
                                      setActiveIndex(index())
                                    }
                                    onClick={() => {
                                      void openAnime(anime)
                                    }}
                                  >
                                    <Show
                                      when={
                                        anime.coverImage?.medium ??
                                        anime.coverImage?.large
                                      }
                                      keyed
                                      fallback={
                                        <span
                                          class="search-result-cover"
                                          aria-hidden="true"
                                        >
                                          ✦
                                        </span>
                                      }
                                    >
                                      {(cover) => (
                                        <img
                                          class="search-result-cover object-cover"
                                          src={cover}
                                          alt=""
                                          loading="lazy"
                                          width="42"
                                          height="60"
                                        />
                                      )}
                                    </Show>
                                    <span class="search-result-copy">
                                      <strong>{titleOf(anime)}</strong>
                                      <small>{resultMeta(anime)}</small>
                                    </span>
                                  </button>
                                )
                              }}
                            </For>
                          </section>
                        )}
                      </For>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={historyError()}>
        {(message) => (
          <p class="search-surface-status" role="status">
            {message()}
          </p>
        )}
      </Show>
    </div>
  )
}

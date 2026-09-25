import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import type { AniListMedia } from "../app/data/anilist/types";

const searchMocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  suggest: vi.fn(async () => [] as AniListMedia[]),
}));

// Vidstack ships as client-only custom elements: the player defines are
// dynamically imported after mount, so these module mocks stand in for the
// browser upgrade while the tests drive the component through real DOM events.
vi.mock("hls.js", () => ({
  default: class Hls {
    static Events = { ERROR: "hlsError" };
  },
}));
vi.mock("vidstack", () => ({
  isHLSProvider: (provider: unknown) =>
    !!provider &&
    typeof provider === "object" &&
    "onInstance" in (provider as Record<string, unknown>),
}));
vi.mock("vidstack/player", () => ({}));
vi.mock("vidstack/player/layouts/default", () => ({}));
vi.mock("vidstack/player/ui", () => ({}));

// Keep these tests independent of a mounted TanStack Router and AniList.
vi.mock("@tanstack/solid-router", () => ({
  Link: (props: { to?: string; href?: string; children: JSX.Element }) => (
    <a href={props.href ?? props.to ?? "#"}>{props.children}</a>
  ),
  useNavigate: () => searchMocks.navigate,
}));
vi.mock("../app/data/anilist/queries", () => ({
  alGenres: async () => ["Action", "Comedy"],
}));

// Control the home query's queryFn per test so each branch (loading, error,
// success) is exercised without a live network call.
let mockHomeQueryFn: (() => Promise<HomeData>) | null = null;
let mockBrowseQueryFn: (() => Promise<{ pageInfo: { currentPage: number; lastPage: number; hasNextPage: boolean; total: number }; media: AniListMedia[] }>) | null = null;
vi.mock("../app/data/options", () => ({
  homeQuery: () => ({
    queryKey: ["anilist", "home"],
    queryFn: () =>
      mockHomeQueryFn ? mockHomeQueryFn() : new Promise<HomeData>(() => {}),
    staleTime: 1,
  }),
  genresQuery: () => ({
    queryKey: ["anilist", "genres"],
    queryFn: () => ["Action", "Comedy"],
    staleTime: 1,
  }),
  browseQuery: () => ({
    queryKey: ["anilist", "browse"],
    queryFn: () => mockBrowseQueryFn?.(),
    staleTime: 1,
  }),
  suggestQuery: (query: string) => ({
    queryKey: ["anilist", "suggest", query],
    queryFn: () => searchMocks.suggest(),
    enabled: query.length > 1,
    staleTime: 1,
  }),
}));

import { Rail } from "../app/components/home/Rail";
import { AnimeCard } from "../app/components/home/AnimeCard";
import { HomePage } from "../app/components/home/HomePage";
import { EpisodeList } from "../app/components/anime/watch/EpisodeList";
import { ServerPicker } from "../app/components/anime/watch/ServerPicker";
import { LazyPlayer } from "../app/components/anime/watch/LazyPlayer";
import { HeroCarousel } from "../app/components/home/HeroCarousel";
import { ExplorePage } from "../app/components/explore/ExplorePage";
import { makeBrowseSearch } from "../app/lib/browse";
import { SearchSurface } from "../app/components/layout/SearchSurface";

type HomeData = {
  trending: { media: AniListMedia[] };
  season: { media: AniListMedia[] };
  allTime: { media: AniListMedia[] };
  topRated: { media: AniListMedia[] };
  upcoming: { media: AniListMedia[] };
};

const media = (over: Partial<AniListMedia>): AniListMedia => ({
  id: 1,
  type: "ANIME",
  title: { romaji: "Test Anime", english: null, native: null },
  coverImage: {
    extraLarge: null,
    large: "https://cdn.test/cover.jpg",
    medium: null,
    color: null,
  },
  bannerImage: null,
  averageScore: 80,
  popularity: 100,
  format: "TV",
  status: "RELEASING",
  episodes: 12,
  season: "FALL",
  seasonYear: 2024,
  genres: ["Action"],
  nextAiringEpisode: null,
  ...over,
});

const homeData = {
  trending: {
    media: [
      media({
        id: 1,
        title: { romaji: "One Piece", english: null, native: null },
      }),
    ],
  },
  season: {
    media: [
      media({
        id: 2,
        title: { romaji: "Bleach", english: null, native: null },
      }),
    ],
  },
  allTime: { media: [] },
  topRated: { media: [] },
  upcoming: { media: [] },
};

function wrap(client: QueryClient, node: () => JSX.Element) {
  return () => (
    <QueryClientProvider client={client}>{node()}</QueryClientProvider>
  );
}

describe("AnimeCard", () => {
  it("omits the rank badge and unavailable metadata without leaving empty card chrome", () => {
    const sparse = media({
      title: { romaji: "Sparse signal", english: null, native: null },
      coverImage: null,
      averageScore: null,
      meanScore: null,
      episodes: null,
      format: null,
      status: null,
      seasonYear: null,
      genres: null,
      nextAiringEpisode: null,
    });
    const { container } = render(() => <AnimeCard anime={sparse} />);

    expect(screen.getByRole("link", { name: /Sparse signal/i })).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/episodes/i)).not.toBeInTheDocument();
    expect(container.querySelector(".backdrop-blur-\\[8px\\]")).not.toBeInTheDocument();
  });

  it("renders a rank badge only for ranked card contexts", () => {
    const { unmount } = render(() => <AnimeCard anime={media({})} rank={1} />);
    expect(screen.getByText("01")).toBeInTheDocument();
    unmount();

    const unranked = render(() => <AnimeCard anime={media({})} />);
    expect(unranked.container.querySelector(".backdrop-blur-\\[8px\\]")).not.toBeInTheDocument();
  });
});

describe("Rail", () => {
  it("shows its empty state and no arrows when there are no items", () => {
    render(() => <Rail title="Empty rail" items={[]} />);
    expect(
      screen.getByText("No titles available."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Scroll Empty rail right/ }),
    ).not.toBeInTheDocument();
  });
});

describe("discovery metadata", () => {
  it("does not call airing, upcoming, hiatus or cancelled anime finished when no next episode is scheduled", () => {
    const items = [
      media({ id: 1, status: "RELEASING", bannerImage: "https://cdn.test/banner.jpg" }),
      media({ id: 2, status: "NOT_YET_RELEASED", bannerImage: "https://cdn.test/banner.jpg" }),
      media({ id: 3, status: "HIATUS", bannerImage: "https://cdn.test/banner.jpg" }),
      media({ id: 4, status: "CANCELLED", bannerImage: "https://cdn.test/banner.jpg" }),
      media({ id: 5, status: "FINISHED", bannerImage: "https://cdn.test/banner.jpg" }),
    ];
    render(() => <HeroCarousel items={items} />);
    expect(screen.getByText("Next airing TBA")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab")[2]!);
    expect(screen.getByText("Schedule unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab")[3]!);
    expect(screen.getByText("Schedule unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab")[4]!);
    expect(screen.getByText("Finished", { exact: true })).toBeInTheDocument();
  });

  it("keeps pagination available without claiming zero pages for an unbounded result", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mockBrowseQueryFn = async () => ({
      pageInfo: { currentPage: 1, lastPage: 0, hasNextPage: true, total: 24 },
      media: [media({})],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(wrap(client, () => <ExplorePage search={() => makeBrowseSearch()} />));
      expect(await screen.findByRole("navigation", { name: "Explore results pages" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Next →" })).toBeInTheDocument();
      expect(screen.queryByText("0 pages")).not.toBeInTheDocument();
    } finally {
      await Promise.resolve();
      mockBrowseQueryFn = null;
      client.clear();
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      vi.unstubAllGlobals();
    }
  });
});

describe("watch selectors", () => {
  const episodes = [
    {
      id: "episode-1",
      number: 1,
      title: "Arrival",
      is_filler: false,
      has_sub: true,
      has_dub: false,
      scanlator: "",
      released_at: null,
    },
    {
      id: "episode-2",
      number: 2,
      title: "Filler",
      is_filler: true,
      has_sub: false,
      has_dub: true,
      scanlator: "",
      released_at: null,
    },
  ];

  it("filters episodes and makes keyboard selection work", () => {
    const selectEpisode = vi.fn();
    render(() => (
      <EpisodeList
        episodes={episodes}
        currentEpisodeId={null}
        onEpisodeChange={selectEpisode}
      />
    ));
    expect(
      screen.getByRole("button", { name: "Episode 1: Arrival" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by audio"), {
      target: { value: "dub" },
    });
    expect(
      screen.queryByRole("button", { name: "Episode 1: Arrival" }),
    ).not.toBeInTheDocument();
    const filler = screen.getByRole("button", { name: "Episode 2: Filler" });
    filler.focus();
    fireEvent.keyDown(filler, { key: "Enter" });
    expect(selectEpisode).toHaveBeenCalledWith("episode-2");
  });

  it("identifies the currently playing episode as the selection changes", () => {
    const [currentEpisodeId, setCurrentEpisodeId] = createSignal("episode-1");
    render(() => (
      <EpisodeList episodes={episodes} currentEpisodeId={currentEpisodeId()} onEpisodeChange={() => undefined} />
    ));
    expect(screen.getByRole("button", { name: "Episode 1: Arrival" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Episode 2: Filler" })).not.toHaveAttribute("aria-current");
    setCurrentEpisodeId("episode-2");
    expect(screen.getByRole("button", { name: "Episode 1: Arrival" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Episode 2: Filler" })).toHaveAttribute("aria-current", "true");
  });

  it("renders grouped servers and an empty state", () => {
    const selectServer = vi.fn();
    const { unmount } = render(() => (
      <ServerPicker
        servers={[]}
        currentServerId={null}
        onServerChange={selectServer}
        loading={false}
      />
    ));
    expect(
      screen.getByText("No servers available for this episode."),
    ).toBeInTheDocument();
    unmount();
    render(() => (
      <ServerPicker
        servers={[{ id: "s1", name: "Vidcloud", type: "SUB" }]}
        currentServerId="s1"
        onServerChange={selectServer}
        loading={false}
      />
    ));
    const selectedServer = screen.getByRole("button", { name: "Vidcloud" });
    expect(selectedServer).toHaveAttribute("aria-pressed", "true");
    expect(selectedServer).toHaveClass("border-black", "bg-black", "text-white");
  });
});

describe("LazyPlayer", () => {
  const direct = {
    url: "https://cdn.example/video.mp4",
    quality: "720p",
    headers: {},
    subtitles: [],
    is_hls: false,
    is_audio: false,
  };
  const hlsStream = {
    url: "https://api.test/proxy/hls/token",
    quality: "720p",
    headers: {},
    subtitles: [],
    is_hls: true,
    is_audio: false,
  };
  const audioStream = {
    ...hlsStream,
    url: "https://api.test/proxy/hls/audio",
    quality: "Japanese",
    is_audio: true,
  };
  const subtitled = {
    ...hlsStream,
    subtitles: [
      { url: "https://api.test/subs/en.vtt", label: "English", language: "en" },
    ],
  };
  const nullPrefs = {
    quality: null,
    audioLanguage: null,
    audioLabel: null,
    subtitleLanguage: null,
    subtitleLabel: null,
  };
  const identity = {
    key: "source:episode:server",
    sourceId: "source",
    episodeId: "episode",
    serverId: "server",
  };

  const playerOf = (container: HTMLElement) =>
    container.querySelector("media-player")! as HTMLElement & {
      src?: { src: string; type?: string }[];
      currentTime: number;
      duration: number;
    };
  const emit = (target: EventTarget, type: string, detail?: unknown) =>
    target.dispatchEvent(
      detail === undefined
        ? new Event(type)
        : new CustomEvent(type, { detail }),
    );

  beforeEach(() => {
    // No subtitle loading happens in the player anymore: tracks are declared
    // with direct URLs for the player to fetch and parse natively.
  });

  it("hands the preferred video stream to the player as typed HLS", async () => {
    const { container } = render(() => (
      <LazyPlayer streams={[hlsStream, audioStream]} serverName="Test" />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    emit(player, "media-player-connect");
    await waitFor(() =>
      expect(playerOf(container).src).toHaveLength(1),
    );
    expect(playerOf(container).src![0]).toMatchObject({
      src: hlsStream.url,
      type: "application/x-mpegurl",
    });
  });

  it("opens on the saved quality when the server exposes variants", async () => {
    const variants = [
      { ...direct, url: "https://cdn.example/high.mp4", quality: "1080p" },
      { ...direct, url: "https://cdn.example/low.mp4", quality: "720p" },
    ];
    const { container } = render(() => (
      <LazyPlayer
        streams={variants}
        preferences={{ ...nullPrefs, quality: "720p" }}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    emit(player, "media-player-connect");
    await waitFor(() =>
      expect(playerOf(container).src).toHaveLength(2),
    );
    expect(playerOf(container).src![0]!.src).toContain("low.mp4");
  });

  it("exposes external subtitles as tracks with the saved language default", async () => {
    const { container } = render(() => (
      <LazyPlayer
        streams={[subtitled]}
        preferences={{ ...nullPrefs, subtitleLanguage: "en", subtitleLabel: "English" }}
      />
    ));
    const track = (await waitFor(() => {
      const found = container.querySelector('track[label="English"]');
      expect(found).toBeInTheDocument();
      return found!;
    })) as HTMLTrackElement;
    expect(track.srclang).toBe("en");
    expect(track.default).toBe(true);
    expect(track.src).toBe(subtitled.subtitles[0]!.url);
    expect(track.getAttribute("data-type")).toBe("vtt");
  });

  it("declares each caption format so the player parses it natively", async () => {
    const multi = {
      ...hlsStream,
      subtitles: [
        { url: "https://api.test/subs/en.srt", label: "English", language: "en" },
        { url: "https://api.test/subs/jp.ass", label: "Japanese", language: "ja" },
      ],
    };
    const { container } = render(() => <LazyPlayer streams={[multi]} />);
    await waitFor(() =>
      expect(container.querySelectorAll("track")).toHaveLength(2),
    );
    expect(
      container.querySelector('track[label="English"]')?.getAttribute("data-type"),
    ).toBe("srt");
    expect(
      container.querySelector('track[label="Japanese"]')?.getAttribute("data-type"),
    ).toBe("ass");
  });

  it("lists each subtitle language once when variants repeat it", async () => {
    const variants = [
      subtitled,
      { ...subtitled, url: "https://api.test/proxy/hls/low", quality: "360p" },
    ];
    const { container } = render(() => <LazyPlayer streams={variants} />);
    await waitFor(() =>
      expect(container.querySelectorAll("track")).toHaveLength(1),
    );
  });

  it("offers saved progress as a choice instead of applying it", async () => {
    const { container } = render(() => (
      <LazyPlayer streams={[direct]} resumeAt={45} />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    player.currentTime = 0;
    player.duration = 120;
    emit(player, "media-player-connect");
    emit(player, "can-play");
    expect(player.currentTime).toBe(0);
    expect(
      screen.getByRole("dialog", { name: /Continue watching/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue from 0:45/ }));
    expect(player.currentTime).toBe(45);
    expect(
      screen.queryByRole("dialog", { name: /Continue watching/ }),
    ).not.toBeInTheDocument();
  });

  it("lets the viewer start from the beginning instead of saved progress", async () => {
    const { container } = render(() => (
      <LazyPlayer streams={[direct]} resumeAt={45} />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    player.currentTime = 0;
    player.duration = 120;
    emit(player, "media-player-connect");
    emit(player, "can-play");

    fireEvent.click(
      screen.getByRole("button", { name: "Start from beginning" }),
    );
    expect(player.currentTime).toBe(0);
    expect(
      screen.queryByRole("dialog", { name: /Continue watching/ }),
    ).not.toBeInTheDocument();
  });

  it("restores playback and throttles progress while flushing lifecycle boundaries", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const onProgress = vi.fn(async () => undefined);
      const onEnded = vi.fn(async () => undefined);
      const { container, unmount } = render(() => (
        <LazyPlayer
          streams={[direct]}
          identity={identity}
          onProgress={onProgress}
          onEnded={onEnded}
        />
      ));
      const player = await waitFor(() => {
        expect(playerOf(container)).toBeInTheDocument();
        return playerOf(container);
      });
      // waitFor advances fake timers while polling for the async player
      // boot: re-anchor the clock so the throttle windows below are exact.
      vi.setSystemTime(0);
      player.duration = 120;
      // Progress writes run through a chained queue, so each step settles
      // the queue without touching the fake clock.
      const settleWrites = async () => {
        for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
      };

      player.currentTime = 46;
      emit(player, "time-update");
      await settleWrites();
      expect(onProgress).toHaveBeenLastCalledWith(identity, 46, 120);

      vi.setSystemTime(2000);
      player.currentTime = 48;
      emit(player, "time-update");
      await settleWrites();
      expect(onProgress).toHaveBeenCalledTimes(1);

      vi.setSystemTime(4000);
      player.currentTime = 50;
      emit(player, "time-update");
      await settleWrites();
      expect(onProgress).toHaveBeenLastCalledWith(identity, 50, 120);

      player.currentTime = 51;
      emit(player, "pause");
      await settleWrites();
      expect(onProgress).toHaveBeenLastCalledWith(identity, 51, 120);

      emit(player, "ended");
      await settleWrites();
      expect(onEnded).toHaveBeenCalledWith(identity);

      player.currentTime = 52;
      unmount();
      await settleWrites();
      expect(onProgress).toHaveBeenLastCalledWith(identity, 52, 120);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes expired failures to the session for silent recovery", async () => {
    const onMediaError = vi.fn(() => true);
    const { container } = render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        identity={identity}
        onMediaError={onMediaError}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    // The HLS provider hands over its hls.js instance; raw library errors
    // arrive per failed attempt, ahead of any escalated fatal.
    const instanceHandlers: Record<string, (...args: unknown[]) => void> = {};
    const instanceCbs: Array<(instance: unknown) => void> = [];
    emit(player, "provider-change", {
      library: null,
      config: null,
      onInstance: (callback: (instance: unknown) => void) => {
        instanceCbs.push(callback);
      },
    });
    expect(instanceCbs).toHaveLength(1);
    instanceCbs[0]!({
      on: (event: string, handler: (...args: unknown[]) => void) => {
        instanceHandlers[event] = handler;
      },
    });
    instanceHandlers.hlsError!(
      "hlsError",
      {
        fatal: true,
        type: "networkError",
        details: "fragLoadError",
        response: { code: 410 },
      },
    );

    expect(onMediaError).toHaveBeenCalledWith(
      identity,
      expect.stringContaining("expired"),
      true,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refreshing stream…",
    );
  });

  it("treats an error message carrying an expiry status as an expired link", async () => {
    const onMediaError = vi.fn(() => true);
    const { container } = render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        identity={identity}
        onMediaError={onMediaError}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    emit(player, "error", { message: "Failed to load resource: 403" });

    expect(onMediaError).toHaveBeenCalledWith(
      identity,
      expect.stringContaining("expired"),
      true,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores non-fatal HLS errors the library recovers from itself", async () => {
    const onMediaError = vi.fn(() => true);
    const { container } = render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        identity={identity}
        onMediaError={onMediaError}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    const instanceHandlers: Record<string, (...args: unknown[]) => void> = {};
    const instanceCbs: Array<(instance: unknown) => void> = [];
    emit(player, "provider-change", {
      library: null,
      config: null,
      onInstance: (callback: (instance: unknown) => void) => {
        instanceCbs.push(callback);
      },
    });
    instanceCbs[0]!({
      on: (event: string, handler: (...args: unknown[]) => void) => {
        instanceHandlers[event] = handler;
      },
    });
    instanceHandlers.hlsError!("hlsError", {
      fatal: false,
      type: "mediaError",
    });

    expect(onMediaError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores HLS errors from a superseded instance after switching servers", async () => {
    const onMediaError = vi.fn(() => true);
    const { container } = render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        identity={identity}
        onMediaError={onMediaError}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    const instanceHandlers: Record<string, (...args: unknown[]) => void> = {};
    const instanceCbs: Array<(instance: unknown) => void> = [];
    const attach = () => {
      emit(player, "provider-change", {
        library: null,
        config: null,
        onInstance: (callback: (instance: unknown) => void) => {
          instanceCbs.push(callback);
        },
      });
      instanceCbs[instanceCbs.length - 1]!({
        on: (event: string, handler: (...args: unknown[]) => void) => {
          instanceHandlers[`${instanceCbs.length}:${event}`] = handler;
        },
      });
    };
    attach();
    attach();
    // The first instance belongs to the previous selection: its late failure
    // must not report against the current one.
    instanceHandlers["1:hlsError"]!("hlsError", {
      fatal: true,
      type: "networkError",
      response: { code: 410 },
    });

    expect(onMediaError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces unrecoverable failures with retry and a stream link fallback", async () => {
    const onMediaError = vi.fn(() => false);
    const onRetry = vi.fn(async () => undefined);
    const { container } = render(() => (
      <LazyPlayer
        streams={[direct]}
        identity={identity}
        onMediaError={onMediaError}
        onRetry={onRetry}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });
    emit(player, "error", { message: "Playback failed" });

    expect(onMediaError).toHaveBeenCalledWith(
      identity,
      "Playback failed",
      false,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Playback failed");

    // jsdom has no clipboard: the raw link stays readable while failed.
    expect(screen.getByDisplayValue(direct.url)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry stream" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refreshing stream…",
    );
  });

  it("persists quality, audio, and caption choices from the player menus", async () => {
    const onPreferencesChange = vi.fn();
    const { container } = render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        preferences={nullPrefs}
        onPreferencesChange={onPreferencesChange}
      />
    ));
    const player = await waitFor(() => {
      expect(playerOf(container)).toBeInTheDocument();
      return playerOf(container);
    });

    emit(player, "quality-change", { height: 720 });
    emit(player, "audio-track-change", {
      language: "ja",
      label: "Japanese",
    });
    emit(player, "text-track-change", {
      language: "en",
      label: "English",
    });

    expect(onPreferencesChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ quality: "720p" }),
    );
    expect(onPreferencesChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        audioLanguage: "ja",
        audioLabel: "Japanese",
      }),
    );
    expect(onPreferencesChange).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        subtitleLanguage: "en",
        subtitleLabel: "English",
      }),
    );
  });

  it("renders nothing without streams", () => {
    const { container } = render(() => <LazyPlayer streams={[]} />);
    expect(container.querySelector("media-player")).not.toBeInTheDocument();
  });
});


describe("SearchSurface", () => {
  beforeEach(() => {
    searchMocks.navigate.mockClear()
    searchMocks.suggest.mockReset()
    searchMocks.suggest.mockResolvedValue([])
  })

  it("keeps typing local and separates query submission from suggestion selection", async () => {
    searchMocks.suggest.mockResolvedValue([media({ id: 7, title: { romaji: "One Piece", english: null, native: null } })])
    const searchClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    render(wrap(searchClient, () => <SearchSurface />))
    const field = screen.getByRole("combobox", { name: "Search anime" })
    fireEvent.input(field, { target: { value: "One Piece" } })
    expect(searchMocks.navigate).not.toHaveBeenCalled()
    expect(await screen.findByRole("option", { name: /One Piece/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: /One Piece/ }))
    expect(searchMocks.navigate).toHaveBeenCalledWith({ to: "/anime/$animeId", params: { animeId: "7" } })

    searchMocks.navigate.mockClear()
    fireEvent.input(field, { target: { value: "Cowboy Bebop" } })
    fireEvent.click(screen.getByRole("button", { name: "Search" }))
    await waitFor(() => expect(searchMocks.navigate).toHaveBeenCalledWith({
      to: "/explore",
      search: expect.objectContaining({ query: "Cowboy Bebop", page: 1 }),
    }))
  })

  it("debounces suggestion requests until typing settles", async () => {
    const searchClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    render(wrap(searchClient, () => <SearchSurface />))
    const field = screen.getByRole("combobox", { name: "Search anime" })

    fireEvent.input(field, { target: { value: "On" } })
    fireEvent.input(field, { target: { value: "One" } })
    fireEvent.input(field, { target: { value: "One P" } })
    expect(searchMocks.suggest).not.toHaveBeenCalled()

    await waitFor(() => expect(searchMocks.suggest).toHaveBeenCalledTimes(1), { timeout: 1_000 })
  })
})

describe("HomePage", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  it("shows a loading state while the query is pending", () => {
    mockHomeQueryFn = null; // queryFn never resolves — stays pending
    render(wrap(client, () => <HomePage />));
    expect(screen.getByText("Loading anime discovery…")).toBeInTheDocument();
  });

  it("shows an error state with retry when the query fails", async () => {
    mockHomeQueryFn = async () => {
      throw new Error("boom");
    };
    render(wrap(client, () => <HomePage />));
    expect(
      await screen.findByRole("heading", { name: "Couldn't reach AniList" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders rails and the genre browser on success", async () => {
    mockHomeQueryFn = async () => homeData;
    render(wrap(client, () => <HomePage />));
    expect(
      await screen.findAllByRole("link", { name: /One Piece/i }),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "Trending now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Popular this season" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "All-time favorites" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Browse by Genre" }),
    ).toBeInTheDocument();
  });

  it("keeps rails visible during a background refetch instead of flashing loading", async () => {
    mockHomeQueryFn = async () => homeData;
    render(wrap(client, () => <HomePage />));
    expect(
      await screen.findAllByRole("link", { name: /One Piece/i }),
    ).not.toHaveLength(0);

    // The next fetch stays pending: a stale-while-revalidate UI must keep the
    // rails and show a non-blocking refresh signal.
    mockHomeQueryFn = () => new Promise<HomeData>(() => {});
    void client.refetchQueries({ queryKey: ["anilist", "home"] });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Refreshing/i),
    );
    expect(
      screen.getAllByRole("link", { name: /One Piece/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("Loading anime discovery…"),
    ).not.toBeInTheDocument();
  });
});

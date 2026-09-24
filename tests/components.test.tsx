import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import type { AniListMedia } from "../app/data/anilist/types";

const searchMocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  suggest: vi.fn(async () => [] as AniListMedia[]),
}));

const hls = vi.hoisted(() => {
  type Handler = (...args: any[]) => void;
  const state = { supported: true };
  const instances: FakeHls[] = [];
  class FakeHls {
    static Events = {
      ERROR: "hlsError",
      MANIFEST_PARSED: "manifestParsed",
      AUDIO_TRACKS_UPDATED: "audioTracksUpdated",
      AUDIO_TRACK_SWITCHED: "audioTrackSwitched",
      SUBTITLE_TRACKS_UPDATED: "subtitleTracksUpdated",
    };
    static ErrorTypes = {
      NETWORK_ERROR: "networkError",
      MEDIA_ERROR: "mediaError",
    };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    subtitleDisplay = false;
    subtitleTrack = -1;
    currentLevel = -1;
    audioTrack = 0;
    levels: { name?: string; height?: number; bitrate?: number }[] = [];
    audioTracks: { name?: string; lang?: string }[] = [];
    subtitleTracks: { id: number; name?: string; lang?: string }[] = [];
    private handlers = new Map<string, Handler[]>();
    constructor(...args: unknown[]) {
      instances.push(this);
      FakeHls.lastConfig = args[0];
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? [])
        handler(event, ...args);
    }
    static isSupported() {
      return state.supported;
    }
    static lastConfig: unknown = null;
  }
  return { state, instances, FakeHls };
});
const subtitleLoader = vi.hoisted(() => ({
  load: vi.fn(),
}));

// jsdom media elements report no native HLS support (canPlayType returns ''),
// so HLS streams take the dynamic hls.js import path — which this mock controls.
vi.mock("hls.js", () => ({ default: hls.FakeHls }));
vi.mock("../app/data/anisource/client", () => ({
  loadSubtitle: subtitleLoader.load,
}));

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
  it("renders cards for a populated rail", () => {
    render(() => <Rail title="Trending now" items={[media({})]} />);
    expect(
      screen.getByRole("heading", { name: "Trending now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Test Anime/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
  it("shows its empty state and no arrows when there are no items", () => {
    render(() => <Rail title="Empty rail" items={[]} />);
    expect(
      screen.getByText("No titles available."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Scroll Empty rail right/ }),
    ).not.toBeInTheDocument();
  });
  it("renders a see-all link when an explore target is provided", () => {
    render(() => (
      <Rail
        title="Top rated"
        items={[media({})]}
        explore={{
          query: undefined,
          genre: undefined,
          format: undefined,
          status: undefined,
          season: undefined,
          year: undefined,
          sort: "SCORE_DESC",
          page: 1,
        }}
      />
    ));
    expect(screen.getByRole("link", { name: /See all/ })).toHaveAttribute(
      "href",
      "/explore",
    );
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

  beforeEach(() => {
    hls.state.supported = true;
    hls.instances.length = 0;
    (hls.FakeHls as unknown as { lastConfig: unknown }).lastConfig = null;
    subtitleLoader.load.mockReset();
    subtitleLoader.load.mockRejectedValue(new Error("subtitle relay not configured"));
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("plays direct media natively by setting the video source", () => {
    const { container } = render(() => (
      <LazyPlayer streams={[direct]} serverName="Test" />
    ));
    const video = container.querySelector("video")!;
    expect(video).toBeInTheDocument();
    expect(video.src).toContain("video.mp4");
    expect(hls.instances).toHaveLength(0);
  });

  it("prefers hls.js over native HLS even when the browser claims it can play HLS", async () => {
    const canPlayType = vi
      .spyOn(HTMLMediaElement.prototype, "canPlayType")
      .mockReturnValue("maybe");
    const { container } = render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    expect(hls.instances[0]!.loadSource).toHaveBeenCalledWith(hlsStream.url);
    expect(hls.instances[0]!.attachMedia).toHaveBeenCalled();
    expect(container.querySelector("video")!.getAttribute("src")).toBeNull();
    canPlayType.mockRestore();
  });

  it("uses the HLS manifest for quality and alternate audio selection", async () => {
    const onPreferencesChange = vi.fn();
    render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        preferences={{ quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }}
        onPreferencesChange={onPreferencesChange}
      />
    ));
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0]!;
    instance.levels = [
      { name: "1080p", height: 1080, bitrate: 6_000_000 },
      { name: "720p", height: 720, bitrate: 3_000_000 },
    ];
    instance.audioTracks = [
      { name: "English", lang: "en" },
      { name: "Japanese", lang: "ja" },
    ];
    instance.emit("manifestParsed");
    instance.emit("audioTracksUpdated");

    const quality = await screen.findByLabelText("Quality");
    const audio = await screen.findByLabelText("Audio");
    fireEvent.change(quality, { target: { value: "1" } });
    fireEvent.change(audio, { target: { value: "1" } });

    expect(instance.currentLevel).toBe(1);
    expect(instance.audioTrack).toBe(1);
    expect(onPreferencesChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      quality: "720p",
    }));
    expect(onPreferencesChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      quality: null,
      audioLanguage: "ja",
      audioLabel: "Japanese",
    }));
  });

  it("uses native HLS only when hls.js cannot run in this browser", async () => {
    hls.state.supported = false;
    const canPlayType = vi
      .spyOn(HTMLMediaElement.prototype, "canPlayType")
      .mockReturnValue("maybe");
    const { container } = render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() =>
      expect(container.querySelector("video")!.src).toBe(hlsStream.url),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    canPlayType.mockRestore();
  });

  it("explains the limitation without a dead out-of-browser button when neither hls.js nor native HLS can play", async () => {
    hls.state.supported = false;
    render(() => <LazyPlayer streams={[hlsStream]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This browser cannot play HLS streams",
    );
    expect(
      screen.queryByRole("button", { name: /Open stream in a new tab/ }),
    ).not.toBeInTheDocument();
  });

  it("retries a fatal network error once before surfacing a failure", async () => {
    render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0]!;

    instance.emit("hlsError", { fatal: true, type: "networkError" });
    expect(instance.startLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reconnecting to the stream…",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    instance.emit("hlsError", { fatal: true, type: "networkError" });
    expect(instance.startLoad).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This stream could not be played",
    );
  });

  it("re-resolves the current server when the in-player retry is used", async () => {
    const onRetry = vi.fn(async () => undefined);
    render(() => <LazyPlayer streams={[hlsStream]} onRetry={onRetry} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0]!;

    instance.emit("hlsError", { fatal: true, type: "networkError" });
    instance.emit("hlsError", { fatal: true, type: "networkError" });
    const retry = await screen.findByRole("button", { name: "Retry stream" });

    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reconnecting to the stream…",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recovers a fatal media error once and ignores non-fatal errors", async () => {
    render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0]!;

    instance.emit("hlsError", { fatal: false, type: "mediaError" });
    expect(instance.recoverMediaError).not.toHaveBeenCalled();

    instance.emit("hlsError", { fatal: true, type: "mediaError" });
    expect(instance.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves an expired HLS stream to the watch session when it handles recovery", async () => {
    const identity = { key: "source:episode:server", sourceId: "source", episodeId: "episode", serverId: "server" };
    const onMediaError = vi.fn(() => true);
    render(() => <LazyPlayer streams={[hlsStream]} identity={identity} onMediaError={onMediaError} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));

    hls.instances[0]!.emit("hlsError", {
      fatal: true,
      type: "networkError",
      details: "manifestLoadError",
      response: { code: 403 },
    });

    expect(onMediaError).toHaveBeenCalledWith(identity, expect.stringContaining("expired"), true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a 404 segment as an expired link for older API versions", async () => {
    const identity = { key: "source:episode:server", sourceId: "source", episodeId: "episode", serverId: "server" };
    const onMediaError = vi.fn(() => true);
    render(() => <LazyPlayer streams={[hlsStream]} identity={identity} onMediaError={onMediaError} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));

    hls.instances[0]!.emit("hlsError", {
      fatal: true,
      type: "networkError",
      details: "fragLoadError",
      response: { code: 404 },
    });

    expect(onMediaError).toHaveBeenCalledWith(identity, expect.stringContaining("expired"), true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("destroys the previous hls.js instance when the quality variant changes", async () => {
    const variants = [
      hlsStream,
      { ...hlsStream, url: "https://api.test/proxy/hls/low", quality: "360p" },
    ];
    render(() => <LazyPlayer streams={variants} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Quality"), {
      target: { value: "1" },
    });
    await waitFor(() => expect(hls.instances).toHaveLength(2));
    expect(hls.instances[0]!.destroy).toHaveBeenCalled();
    expect(hls.instances[1]!.loadSource).toHaveBeenCalledWith(variants[1]!.url);
  });

  it("keeps standalone audio out of the video stream picker", () => {
    render(() => <LazyPlayer streams={[hlsStream, audioStream]} />);

    expect(screen.queryByLabelText("Stream")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Audio · Japanese" })).not.toBeInTheDocument();
  });

  it("starts the non-audio stream when the API returns audio first", async () => {
    render(() => <LazyPlayer streams={[audioStream, hlsStream]} />);

    await waitFor(() => expect(hls.instances).toHaveLength(1));
    expect(hls.instances[0]!.loadSource).toHaveBeenCalledWith(hlsStream.url);
  });

  it("destroys the hls.js instance when the player unmounts", async () => {
    const { unmount } = render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    unmount();
    expect(hls.instances[0]!.destroy).toHaveBeenCalled();
  });

  it("exposes external subtitle tracks with an off option and toggles their mode", async () => {
    const { container } = render(() => <LazyPlayer streams={[subtitled]} />);
    const select = await screen.findByLabelText("Subtitles");
    expect(select).toHaveValue("-1");

    const track = container.querySelector("track")!;
    expect(track.src).toBe(subtitled.subtitles[0]!.url);
    expect(track.srclang).toBe("en");
    expect(track.track.mode).toBe("disabled");

    fireEvent.change(select, { target: { value: "0" } });
    expect(track.track.mode).toBe("showing");

    fireEvent.change(select, { target: { value: "-1" } });
    expect(track.track.mode).toBe("disabled");
  });

  it("does not forward provider headers to the subtitle loader", async () => {
    const headers = {
      Referer: "https://anikototv.to/",
      Origin: "https://anikototv.to",
    };
    const stream = { ...subtitled, headers };
    subtitleLoader.load.mockResolvedValue(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nRelayed caption",
    );

    const { container } = render(() => <LazyPlayer streams={[stream]} />);
    expect(container.querySelector("track")?.getAttribute("src")).toBeNull();

    await waitFor(() =>
      expect(subtitleLoader.load).toHaveBeenCalledWith(stream.subtitles[0]!.url),
    );
    await waitFor(() =>
      expect(container.querySelector("track")?.getAttribute("src")).toMatch(/^blob:/),
    );
  });

  it("restores the saved subtitle preference when the stream exposes it", async () => {
    const { container } = render(() => (
      <LazyPlayer
        streams={[subtitled]}
        preferences={{ quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: "en", subtitleLabel: "English" }}
      />
    ));
    const select = await screen.findByLabelText("Subtitles");
    expect(select).toHaveValue("0");
    expect(container.querySelector("track")!.track.mode).toBe("showing");
  });

  it("adds subtitle tracks the HLS manifest declares and switches them through hls.js", async () => {
    render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0]!;
    expect(screen.queryByLabelText("Subtitles")).not.toBeInTheDocument();

    instance.subtitleTracks = [{ id: 3, name: "English CC", lang: "en" }];
    instance.emit("subtitleTracksUpdated");

    const select = await screen.findByLabelText("Subtitles");
    fireEvent.change(select, { target: { value: "0" } });
    expect(instance.subtitleTrack).toBe(3);
    expect(instance.subtitleDisplay).toBe(true);
  });

  it("hides the quality selector when the server exposes a single variant", () => {
    render(() => <LazyPlayer streams={[direct]} />);
    expect(screen.queryByLabelText("Quality")).not.toBeInTheDocument();
  });

  it("drives play, pause, mute and seek through the custom console", () => {
    const { container } = render(() => <LazyPlayer streams={[direct]} />);
    const video = container.querySelector("video")!;
    const play = vi.spyOn(video, "play").mockResolvedValue();
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      video.dispatchEvent(new Event("pause"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalled();
    fireEvent.play(video);
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(video.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 120,
    });
    fireEvent.durationChange(video);
    fireEvent.input(screen.getByLabelText("Playback position"), {
      target: { value: "30" },
    });
    expect(video.currentTime).toBe(30);
    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
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
          resumeAt={45}
          onProgress={onProgress}
          onEnded={onEnded}
        />
      ));
      const video = container.querySelector("video")!;
      Object.defineProperty(video, "duration", { configurable: true, value: 120 });
      fireEvent.loadedMetadata(video);
      // Saved progress is offered, never applied automatically.
      expect(video.currentTime).toBe(0);
      const resumeDialog = screen.getByRole("dialog", { name: /Continue watching/ });
      expect(resumeDialog).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Continue from 0:45/ }));
      expect(video.currentTime).toBe(45);
      expect(screen.queryByRole("dialog", { name: /Continue watching/ })).not.toBeInTheDocument();

      video.currentTime = 46;
      fireEvent.timeUpdate(video);
      expect(onProgress).toHaveBeenLastCalledWith(46, 120);

      vi.setSystemTime(2000);
      video.currentTime = 48;
      fireEvent.timeUpdate(video);
      expect(onProgress).toHaveBeenCalledTimes(1);

      vi.setSystemTime(4000);
      video.currentTime = 50;
      fireEvent.timeUpdate(video);
      expect(onProgress).toHaveBeenLastCalledWith(50, 120);

      video.currentTime = 51;
      fireEvent.pause(video);
      expect(onProgress).toHaveBeenLastCalledWith(51, 120);

      fireEvent.ended(video);
      expect(onEnded).toHaveBeenCalledOnce();

      video.currentTime = 52;
      unmount();
      expect(onProgress).toHaveBeenLastCalledWith(52, 120);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the viewer start from the beginning instead of applying saved progress", () => {
    const { container } = render(() => <LazyPlayer streams={[direct]} resumeAt={45} />);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole("button", { name: "Start from beginning" }));
    expect(video.currentTime).toBe(0);
    expect(screen.queryByRole("dialog", { name: /Continue watching/ })).not.toBeInTheDocument();
  });

  it("surfaces progress persistence failures in the player", async () => {
    const failingProgress = () => Promise.reject(new Error("database unavailable"));
    const { container } = render(() => (
      <LazyPlayer streams={[direct]} onProgress={failingProgress} />
    ));
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    fireEvent.loadedMetadata(video);
    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    expect(await screen.findByText(/Playback progress could not be saved/)).toHaveAttribute("role", "status");
  });

  it("surfaces a media element error as a playable fallback", () => {
    const { container } = render(() => <LazyPlayer streams={[direct]} />);
    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This stream could not be played",
    );
  });

  it("requests fullscreen from the player surface", async () => {
    let player: HTMLElement | null = null;
    const requestFullscreen = vi.fn(async function (this: HTMLElement) {
      player = this;
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    const { container } = render(() => <LazyPlayer streams={[direct]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));
    expect(player).toBe(container.querySelector(".player"));
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
  });

  it("requests landscape orientation when fullscreen supports orientation locking", async () => {
    const lock = vi.fn(async () => undefined);
    Object.defineProperty(window.screen, "orientation", {
      configurable: true,
      value: { lock, unlock: vi.fn() },
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async function (this: HTMLElement) {
        Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
    render(() => <LazyPlayer streams={[direct]} />);

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect(lock).toHaveBeenCalledWith("landscape"));
  });

  it("pins the player over the viewport with working controls when element fullscreen is missing", async () => {
    // iPhone Safari has no Element.requestFullscreen: the player must not
    // surrender to the native player (which hides every custom control).
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    const { container } = render(() => <LazyPlayer streams={[direct]} />);
    const stage = container.querySelector(".player")!;

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect(stage.classList.contains("player-fake")).toBe(true));
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeVisible();
    expect(screen.getByLabelText("Playback position")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    await waitFor(() => expect(stage.classList.contains("player-fake")).toBe(false));
    expect(screen.getByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
  });

  it("auto-hides the chrome while playback runs and pins it while paused", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(() => <LazyPlayer streams={[direct]} />);
      const stage = container.querySelector(".player")!;
      const video = container.querySelector("video")!;
      expect(stage).toHaveAttribute("data-chrome", "visible");

      fireEvent.canPlay(video);
      fireEvent.play(video);
      expect(stage).toHaveAttribute("data-chrome", "visible");
      vi.advanceTimersByTime(3500);
      expect(stage).toHaveAttribute("data-chrome", "hidden");

      fireEvent.pause(video);
      expect(stage).toHaveAttribute("data-chrome", "visible");
    } finally {
      vi.useRealTimers();
    }
  });

  it("focuses the screen on a mouse tap so Space pauses without preventing auto-hide", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(() => <LazyPlayer streams={[direct]} />);
      const stage = container.querySelector(".player")!;
      const video = container.querySelector("video")!;
      const tapLayer = container.querySelector(".player-taplayer")!;
      const pause = vi.spyOn(video, "pause").mockImplementation(() => fireEvent.pause(video));
      Object.defineProperty(video, "paused", { configurable: true, value: false });
      fireEvent.canPlay(video);
      fireEvent.play(video);
      screen.getByRole("button", { name: "Pause" }).focus();
      vi.advanceTimersByTime(3500);
      expect(stage).toHaveAttribute("data-chrome", "visible");

      fireEvent.pointerUp(tapLayer, { pointerType: "mouse" });
      expect(document.activeElement).toBe(container.querySelector(".player-screen"));
      fireEvent.keyDown(document.activeElement!, { key: " ", code: "Space" });
      expect(pause).toHaveBeenCalled();

      fireEvent.play(video);
      vi.advanceTimersByTime(3500);
      expect(stage).toHaveAttribute("data-chrome", "hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps fetched quality to the player size with a deeper stall buffer", async () => {
    render(() => <LazyPlayer streams={[hlsStream]} />);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    expect(
      (hls.FakeHls as unknown as { lastConfig: unknown }).lastConfig,
    ).toMatchObject({ capLevelToPlayerSize: true, maxBufferLength: 60 });
  });

  it("points at Auto quality when a pinned level keeps buffering", async () => {
    const { container } = render(() => (
      <LazyPlayer
        streams={[hlsStream]}
        preferences={{ quality: "720p", audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null }}
      />
    ));
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const instance = hls.instances[0]!;
    instance.levels = [
      { name: "1080p", height: 1080, bitrate: 6_000_000 },
      { name: "720p", height: 720, bitrate: 3_000_000 },
    ];
    instance.emit("manifestParsed");
    const video = container.querySelector("video")!;
    fireEvent.canPlay(video);
    fireEvent.waiting(video);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Buffering… · slow connection, try Auto quality",
    );
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

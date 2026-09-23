import { createServer } from "node:http";

const port = Number(process.env.MOCK_API_PORT ?? 3101);

const HOST = "http://127.0.0.1:3101";
// Locally served stand-ins so no external asset is ever requested.
const POSTER_URL = `${HOST}/poster.jpg`;
const STREAM_URL = `${HOST}/api/v1/proxy/hls/mock-stream`;
const SUBTITLE_URL = `${HOST}/api/v1/proxy/hls/mock-subtitle`;
// AniSource episode IDs are opaque and routinely carry query-ish characters;
// the route and client must survive them end to end.
const EPISODE_ID = "episode-1&eps=1";
const MANGA_PAGE_URLS = [
  `${HOST}/api/v1/manga/page/mock-page-1`,
  `${HOST}/api/v1/manga/page/mock-page-2`,
];
let failAniList = false;

const media = (id, title, type = "ANIME") => ({
  id,
  type,
  title: { romaji: title, english: title, native: null },
  coverImage: {
    extraLarge: null,
    large: POSTER_URL,
    medium: null,
    color: null,
  },
  bannerImage: null,
  averageScore: 80,
  popularity: 100,
  format: type === "MANGA" ? "MANGA" : "TV",
  status: "RELEASING",
  episodes: type === "MANGA" ? null : 12,
  chapters: type === "MANGA" ? 108 : null,
  volumes: type === "MANGA" ? 12 : null,
  updatedAt: type === "MANGA" ? 1_758_000_000 : null,
  season: "FALL",
  seasonYear: 2026,
  genres: ["Action"],
  nextAiringEpisode: { episode: 1, airingAt: 0, timeUntilAiring: 0 },
});

const detail = (type = "ANIME", id = 1) => ({
  ...media(id, type === "MANGA" ? "Test Manga" : "Test Anime", type),
  description: type === "MANGA" ? "A test publication description." : "A test description.",
  duration: type === "MANGA" ? null : 24,
  startDate: null,
  endDate: null,
  source: null,
  synonyms: [],
  studios: { nodes: [] },
  trailer: null,
  externalLinks: [],
  characters: { edges: [] },
  relations: {
    edges: type === "ANIME"
      ? [{
          relationType: "SOURCE",
          node: media(2, "Test Manga", "MANGA"),
        }]
      : [{
          relationType: "ADAPTATION",
          node: media(1, "Manga Adaptation", "ANIME"),
        }, ...(id === 4 ? [] : [{
          relationType: "ADAPTATION",
          node: media(3, "Other Anime", "ANIME"),
        }])],
  },
  recommendations: { nodes: [] },
});

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === "/__test/fail-anilist") {
    failAniList = true;
    return send(response, 200, { ok: true });
  }
  if (url.pathname === "/__test/reset-anilist") {
    failAniList = false;
    return send(response, 200, { ok: true });
  }
  if (url.pathname === "/anilist" && request.method === "POST") {
    if (failAniList)
      return send(response, 500, {
        errors: [{ message: "forced AniList failure" }],
      });
    let body = "";
    for await (const chunk of request) body += chunk;
    if (body.includes("Media(id:")) {
      const variables = JSON.parse(body).variables ?? {};
      return send(response, 200, { data: { Media: detail(body.includes("type:MANGA") ? "MANGA" : "ANIME", Number(variables.id) || 1) } });
    }
    if (body.includes("GenreCollection"))
      return send(response, 200, {
        data: { GenreCollection: ["Action", "Comedy"] },
      });
    if (body.includes("trending:"))
      return send(response, 200, {
        data: {
          trending: { media: [media(1, "Test Anime")] },
          season: { media: [media(2, "Seasonal Anime")] },
          allTime: { media: [] },
          topRated: { media: [] },
          upcoming: { media: [] },
        },
      });
    if (body.includes("batch0: Page("))
      return send(response, 200, {
        data: { batch0: { media: [media(1, "Test Anime")] } },
      });
    if (body.includes("airingSchedules("))
      return send(response, 200, {
        data: { Page: { pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, total: 1 }, airingSchedules: [] } },
      });
    if (body.includes("Page(") && body.includes("media("))
      return send(response, 200, {
        data: {
          Page: {
            pageInfo: {
              currentPage: 1,
              lastPage: 1,
              hasNextPage: false,
              total: 1,
            },
            media: [media(1, "Test Anime")],
          },
        },
      });
    return send(response, 200, {
      data: {
        trending: { media: [media(1, "Test Anime")] },
        season: { media: [media(2, "Seasonal Anime")] },
        allTime: { media: [] },
        topRated: { media: [] },
        upcoming: { media: [] },
      },
    });
  }
  if (url.pathname === "/api/v1/anime/sources")
    return send(response, 200, {
      sources: [
        { id: "test", name: "Test Source", base_url: "https://source.test" },
      ],
      count: 1,
    });
  if (url.pathname === "/api/v1/manga/sources")
    return send(response, 200, {
      sources: [
        { id: "test", name: "Test Manga Source", base_url: "https://source.test" },
      ],
      count: 1,
    });
  if (url.pathname === "/api/v1/manga/test/search")
    return send(response, 200, {
      items: [
        {
          id: "manga-1",
          title: "Test Manga",
          url: "https://source.test/manga-1",
          thumbnail: "",
          description: "",
          genres: ["Action"],
          authors: [],
          artists: [],
          alternative_titles: [],
          status: "ongoing",
        },
      ],
      page: 1,
      has_next: false,
      total_returned: 1,
    });
  if (url.pathname === "/api/v1/manga/test/chapters/manga-1")
    return send(response, 200, [
      {
        id: "chapter-1",
        title: "First chapter",
        url: "https://source.test/chapter-1",
        number: 1,
        volume: null,
        scanlator: "Test scanlator",
        language: "en",
        released_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "chapter-2",
        title: "Second chapter",
        url: "https://source.test/chapter-2",
        number: 2,
        volume: null,
        scanlator: "Test scanlator",
        language: "en",
        released_at: "2026-01-02T00:00:00Z",
      },
    ]);
  if (url.pathname.startsWith("/api/v1/manga/test/pages/"))
    return send(response, 200, MANGA_PAGE_URLS.map((pageUrl, index) => ({ index, url: pageUrl, page_url: "" })));
  if (url.pathname.includes("/search"))
    return send(response, 200, {
      items: [
        {
          id: "anime-1",
          title: "Test Anime",
          url: "",
          thumbnail: "",
          description: "",
          genres: [],
          studios: [],
          producers: [],
          alternative_titles: [],
          status: "unknown",
          score: null,
          tags: [],
        },
      ],
      page: 1,
      has_next: false,
      total_returned: 1,
    });
  if (url.pathname.includes("/episodes/"))
    return send(response, 200, [
      {
        id: EPISODE_ID,
        number: 1,
        title: "Pilot",
        is_filler: false,
        has_sub: true,
        has_dub: false,
      },
    ]);
  if (url.pathname.includes("/servers/"))
    return send(response, 200, [
      { id: "server-1", name: "Test server", type: "SUB" },
      { id: "server-empty", name: "Empty server", type: "SUB" },
    ]);
  if (url.pathname.includes("/streams/")) {
    // "server-empty" models a server that resolves to no playable streams —
    // the stage must not show the neutral "choose" placeholder for it.
    if (url.searchParams.get("server_id") === "server-empty")
      return send(response, 200, []);
    return send(response, 200, [
      {
        url: STREAM_URL,
        quality: "1080p",
        headers: {},
        subtitles: [{ url: SUBTITLE_URL, label: "English", language: "en" }],
        is_hls: false,
      },
      {
        url: STREAM_URL,
        quality: "720p",
        headers: {},
        subtitles: [{ url: SUBTITLE_URL, label: "English", language: "en" }],
        is_hls: false,
      },
    ]);
  }
  if (url.pathname === "/api/v1/proxy/hls/mock-subtitle") {
    response.writeHead(200, {
      "content-type": "text/vtt",
      "cache-control": "no-store",
    });
    return response.end(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTest subtitle\n",
    );
  }
  if (url.pathname === "/poster.jpg") {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    response.writeHead(200, { "content-type": "image/png" });
    return response.end(png);
  }
  if (url.pathname.startsWith("/api/v1/manga/page/mock-page-")) {
    response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400, immutable" });
    return response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" viewBox="0 0 720 1080"><rect width="720" height="1080" fill="#f2eee6"/><path d="M80 130h560M80 190h420M80 900h560" stroke="#151515" stroke-width="8"/><circle cx="360" cy="520" r="150" fill="#c6b8a0"/><text x="360" y="540" text-anchor="middle" font-family="monospace" font-size="32">MANGA PAGE</text></svg>`);
  }
  if (url.pathname === "/api/v1/proxy/hls/mock-stream") {
    response.writeHead(200, { "content-type": "video/mp4", "cache-control": "public, max-age=3600, immutable" });
    return response.end(Buffer.alloc(1024));
  }
  send(response, 404, { detail: "Not found" });
}).listen(port, "127.0.0.1", () =>
  console.log(`Mock API listening on ${port}`),
);

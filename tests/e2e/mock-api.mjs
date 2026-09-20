import { createServer } from "node:http";

const port = Number(process.env.MOCK_API_PORT ?? 3101);

const HOST = "http://127.0.0.1:3101";
// Locally served stand-ins so no external asset is ever requested.
const POSTER_URL = `${HOST}/poster.jpg`;
const STREAM_URL = `${HOST}/stream.mp4`;
const SUBTITLE_URL = `${HOST}/subtitles.vtt`;
// AniSource episode IDs are opaque and routinely carry query-ish characters;
// the route and client must survive them end to end.
const EPISODE_ID = "episode-1&eps=1";
let failAniList = false;

const media = (id, title) => ({
  id,
  type: "ANIME",
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
  format: "TV",
  status: "RELEASING",
  episodes: 12,
  season: "FALL",
  seasonYear: 2026,
  genres: ["Action"],
  nextAiringEpisode: { episode: 1, airingAt: 0, timeUntilAiring: 0 },
});

const detail = () => ({
  ...media(1, "Test Anime"),
  description: "A test description.",
  duration: 24,
  startDate: null,
  endDate: null,
  source: null,
  synonyms: [],
  studios: { nodes: [] },
  trailer: null,
  externalLinks: [],
  characters: { edges: [] },
  relations: { edges: [] },
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
    if (body.includes("Media(id:"))
      return send(response, 200, { data: { Media: detail() } });
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
  if (url.pathname === "/subtitles.vtt") {
    response.writeHead(200, {
      "content-type": "text/vtt",
      "access-control-allow-origin": "*",
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
  if (url.pathname === "/stream.mp4") {
    response.writeHead(200, { "content-type": "video/mp4" });
    return response.end(Buffer.alloc(1024));
  }
  send(response, 404, { detail: "Not found" });
}).listen(port, "127.0.0.1", () =>
  console.log(`Mock API listening on ${port}`),
);

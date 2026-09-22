import { expect, test } from "@playwright/test";

test("header search stays client-side and renders matching Explore results", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as typeof window & { __searchDocument?: symbol }).__searchDocument = Symbol("search-document");
  });

  const search = page.getByRole("combobox", { name: "Search anime" });
  await expect(search).toBeVisible();
  await search.click();
  await search.pressSequentially("Test Anime", { delay: 25 });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Test Anime");
  await expect(page.getByRole("option", { name: /Test Anime/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/explore\?.*query=Test(?:\+|%20)Anime/);
  await expect(page.getByRole("heading", { name: "Results for “Test Anime”" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Test Anime/ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    typeof (window as typeof window & { __searchDocument?: symbol }).__searchDocument === "symbol",
  )).toBe(true);
});

test("explore cards keep the detail-only destination", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "Explore anime" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Country of origin" })).toBeVisible();

  const detail = page.getByRole("link", { name: /Test Anime/ }).first();
  await expect(detail).toHaveAttribute("href", "/anime/1");
  await expect(page.getByRole("link", { name: "Watch now" })).not.toBeVisible();
});

test("manga home keeps a loading surface during a mobile catalog switch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:3101/anilist", async (route) => {
    if ((route.request().postData() ?? "").includes("type:MANGA")) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "ANIME", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "MANGA", exact: true }).click();
  await expect(page.getByText("Loading manga discovery…", { exact: true })).toBeVisible({ timeout: 500 });
  await expect(page.getByRole("heading", { name: "Trending Manga" })).toBeVisible();
});

test("anime and manga home states keep matching discovery actions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "View all anime →", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View all →", exact: true })).toHaveCount(4);

  await page.getByRole("button", { name: "MANGA", exact: true }).click();
  await expect(page.getByRole("link", { name: "View all manga →", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View all →", exact: true })).toHaveCount(4);
});

test("manga detail uses its publication layout and shelf controls", async ({ page }) => {
  await page.goto("/manga/1");
  await expect(page.getByRole("heading", { name: "Manga Details" })).toBeVisible();
  await expect(page.getByText("Genres", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Manga" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add manga to favorites" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Back to manga" })).toHaveAttribute("href", "/");
  await expect(page.getByText("Test Anime", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Add manga to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove manga from favorites" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reading status" })).toBeVisible();
  await expect(page.locator("select option").first()).toHaveText("Reading");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Manga Details" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("manga detail opens the reader through the full chapter flow", async ({ page }) => {
  await page.goto("/manga/1");
  await page.getByRole("link", { name: "Open reader →" }).click();
  await expect(page).toHaveURL(/\/manga\/1\/read\/1(?:\?|$)/);
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chapters" })).toBeVisible();
  await page.getByRole("button", { name: "Chapters" }).click();
  await expect(page.getByRole("dialog", { name: "Chapters" })).toBeVisible();
  const secondChapter = page.locator("button.manga-reader-chapter").filter({ hasText: "Second chapter" });
  await expect(secondChapter).toBeVisible();
  await secondChapter.click();
  await expect(page).toHaveURL(/\/manga\/1\/read\/2(?:\?|$)/);
  await expect(page.getByText("Second chapter · Test Manga Source", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("legacy zero reader routes resolve to the first numbered chapter", async ({ page }) => {
  await page.goto("/manga/1/read/0?source=test");
  await expect(page).toHaveURL(/\/manga\/1\/read\/1(?:\?|$)/);
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
  await expect(page.getByText("Chapter 1", { exact: true }).first()).toBeVisible();
});

test("continuous reader keeps both progress controls aligned with scrolling", async ({ page }) => {
  await page.goto("/manga/1/read/start?source=test");
  const scroll = page.locator(".manga-reader-scroll");
  const scrubber = page.getByRole("slider", { name: "Page scrubber" });

  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
  await expect(scrubber).toHaveValue("0");

  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(scrubber).toHaveValue("1");
  await expect(page.locator(".manga-reader-page-label")).toHaveText("Page 2 / 2");
  await expect(page.locator(".manga-reader-hairline i")).toHaveAttribute("style", /width: 100%/);
});

test("manga reader restores settings after an immediate reload", async ({ page }) => {
  await page.goto("/manga/1/read/1?source=test");
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Reader settings" });
  await settings.getByRole("button", { name: "Paged", exact: true }).click();
  await settings.getByRole("button", { name: "Left to right", exact: true }).click();
  await settings.getByRole("button", { name: "Original", exact: true }).click();
  await settings.getByRole("button", { name: "Paper", exact: true }).click();
  await settings.getByRole("button", { name: "Roomy", exact: true }).click();

  await page.reload();
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const restored = page.getByRole("dialog", { name: "Reader settings" });
  for (const label of ["Paged", "Left to right", "Original", "Paper", "Roomy"]) {
    await expect(restored.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
});

test("Explore stays active for filtered Explore routes", async ({ page }) => {
  await page.goto("/explore?sort=POPULARITY_DESC&page=1");
  await expect(page.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");

  await page.goto("/explore?sort=UPDATED_AT_DESC&page=1");
  await expect(page.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");
});

test("home to detail to watch resolves a stream and mounts the player", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Test Anime" }).first().click();
  await expect(page.locator("article").getByRole("heading", { name: "Test Anime" })).toBeVisible();
  await page.getByRole("link", { name: /Watch now/i }).click();
  await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();
  await page.getByRole("button", { name: "Episode 1: Pilot" }).click();
  await page.getByRole("button", { name: "Test server" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose a server" }),
  ).toBeVisible();
  await expect(page.getByLabel("Quality")).toBeVisible();
  await expect(page.getByLabel("Subtitles")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

test("search to detail to watch mounts the player", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search anime" });
  await search.fill("Test Anime");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/explore\?.*query=Test(?:\+|%20)Anime/);
  await page.getByRole("link", { name: "Test Anime" }).first().click();
  await page.getByRole("link", { name: /Watch now/i }).click();
  await page.getByRole("button", { name: "Episode 1: Pilot" }).click();
  await page.getByRole("button", { name: "Test server" }).click();
  await expect(page.locator("video")).toBeVisible();
});

test("shows a specific empty-stream state for a selected server", async ({
  page,
}) => {
  await page.goto("/anime/1/watch/next");
  await page.getByRole("button", { name: "Episode 1: Pilot" }).click();
  await page.getByRole("button", { name: "Empty server" }).click();
  await expect(
    page.getByRole("heading", {
      name: "No playable streams from Empty server",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose an episode and server" }),
  ).not.toBeVisible();
});

test("favorite persists after reload and allows changing library status", async ({ page }) => {
  await page.goto("/anime/1");
  const addFavorite = page.getByRole("button", { name: "Add to favorites" });
  const removeFavorite = page.getByRole("button", { name: "Remove from favorites" });
  const statusSelect = page.getByRole("combobox", { name: "Library status" });
  await expect(addFavorite.or(removeFavorite)).toBeVisible();

  // Leave the browser context in a known state so this test remains valid when
  // a developer reruns it against a context that already has this favorite.
  if (await removeFavorite.isVisible()) {
    await removeFavorite.click();
    await expect(addFavorite).toBeVisible();
  }

  await expect(statusSelect).not.toBeVisible();
  await addFavorite.click();
  await expect(removeFavorite).toBeVisible();
  await expect(statusSelect).toBeVisible();
  await expect(statusSelect).toHaveValue("PLANNING");

  await statusSelect.selectOption("WATCHING");
  await expect(statusSelect).toHaveValue("WATCHING");

  await page.reload();
  await expect(removeFavorite).toBeVisible();
  await expect(statusSelect).toBeVisible();
  await expect(statusSelect).toHaveValue("WATCHING");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/detail-library-status-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(statusSelect).toHaveValue("WATCHING");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/detail-library-status-mobile.png", fullPage: true });

  await removeFavorite.click();
  await expect(addFavorite).toBeVisible();
  await expect(statusSelect).not.toBeVisible();
});

test("library hydrates saved metadata and resumes its opaque episode", async ({ page }) => {
  await page.goto("/anime/1");
  const addFavorite = page.getByRole("button", { name: "Add to favorites" });
  const removeFavorite = page.getByRole("button", { name: "Remove from favorites" });
  await expect(addFavorite.or(removeFavorite)).toBeVisible();
  if (await addFavorite.isVisible()) {
    await addFavorite.click();
    await expect(removeFavorite).toBeVisible();
  }

  await page.goto("/anime/1/watch/next");
  await page.getByRole("button", { name: "Episode 1: Pilot" }).click();
  await page.getByRole("button", { name: "Test server" }).click();
  await expect(page.locator("video")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Your anime library.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Test Anime", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Continue Watching/ }).click();
  const resume = page.getByRole("link", { name: "Resume" });
  await expect(resume).toHaveAttribute("href", /episode-1%26eps%3D1/);
  await resume.click();
  await expect(page).toHaveURL(/episode-1%26eps%3D1/);
});

test("library stays within desktop and mobile viewports", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Your anime library.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/library-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your anime library.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/library-mobile.png", fullPage: true });
});

test("schedule switches views and stays within desktop and mobile viewports", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "What’s airing." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("combobox", { name: "Genre" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Saved only" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/schedule-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/view=day/);
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(page.getByRole("heading", { name: "No releases found." })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Genre" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/schedule-mobile.png", fullPage: true });
});

test("discovery initial load does not call AniSource", async ({ page }) => {
  const anisourceRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/")) anisourceRequests.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("banner", { name: "Site header" })).toBeVisible();
  expect(anisourceRequests).toEqual([]);
});

test("home shows one recovery state when AniList fails during SSR", async ({
  page,
  request,
}) => {
  await request.get("http://127.0.0.1:3101/__test/fail-anilist");

  try {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Couldn't reach AniList" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Something went wrong!", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Hydration Mismatch", { exact: false })).toHaveCount(0);
  } finally {
    await request.get("http://127.0.0.1:3101/__test/reset-anilist");
  }
});

test("a named local viewer is not described as anonymous", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("textbox", { name: "Display name" }).fill("Mina");
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page.getByRole("heading", { name: "Mina" })).toBeVisible();
  await expect(page.getByRole("complementary").getByText("Local profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Anonymous local viewer", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/profile-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mina" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/profile-mobile.png", fullPage: true });
});

test("settings stays usable across desktop and mobile layouts", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Viewer settings." })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Timezone" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /adult-content/i })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Release notifications/i })).toBeVisible();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toContainText("Preferences saved on this device.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/settings-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Viewer settings." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/settings-mobile.png", fullPage: true });
});

test("continue watching opens its saved opaque episode URL", async ({
  page,
}) => {
  await page.goto("/anime/1/watch/next");
  await page.getByRole("button", { name: "Episode 1: Pilot" }).click();
  await page.getByRole("button", { name: "Test server" }).click();
  await expect(page).toHaveURL(/\/anime\/1\/watch\/episode-1(?:\?|$)/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();
});

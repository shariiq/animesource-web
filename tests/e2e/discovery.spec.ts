import { expect, test, type Page } from "@playwright/test";

function observeAniSourceBoundary(page: Page) {
  const browserRequests = { gateway: 0, direct: [] as string[] };
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/anisource/")) browserRequests.gateway += 1;
    if (url.origin === "http://127.0.0.1:3101" && url.pathname.startsWith("/api/v1/")) {
      browserRequests.direct.push(request.url());
    }
  });
  return browserRequests;
}

test("header search stays client-side and renders matching Explore results", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as typeof window & { __searchDocument?: symbol }).__searchDocument = Symbol("search-document");
  });

  const search = page.getByRole("combobox", { name: "Search anime" });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("aria-controls", "global-search-suggestions");
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

test("mobile header keeps search usable beside catalog switching", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search anime" });
  await expect(search).toBeVisible();
  expect((await page.locator(".search-surface-control").boundingBox())?.width).toBeGreaterThan(250);
  await search.click();
  await search.pressSequentially("Test Anime", { delay: 25 });
  await expect(page.getByRole("option", { name: /Test Anime/ })).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "Results for “Test Anime”" })).toBeVisible();
});

test("phone navigation keeps every destination tappable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const tabs = navigation.getByRole("link");
  await expect(tabs).toHaveCount(5);
  for (const tab of await tabs.all()) {
    expect((await tab.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  }
  await navigation.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: "Your profile.", exact: true })).toBeVisible();
});

test("mobile header clears discovery headings while scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Featured Anime" });
  await expect(heading).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 100);
  });
  const header = await page.getByRole("banner", { name: "Site header" }).boundingBox();
  const section = await heading.boundingBox();
  expect(header && section && header.y + header.height <= section.y).toBe(true);
});

test("Home stays within the viewport from phone through desktop widths", async ({ page }) => {
  for (const width of [390, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Featured Anime" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("Watch fits the viewport before a server is chosen on narrow screens", async ({ page }) => {
  for (const width of [320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/anime/1/watch/next");
    await expect(page.getByRole("combobox", { name: "Streaming source" })).toBeVisible();
    await expect(page.locator(".mobile-tabbar")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("tablet navigation stays in the header instead of covering content", async ({ page }) => {
  for (const width of [600, 768, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/explore");
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.locator(".mobile-tabbar")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("mobile detail pages show the anime or manga identity before the cover", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const { route, title } of [{ route: "/anime/1", title: "Test Anime" }, { route: "/manga/1", title: "Test Manga" }]) {
    await page.goto(route);
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    expect((await heading.boundingBox())?.y).toBeLessThan(844);
  }
});

test("detail pages keep a two-column tablet composition", async ({ page }) => {
  for (const width of [768, 900]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/anime/1", "/manga/1"]) {
      await page.goto(route);
      const columns = await page.locator(route.startsWith("/anime") ? ".anime-detail-grid" : ".manga-detail-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(2);
    }
  }
});

test("detail pages preserve the exact source and adaptation pair across mode changes", async ({ page }) => {
  await page.goto("/anime/1");
  await expect(page.getByRole("heading", { name: "Test Anime" })).toBeVisible();

  await page.getByRole("button", { name: "MANGA", exact: true }).click();

  await expect(page).toHaveURL(/\/manga\/2(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Manga Details" })).toBeVisible();

  await page.getByRole("button", { name: "ANIME", exact: true }).click();

  await expect(page).toHaveURL(/\/anime\/1(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Anime Details" })).toBeVisible();
});

test("a direct detail route aligns the catalog mode before following a unique relation", async ({ page }) => {
  await page.goto("/manga/4");
  await expect(page.getByRole("button", { name: "MANGA", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "ANIME", exact: true }).click();

  await expect(page).toHaveURL(/\/anime\/1(?:\?|$)/);
  await expect(page.getByRole("button", { name: "ANIME", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Anime Details" })).toBeVisible();
});

test("manga detail opens the reader through the full chapter flow", async ({ page }) => {
  const browserRequests = observeAniSourceBoundary(page);
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
  expect(browserRequests.gateway).toBeGreaterThan(0);
  expect(browserRequests.direct).toEqual([]);
});

test("legacy zero reader routes resolve to the first numbered chapter", async ({ page }) => {
  await page.goto("/manga/1/read/0?source=test");
  await expect(page).toHaveURL(/\/manga\/1\/read\/1(?:\?|$)/);
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
  await expect(page.getByText("Chapter 1", { exact: true }).first()).toBeVisible();
});

test("document policy exposes no API origin in ticketed mode", async ({ page }) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("http://127.0.0.1:3101");
  // Default ticketed mode exposes no API origin to the browser.
  expect(policy).not.toContain("anisource");
});
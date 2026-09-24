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

test.describe("high-density mobile Reader", () => {
  test.use({ viewport: { width: 391, height: 844 }, deviceScaleFactor: 3, isMobile: true });

  test("gap none joins short loaded webtoon slices without exposing their frames", async ({ page }) => {
    await page.route("**/api/anisource/**", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/pages/chapter-1")) {
        await route.fulfill({ json: Array.from({ length: 12 }, (_, index) => ({
          index, url: "/api/anisource/short-reader-page.svg", page_url: "",
        })) });
      } else if (pathname.endsWith("/short-reader-page.svg")) {
        await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180"><rect width="720" height="180" fill="white"/></svg>' });
      } else {
        await route.continue();
      }
    });

    await page.goto("/manga/1/read/start?source=test");
    await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
    await page.locator('button[aria-controls="manga-reader-settings-sheet"]').click();
    const settings = page.getByRole("dialog", { name: "Reader settings" });
    await settings.getByRole("button", { name: "None", exact: true }).click();
    await settings.getByRole("button", { name: "Close settings" }).click();

    const scroll = page.locator(".manga-reader-scroll");
    await scroll.locator('[data-page-index="7"]').scrollIntoViewIfNeeded();
    await expect.poll(() => scroll.evaluate((element) => [7, 8].map((index) => {
      const frame = element.querySelector<HTMLElement>(`[data-page-index="${index}"]`);
      const image = frame?.querySelector<HTMLImageElement>("img");
      return Boolean(frame?.classList.contains("is-loaded") && image?.complete && image.naturalWidth);
    }))).toEqual([true, true]);

    const edges = await scroll.evaluate((element) => {
      const measure = (index: number) => {
        const frame = element.querySelector<HTMLElement>(`[data-page-index="${index}"]`);
        const image = frame?.querySelector<HTMLImageElement>("img");
        if (!frame || !image) throw new Error("Expected adjacent loaded pages");
        return { frame: frame.getBoundingClientRect().toJSON(), image: image.getBoundingClientRect().toJSON() };
      };
      return { previous: measure(7), next: measure(8) };
    });
    expect(edges.previous.frame.bottom - edges.previous.image.bottom).toBeLessThanOrEqual(1);
    expect(edges.next.image.top - edges.next.frame.top).toBeLessThanOrEqual(1);
    expect(edges.next.image.top).toBeLessThanOrEqual(edges.previous.image.bottom);
  });

  test("gap none leaves no raster seam between pages in a long chapter", async ({ page }) => {
    await page.route("**/api/anisource/**", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/pages/chapter-1")) {
        await route.fulfill({
          json: Array.from({ length: 12 }, (_, index) => ({
            index,
            url: "/api/anisource/test-reader-page.svg",
            page_url: "",
          })),
        });
      } else if (pathname.endsWith("/test-reader-page.svg")) {
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080"><rect width="720" height="1080" fill="#345"/></svg>',
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/manga/1/read/start?source=test");
    await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
    await page.locator('button[aria-controls="manga-reader-settings-sheet"]').click();
    const settings = page.getByRole("dialog", { name: "Reader settings" });
    await settings.getByRole("button", { name: "None", exact: true }).click();
    await expect(page.locator(".manga-reader-shell")).toHaveAttribute("data-gap", "none");
    const placeholderHeights = await page.locator(".manga-reader-frame").evaluateAll((frames) =>
      frames.filter((frame) => !frame.querySelector("img")).map((frame) => frame.getBoundingClientRect().height),
    );
    expect(placeholderHeights.length).toBeGreaterThan(0);
    expect(Math.max(...placeholderHeights)).toBeLessThanOrEqual(302);
    await settings.getByRole("button", { name: "Close settings" }).click();

    const scroll = page.locator(".manga-reader-scroll");
    await scroll.locator('[data-page-index="7"]').scrollIntoViewIfNeeded();
    await expect(page.getByRole("img", { name: "Test Manga, page 9" })).toBeVisible();
    await expect.poll(() => scroll.evaluate((element) => [7, 8].map((index) => {
      const image = element.querySelector<HTMLElement>(`[data-page-index="${index}"] img`);
      return image ? getComputedStyle(image).opacity : null;
    }))).toEqual(["1", "1"]);
    await scroll.evaluate((element) => {
      const previous = element.querySelector<HTMLElement>('[data-page-index="7"] img');
      const next = element.querySelector<HTMLElement>('[data-page-index="8"] img');
      if (!previous || !next) throw new Error("Expected both adjacent page images");
      const seam = (previous.getBoundingClientRect().bottom + next.getBoundingClientRect().top) / 2;
      element.scrollTop += seam - (element.getBoundingClientRect().top + element.clientHeight / 2);
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const seam = await scroll.evaluate((element) => {
      const previous = element.querySelector<HTMLElement>('[data-page-index="7"] img');
      const next = element.querySelector<HTMLElement>('[data-page-index="8"] img');
      if (!previous || !next) throw new Error("Expected both adjacent page images");
      const previousImage = previous.getBoundingClientRect();
      const nextImage = next.getBoundingClientRect();
      return {
        y: (previousImage.bottom + nextImage.top) / 2,
        previousImage: previousImage.toJSON(),
        nextImage: nextImage.toJSON(),
      };
    });
    const seamY = seam.y;
    const pixelScale = await page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      x: Math.floor(window.innerWidth * window.devicePixelRatio / 2),
    }));
    const screenshot = await page.screenshot({ animations: "disabled" });
    const seamPixels = await page.evaluate(async ({ image, x, y }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image), (value) => value.charCodeAt(0))], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not inspect the rendered page seam");
      context.drawImage(bitmap, 0, 0);
      return [-2, -1, 0, 1, 2].map((offset) => [...context.getImageData(x, y + offset, 1, 1).data]);
    }, { image: screenshot.toString("base64"), x: pixelScale.x, y: Math.floor(seamY * pixelScale.dpr) });
    expect(seam.nextImage.top).toBeLessThanOrEqual(seam.previousImage.bottom - 2);
    // A raster seam would expose the near-black reader canvas between these solid pages.
    for (const pixel of seamPixels) {
      expect(pixel[0]).toBeGreaterThanOrEqual(47);
      expect(pixel[1]).toBeGreaterThanOrEqual(64);
      expect(pixel[2]).toBeGreaterThanOrEqual(81);
      expect(pixel[3]).toBe(255);
    }
  });
});

test("manga reader restores settings after autosave completes and the page reloads", async ({ page }) => {
  await page.goto("/manga/1/read/1?source=test");
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Reader settings" });
  await settings.getByRole("button", { name: "Paged", exact: true }).click();
  await settings.getByRole("button", { name: "Left to right", exact: true }).click();
  await settings.getByRole("button", { name: "Original", exact: true }).click();
  await settings.getByRole("button", { name: "Paper", exact: true }).click();
  await settings.getByRole("button", { name: "Roomy", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("Reader settings saved on this device.");

  await page.reload();
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const restored = page.getByRole("dialog", { name: "Reader settings" });
  for (const label of ["Paged", "Left to right", "Original", "Paper", "Roomy"]) {
    await expect(restored.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
});

test("manga library exposes saved reader progress", async ({ page }) => {
  await page.goto("/manga/1/read/1?source=test");
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();

  await page.goto("/manga/1");
  await expect(page.getByRole("heading", { name: "Manga Details" })).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Your manga library.", exact: true })).toBeVisible();
  const continueReading = page.getByRole("tab", { name: /Continue Reading/ });
  await expect(continueReading).toBeVisible();
  await continueReading.click();
  await expect(page.getByRole("heading", { name: "Continue reading", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Resume" }).click();
  await expect(page).toHaveURL(/\/manga\/1\/read\/id%3Achapter-1(?:\?|$)/i);
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();
});

test("reading progress follows the last-read chapter after a quick chapter switch", async ({ page }) => {
  await page.goto("/manga/1/read/1?source=test");
  await expect(page.getByRole("img", { name: "Test Manga, page 1" })).toBeVisible();

  // Read to the end of chapter 1, then immediately advance: the debounced
  // chapter-1 progress write must not overwrite the chapter-2 record.
  await page.locator(".manga-reader-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.locator(".manga-reader-page-label")).toHaveText("Page 2 / 2");
  await page.keyboard.press("]");
  await expect(page).toHaveURL(/\/manga\/1\/read\/2/);
  await expect(page.locator(".manga-reader-page-label")).toHaveText("Page 1 / 2");

  // The navigations below take longer than the progress debounce, so a stale
  // chapter-1 write would have landed by the time the library is read.
  await page.goto("/manga/1");
  await expect(page.getByRole("heading", { name: "Manga Details" })).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Your manga library.", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Continue Reading/ }).click();
  await expect(page.getByRole("heading", { name: "Continue reading", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Resume" }).click();
  await expect(page).toHaveURL(/\/manga\/1\/read\/id%3Achapter-2(?:\?|$)/i);
  await expect(page.locator(".manga-reader-page-label")).toHaveText("Page 1 / 2");
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
  const browserRequests = observeAniSourceBoundary(page);
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
  expect(browserRequests.gateway).toBeGreaterThan(0);
  expect(browserRequests.direct).toEqual([]);
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
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:3101" && url.pathname.startsWith("/api/v1/")) {
      anisourceRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("banner", { name: "Site header" })).toBeVisible();
  expect(anisourceRequests).toEqual([]);
});

test("document carries the connect-src policy as a response header", async ({ page }) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("http://127.0.0.1:3101");
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
  const readerLayout = page.getByRole("combobox", { name: "Layout" });
  await expect(readerLayout).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /adult-content/i })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Release notifications/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save preferences" })).toBeEnabled();
  await readerLayout.selectOption("paged");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toContainText("Preferences saved on this device.");
  await page.reload();
  await expect(readerLayout).toHaveValue("paged");
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

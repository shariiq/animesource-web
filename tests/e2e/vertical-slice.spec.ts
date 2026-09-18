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

  const detail = page.getByRole("link", { name: /Test Anime/ }).first();
  await expect(detail).toHaveAttribute("href", "/anime/1");
  await expect(page.getByRole("link", { name: "Watch now" })).not.toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Your library.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Test Anime", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Continue Watching/ }).click();
  const resume = page.getByRole("link", { name: "Resume" });
  await expect(resume).toHaveAttribute("href", /episode-1%26eps%3D1/);
  await resume.click();
  await expect(page).toHaveURL(/episode-1%26eps%3D1/);
});

test("library stays within desktop and mobile viewports", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Your library.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/library-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your library.", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "A quiet stretch." })).toBeVisible();

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

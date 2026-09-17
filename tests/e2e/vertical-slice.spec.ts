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
  await expect(page.getByRole("option", { name: /Test Anime/ })).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/explore\?.*query=Test(?:\+|%20)Anime/);
  await expect(page.getByRole("heading", { name: "Results for “Test Anime”" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Test Anime/ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    typeof (window as typeof window & { __searchDocument?: symbol }).__searchDocument === "symbol",
  )).toBe(true);
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

test("favorite persists after reload", async ({ page }) => {
  await page.goto("/anime/1");
  const addFavorite = page.getByRole("button", { name: "Add to favorites" });
  const removeFavorite = page.getByRole("button", { name: "Remove from favorites" });
  await expect(addFavorite.or(removeFavorite)).toBeVisible();

  // Leave the browser context in a known state so this test remains valid when
  // a developer reruns it against a context that already has this favorite.
  if (await removeFavorite.isVisible()) {
    await removeFavorite.click();
    await expect(addFavorite).toBeVisible();
  }

  await addFavorite.click();
  await expect(removeFavorite).toBeVisible();
  await page.reload();
  await expect(removeFavorite).toBeVisible();
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

import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouteContext,
} from '@tanstack/solid-router'
import { HydrationScript } from 'solid-js/web'
import { Suspense, JSX } from 'solid-js'
import { QueryClientProvider, type QueryClient } from '@tanstack/solid-query'
import { Header } from '../components/layout/Header'
import { CatalogModeProvider } from '../components/layout/CatalogModeSwitch'
import { Footer } from '../components/layout/Footer'
import { MobileTabBar } from '../components/layout/MobileTabBar'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { RouteLoadingFallback } from '../components/ui/LoadingSkeleton'
import { API_URLS } from '../config/api'
import { REQUEST_NONCE_COOKIE, REQUEST_NONCE_TTL_SECONDS, issueRequestNonce } from '../lib/requestNonce'
import { serverSecret } from '../lib/serverSecret'
import '../styles/app.css'

const anilistOrigin = new URL(API_URLS.anilist).origin
const developmentConnectSources = import.meta.env.DEV
  ? ' http://127.0.0.1:3101 ws://127.0.0.1:3000 ws://localhost:3000'
  : ''

function documentConnectSources(): string {
  // Request-scoped and server-only: API origins come from runtime env during
  // SSR so the hosts never enter the client bundle (see verify:boundary).
  // Browsers ignore CSP meta tags injected after the initial document, so the
  // policy ships as a response header instead of a static meta tag.
  const env = typeof process === 'undefined' ? undefined : process.env
  const direct = env?.ANISOURCE_DIRECT_MEDIA === '1'
  const apiOrigins = !direct ? [] : [env?.ANISOURCE_BASE, env?.ANISOURCE_FALLBACK_BASE]
    .map((value) => {
      try { return value ? new URL(value).origin : null } catch { return null }
    })
    .filter((origin): origin is string => origin !== null)
  return `${anilistOrigin}${developmentConnectSources}${apiOrigins.length > 0 ? ` ${apiOrigins.join(' ')}` : ''}`
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'AniSource — Discover & Watch Anime' },
      { name: 'description', content: 'Browse trending, seasonal and top-rated anime with rich AniList metadata, then watch instantly through live-resolved streams.' },
      { name: 'theme-color', content: '#f8f8fb' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'AniSource — Discover & Watch Anime' },
      { property: 'og:description', content: 'Browse trending, seasonal and top-rated anime with rich AniList metadata, then watch instantly through live-resolved streams.' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700;800&display=swap',
      },
    ],
  }),
  component: RootLayout,
  errorComponent: RootError,
  shellComponent: RootDocument,
  headers: () => {
    const headers: Record<string, string> = {
      'Content-Security-Policy': `connect-src 'self' ${documentConnectSources()}`,
    }
    // Proof-of-visit for the AniSource gateway: a short-lived HMAC cookie
    // the browser client echoes on catalog requests. serverSecret() shares
    // the gateway's key (including its development fallback) and returns
    // null outside a server runtime, so no cookie is ever minted the gateway
    // could not verify — and the secret itself never leaves configuration.
    const secret = serverSecret()
    if (secret) {
      const secure = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production' ? '; Secure' : ''
      headers['Set-Cookie'] =
        `${REQUEST_NONCE_COOKIE}=${issueRequestNonce(secret, Math.floor(Date.now() / 1000))}; Path=/; SameSite=Lax; Max-Age=${REQUEST_NONCE_TTL_SECONDS}${secure}`
    }
    return headers
  },
})

function RootLayout() {
  const context = useRouteContext({ from: '__root__' })
  const queryClient = context().queryClient
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogModeProvider>
        <div class="relative z-10 flex min-h-screen flex-col">
          <Header />
          <main id="main" class="flex-1">
            <ErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback kicker="Discovery" title="Loading discovery…" />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
          <Footer />
          <MobileTabBar />
        </div>
      </CatalogModeProvider>
    </QueryClientProvider>
  )
}

function RootError() {
  return <p>Something went wrong rendering this page.</p>
}


function RootDocument(props: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
      </head>
      <body>
        <div class="app-background" aria-hidden="true">
          <div class="atmospheric-ink" />
          <div class="atmospheric-depth" />
          <div class="atmospheric-light" />
        </div>
        <div class="paper-grid" aria-hidden="true" />
        <div class="dot-grid" aria-hidden="true" />
        <div class="film-grain" aria-hidden="true" />
        <HeadContent />
        {props.children}
        <Scripts />
      </body>
    </html>
  )
}

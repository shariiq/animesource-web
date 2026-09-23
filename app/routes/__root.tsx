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
import { API_URLS } from '../config/api'
import '../styles/app.css'

const anilistOrigin = new URL(API_URLS.anilist).origin
const developmentConnectSources = import.meta.env.DEV
  ? ' http://127.0.0.1:3101 ws://127.0.0.1:3000 ws://localhost:3000'
  : ''

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'AniSource — Discover & Watch Anime' },
      { name: 'description', content: 'Browse trending, seasonal and top-rated anime with rich AniList metadata, then watch instantly through live-resolved streams.' },
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
              <Suspense fallback={<section class="editorial-page grid min-h-[60vh] place-items-center" aria-busy="true"><p class="mono-signal">Loading discovery…</p></section>}>
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
        <meta http-equiv="content-security-policy" content={`connect-src 'self' ${anilistOrigin}${developmentConnectSources}`} />
        <HydrationScript />
      </head>
      <body>
        <div class="app-background" aria-hidden="true">
          <div class="atmospheric-ink" />
          <div class="atmospheric-depth" />
          <div class="atmospheric-bloom" />
          <div class="atmospheric-violet" />
          <div class="atmospheric-mint" />
          <div class="atmospheric-orange" />
          <div class="atmospheric-light" />
        </div>
        <div class="dot-grid" aria-hidden="true" />
        <div class="film-grain" aria-hidden="true" />
        <HeadContent />
        {props.children}
        <Scripts />
      </body>
    </html>
  )
}

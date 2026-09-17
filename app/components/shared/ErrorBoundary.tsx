import { ErrorBoundary as SolidErrorBoundary, JSX } from 'solid-js'

export function ErrorBoundary(props: { children: JSX.Element }) {
  return (
    <SolidErrorBoundary
      fallback={(error, reset) => (
        <section aria-live="assertive">
          <h1>Something went wrong</h1>
          <p>{error instanceof Error ? error.message : 'Please try again.'}</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </section>
      )}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}
import type { JSX } from 'solid-js'

export function PageShell(props: { children: JSX.Element; class?: string }) {
  return <div class={`editorial-page ${props.class ?? ''}`}>{props.children}</div>
}

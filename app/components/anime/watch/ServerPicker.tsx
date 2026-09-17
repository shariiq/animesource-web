import { For, Show } from 'solid-js'
import type { Server } from '../../../data/anisource/schema'

export function ServerPicker(props: { servers: Server[]; currentServerId: string | null; onServerChange: (serverId: string) => void; loading: boolean }) {
  const grouped = () => {
    const groups = new Map<string, Server[]>()
    for (const server of props.servers) groups.set(server.type, [...(groups.get(server.type) ?? []), server])
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  }
  return <section class="mt-5 rounded-panel border border-white/75 bg-white/62 p-5 shadow-[0_22px_50px_-28px_rgb(0_0_0/.38)] backdrop-blur-xl" aria-labelledby="server-heading">
    <div class="mb-4 border-b border-black/12 pb-3"><p class="font-mono text-[9px] uppercase tracking-[.16em] text-[#4f4e57]">Stream selection</p><h2 id="server-heading" class="mt-1 font-display text-3xl leading-none">Choose a server</h2></div>
    <Show when={props.servers.length > 0} fallback={<p class="py-5 font-mono text-[10px] uppercase tracking-[.1em] text-[#42404b]">{props.loading ? 'Finding servers for this episode…' : 'No servers available for this episode.'}</p>}>
      <div class="space-y-4"><For each={grouped()}>{([type, servers]) => <div><p class="mb-2 font-mono text-[9px] uppercase tracking-[.16em] text-[#4f4e57]">{type}</p><div class="flex flex-wrap gap-2"><For each={servers}>{(server) => <button type="button" class="rounded-[8px] border border-black/18 bg-white/78 px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[.08em] transition hover:border-black hover:bg-black hover:text-white" classList={{ 'border-black bg-black text-white': server.id === props.currentServerId }} onClick={() => props.onServerChange(server.id)} aria-pressed={server.id === props.currentServerId}>{server.name}</button>}</For></div></div>}</For></div>
    </Show>
  </section>
}

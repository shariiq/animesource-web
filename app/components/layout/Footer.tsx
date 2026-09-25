export function Footer() {
  return (
    <footer class="mx-auto mt-12 w-full max-w-[1500px] px-4 pb-6 sm:mt-24 sm:px-6 sm:pb-10 lg:px-10">
      <div class="frosted-shell flex flex-wrap items-center justify-between gap-4 rounded-[22px] px-6 py-5 font-mono text-[9px] uppercase tracking-[.12em] text-text-muted">
        <p class="flex items-center gap-[8px]">
          <span class="grid size-3.5 grid-cols-3 gap-[1.5px]" aria-hidden="true"><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-signal" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /></span>
          ANIMESOURCE · editorial catalog
        </p>
        <p>AniList metadata / streams resolved only on request.</p>
      </div>
    </footer>
  )
}
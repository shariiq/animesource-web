export function Footer() {
  return (
    <footer class="mx-auto mt-24 w-full max-w-[1500px] px-4 pb-10 sm:px-6 lg:px-10">
      <div class="frosted-shell flex flex-wrap items-center justify-between gap-4 rounded-[22px] px-6 py-5 font-mono text-[9px] uppercase tracking-[.12em] text-text-muted">
        <p class="flex items-center gap-[8px]">
          <span class="grid size-3.5 grid-cols-3 gap-[1.5px]" aria-hidden="true"><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-signal" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /><i class="rounded-full bg-black/70" /></span>
          ANIMESOURCE · editorial catalog
        </p>
        <p>AniList metadata / streams resolved only on request.</p>
        <p class="flex items-center gap-[7px]"><i class="inline-block size-[5px] rounded-full bg-violet shadow-[0_0_8px_rgb(106_90_249/.6)]" />Liquid glass system v2</p>
      </div>
    </footer>
  )
}
import { For, Show } from 'solid-js'
import type { DetailStaffMember } from './model'
import { formatEnum } from '../../../lib/format'

export function StaffRail(props: { members: DetailStaffMember[]; heading?: string; description?: string }) {
  return (
    <Show when={props.members.length > 0}>
      <section class="detail-section" aria-labelledby="staff-heading">
        <div class="detail-section-heading">
          <h2 id="staff-heading">{props.heading ?? 'Staff'}</h2>
          <p>{props.description ?? 'Key creative roles'}</p>
        </div>
        <div class="detail-identity-rail" role="list">
          <For each={props.members}>
            {(member) => {
              const identity = (
                <>
                  <Show when={member.image} fallback={<div class="detail-identity-placeholder" />}>
                    {(src) => <img src={src()} alt={`${member.name} portrait`} loading="lazy" />}
                  </Show>
                  <strong>{member.name}</strong>
                  <Show when={member.nativeName && member.nativeName !== member.name}>
                    <span>{member.nativeName}</span>
                  </Show>
                </>
              )
              const roles = member.roles.map(formatEnum).join(' · ') || member.occupations.map(formatEnum).join(' · ')
              return (
                <div class="detail-identity-card" role="listitem">
                  <Show when={member.siteUrl} fallback={identity} keyed>
                    {(href) => <a class="block" href={href} target="_blank" rel="noopener noreferrer">{identity}</a>}
                  </Show>
                  <Show when={roles}><small>{roles}</small></Show>
                </div>
              )
            }}
          </For>
        </div>
      </section>
    </Show>
  )
}

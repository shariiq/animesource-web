export function SectionHeading(props: { title: string; id?: string }) {
  return <header class="section-heading">
    <h2 id={props.id}>{props.title}</h2>
  </header>
}

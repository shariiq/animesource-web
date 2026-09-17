export function SectionHeading(props: { title: string; description?: string; id?: string }) {
  return <header class="section-heading">
    <h2 id={props.id}>{props.title}</h2>
    {props.description ? <p>{props.description}</p> : null}
  </header>
}

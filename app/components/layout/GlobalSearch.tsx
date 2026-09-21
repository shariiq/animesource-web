import { SearchSurface } from './SearchSurface'
import type { CatalogMode } from '../../lib/catalog'

/** Compact global search used in the site header. */
export function GlobalSearch(props: { mode?: CatalogMode } = {}) {
  return <SearchSurface mode={props.mode} />
}

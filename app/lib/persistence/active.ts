import { browserViewerData, type ViewerData } from './viewer'

/**
 * The route-facing viewer-data interface. Authentication can replace this
 * adapter with a local/remote synchronized implementation without changing
 * route or component ownership.
 */
export const viewerData: ViewerData = browserViewerData

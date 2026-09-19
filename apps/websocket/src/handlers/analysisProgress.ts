export interface AnalysisProgressHandler {
  /** Reroute analysis pipeline Redis events to Socket.IO rooms. */
  attach(): void;
}

export function attach(): void {
  // The core index.ts already subscribes to "analysis-progress" and
  // rebroadcasts to job:{jobId} rooms. Custom niche handlers can live here.
}
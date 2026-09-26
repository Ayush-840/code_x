/**
 * Plain-language translations for the analysis pipeline's stage names, shared
 * by every surface that shows live progress (dashboard repo cards, the repo
 * page banner, the public analyze loading screen). Workers speak in
 * CLONING/PARSING/…; users shouldn't have to.
 */
export function friendlyStage(stage: string): string {
  const copy: Record<string, string> = {
    QUEUED: "Getting in line…",
    CLONING: "Downloading the repository from GitHub…",
    PARSING: "Reading the code and mapping out modules…",
    CHUNKING: "Indexing the code so you can ask questions about it…",
    EMBEDDING: "Finishing the index…",
    GENERATING: "Writing your guides — architecture, module walkthroughs, questions…",
  };
  return copy[stage] ?? "Working through the codebase…";
}

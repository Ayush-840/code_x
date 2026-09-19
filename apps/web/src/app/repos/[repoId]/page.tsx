import { ClientRepoPage } from "./ClientRepoPage";

export default function RepoStudyGuidePage({
  params,
}: {
  params: { repoId: string };
}) {
  return <ClientRepoPage repoId={params.repoId} />;
}
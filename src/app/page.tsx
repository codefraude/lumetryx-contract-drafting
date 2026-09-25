import { Workspace } from "@/features/workspace/components/Workspace";
import { DOCX_LIMITS } from "@/server/docx/package";

export default function Page() {
  return (
    <Workspace maxUploadMb={DOCX_LIMITS.maxCompressedBytes / 1024 / 1024} />
  );
}

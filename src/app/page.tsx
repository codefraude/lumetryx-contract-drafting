import { Workspace } from "@/components/Workspace";
import { DOCX_LIMITS } from "@/lib/docx/package";

export default function Page() {
  return <Workspace maxUploadMb={DOCX_LIMITS.maxCompressedBytes / 1024 / 1024} />;
}

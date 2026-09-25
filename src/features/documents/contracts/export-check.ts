import { z } from "zod";

export const ExportCheck = z.object({
  outstanding: z.array(z.string()),
  unclear: z.array(z.string()),
  leftBlank: z.array(z.string()),
  placeholders: z.array(z.string()),
});

export type ExportCheck = z.infer<typeof ExportCheck>;

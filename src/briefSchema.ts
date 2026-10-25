import { z } from "zod";

export const briefSchema = z.object({
  brief: z.string().min(10),
  audience: z.string().min(2),
  channels: z.array(z.string().min(1)).min(1),
  brandVoice: z.string().optional(),
});

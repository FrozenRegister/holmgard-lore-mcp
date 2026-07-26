export const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  agentId: z.string().optional(),
  characterId: z.string().optional(),
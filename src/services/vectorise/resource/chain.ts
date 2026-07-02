import { dispatchInternalRoute } from '@/lib/internal-dispatch';

export function buildResourceEmbedChainPath(resourceId: string): string {
  return `/api/story/resource-vectorise?resourceId=${encodeURIComponent(resourceId)}&stage=embed&mode=chain`;
}

export function buildResourceChunkChainPath(resourceId: string): string {
  return `/api/story/resource-vectorise?resourceId=${encodeURIComponent(resourceId)}&stage=chunk&mode=chain`;
}

export async function chainResourceVectorise(
  origin: string,
  path: string
): Promise<void> {
  await dispatchInternalRoute(origin, path, { chain: true });
}

import { SealClient, SessionKey } from "@mysten/seal";
import { getSealServerIds } from "../config/sealConfig";

export function createSealClient(suiClient: any) {
  const serverIds = getSealServerIds();
  return new SealClient({
    suiClient: suiClient as any,
    serverConfigs: serverIds.map((id) => ({ objectId: id, weight: 1 })),
    verifyKeyServers: false,
  });
}

export async function createSessionKey(address: string, packageId: string, suiClient: any) {
  return SessionKey.create({
    address,
    packageId,
    ttlMin: 10,
    suiClient,
  });
}

export function visibilityMoveValue(visibility: "Public" | "Restricted") {
  return visibility === "Public" ? { Public: null } : { Restricted: null };
}

export function serializeVisibilityBytes(visibility: "Public" | "Restricted"): Uint8Array {
  const variantIndex = visibility === "Public" ? 0 : 1;
  return Uint8Array.from([variantIndex]);
}

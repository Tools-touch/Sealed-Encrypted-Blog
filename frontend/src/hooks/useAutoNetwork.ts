// src/hooks/useAutoNetwork.ts
import { useEffect, useState } from "react";
import { useCurrentWallet } from "@mysten/dapp-kit";

type Network = "mainnet" | "testnet" | "devnet" | "localnet";

export function useAutoNetwork() {
  const { currentWallet } = useCurrentWallet();
  const [network, setNetwork] = useState<Network>("testnet"); // fallback

  useEffect(() => {
    if (!currentWallet) return;

    const chain = currentWallet.chains?.[0]; // "sui:testnet" | string

    if (chain && chain.startsWith("sui:")) {
      const raw = chain.replace("sui:", ""); // string

      // 手动收窄类型
      const allowed: Network[] = ["mainnet", "testnet", "devnet", "localnet"];

      if (allowed.includes(raw as Network)) {
        setNetwork(raw as Network);
      }
    }
  }, [currentWallet]);

  return network;
}

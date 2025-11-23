// walrusConfig.ts

const DEFAULT_WALRUS_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";

const DEFAULT_WALRUS_PUBLISHER =
  "https://publisher.walrus-testnet.walrus.space";

export function getWalrusAggregator(): string {
  return import.meta.env.VITE_WALRUS_AGGREGATOR?.trim() ||
    DEFAULT_WALRUS_AGGREGATOR;
}

export function getWalrusPublisher(): string {
  return import.meta.env.VITE_WALRUS_PUBLISHER?.trim() ||
    DEFAULT_WALRUS_PUBLISHER;
}

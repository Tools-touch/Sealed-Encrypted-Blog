export const DEFAULT_SEAL_SERVER_IDS = [
  // 官方 Walrus/Seal testnet 示例 key servers
  "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
  "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
];

/**
 * 从环境变量获取 key server 列表；未设置时使用默认 testnet。
 * 环境变量格式：逗号分隔 objectId。
 */
export function getSealServerIds(): string[] {
  const envValue = import.meta.env.VITE_SEAL_SERVER_IDS as string | undefined;
  if (envValue && envValue.trim().length > 0) {
    return envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_SEAL_SERVER_IDS;
}

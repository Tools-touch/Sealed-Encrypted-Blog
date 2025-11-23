const DEFAULT_WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

const DEFAULT_WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";

export interface WalrusStoreResult {
  blobId: string;
  url: string;
}

export interface WalrusStoreOptions {
  epochs?: number;
  permanent?: boolean;
  deletable?: boolean;
  publisherBase?: string;
  contentType?: string;
}

/**
 * Stores content (string或二进制) 到 Walrus 发布者 HTTP API (PUT /v1/blobs) 并返回 blob id。
 */
export async function storeToWalrus(
  content: string | Blob,
  options: WalrusStoreOptions = {}
): Promise<WalrusStoreResult> {
  const publisher = (options.publisherBase || DEFAULT_WALRUS_PUBLISHER).replace(/\/$/, "");
  const query: string[] = [];
  if (options.epochs) query.push(`epochs=${encodeURIComponent(options.epochs)}`);
  if (options.permanent) query.push("permanent=true");
  if (options.deletable) query.push("deletable=true");
  const endpoint = `${publisher}/v1/blobs${query.length ? `?${query.join("&")}` : ""}`;

  const body: BodyInit =
    typeof content === "string" ? new TextEncoder().encode(content) : content;

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": options.contentType || "application/octet-stream" },
    body,
  });

  if (!res.ok) {
    const details = await safeReadBody(res);
    throw new Error(`Walrus 存储失败: ${res.status} ${res.statusText}${details ? ` - ${details}` : ""}`);
  }

  const data = await safeReadJson(res);
  const blobId = (
    data?.newlyCreated?.blobObject?.blobId ||
    data?.alreadyCertified?.blobId ||
    data?.blobId ||
    data?.blob_id ||
    data?.digest ||
    data?.id ||
    ""
  ).toString();
  if (!blobId) {
    throw new Error("Walrus 返回数据缺少 blobId");
  }

  return {
    blobId,
    url: `${DEFAULT_WALRUS_AGGREGATOR.replace(/\/$/, "")}/v1/blobs/${blobId}`,
  };
}

export async function fetchWalrusContent(blobIdOrUrl: string, baseUrl: string = DEFAULT_WALRUS_AGGREGATOR): Promise<string> {
  if (!blobIdOrUrl) throw new Error("缺少 Walrus blobId");
  const isFullUrl = blobIdOrUrl.startsWith("http");
  const endpoint = isFullUrl ? blobIdOrUrl : `${baseUrl.replace(/\/$/, "")}/v1/blobs/${blobIdOrUrl}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const details = await safeReadBody(res);
    throw new Error(`Walrus 内容获取失败: ${res.status} ${res.statusText}${details ? ` - ${details}` : ""}`);
  }

  return await res.text();
}

async function safeReadJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function safeReadBody(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

import { FormEvent, useState } from "react";
import { toast } from "react-toastify";
import { Transaction } from "@mysten/sui/transactions";
import { useNetworkVariable } from "../config/networkConfig";
import { useSuiClient, useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { storeToWalrus } from "../services/walrus";
import { createSealClient } from "../services/seal";
import { getSealServerIds } from "../config/sealConfig";
import { generateAesKey, encryptToBase64 } from "../services/crypto";
import { toHEX } from "@mysten/sui/utils";

const CreateArticleView = () => {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"Public" | "Restricted">("Public");
  const [allowedViewersInput, setAllowedViewersInput] = useState("");
  const account = useCurrentAccount();
  const packageId = useNetworkVariable("packageId");
  const dashboardId = useNetworkVariable("dashboardId");
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [isUploading, setIsUploading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const resetForm = () => {
    setTitle("");
    setSummary("");
    setContent("");
    setImageFile(null);
    setVisibility("Public");
    setAllowedViewersInput("");
  };

  const handleImageUpload = async () => {
    if (!imageFile) {
      toast.error("请先选择图片文件");
      return;
    }
    setIsUploadingImage(true);
    try {
      const { url } = await storeToWalrus(imageFile, { contentType: imageFile.type || "application/octet-stream" });
      setContent((prev) => `${prev}\n\n![${imageFile.name}](${url})\n`);
      toast.success("图片已上传并插入 Markdown 链接");
      setImageFile(null);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!account?.address) {
      toast.error("请先连接钱包");
      return;
    }

    if (!packageId || !dashboardId) {
      toast.error("缺少链上配置，请检查 networkConfig");
      return;
    }

    if (!title.trim() || !content.trim()) {
      toast.error("标题和内容不能为空");
      return;
    }

    const summaryValue = summary.trim() || content.trim().slice(0, 140);

    const expirationMs = Date.now() + 30 * 24 * 60 * 60 * 1000; // 默认 30 天后到期

    toast.info("正在将正文保存到海象...");
    setIsUploading(true);

    // 处理可见性和加密
    const isRestricted = visibility === "Restricted";
    const sealClient = createSealClient(suiClient);

    // 解析可读地址
    const allowedViewers = Array.from(
      new Set(
        (allowedViewersInput || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    if (isRestricted) {
      if (!account?.address) {
        setIsUploading(false);
        toast.error("受限可见需要先连接钱包");
        return;
      }
      if (!allowedViewers.includes(account.address)) {
        allowedViewers.push(account.address);
      }
    }

    // Seal 身份（随机 32 字节）
    const sealIdBytes = isRestricted ? crypto.getRandomValues(new Uint8Array(32)) : new Uint8Array();
    const sealIdHex = toHEX(sealIdBytes);
    let contentKeyEncrypted: Uint8Array = new Uint8Array();
    let walrusPayload = content.trim();
    console.log(walrusPayload);
    toast.info("正文加密中");
    if (isRestricted) {
      try {
        const { cryptoKey, rawKey } = await generateAesKey();
        walrusPayload = await encryptToBase64(content.trim(), cryptoKey);
        
        
        const { encryptedObject } = await sealClient.encrypt({
          threshold: Math.min(2, getSealServerIds().length || 1),
          packageId,
          id: sealIdHex,
          data: rawKey,
        });
        contentKeyEncrypted = encryptedObject;
        console.log(encryptedObject);
        toast.success("正文已加密");
        
      } catch (err) {
        console.error(err);
        setIsUploading(false);
        toast.error(err instanceof Error ? err.message : "Seal 加密失败");
        return;
      }
    }

    let walrusBlobId: string;
    try {
      const { blobId } = await storeToWalrus(walrusPayload);
      walrusBlobId = blobId;
      toast.success("正文已保存到海象");
    } catch (err) {
      console.error(err);
      setIsUploading(false);
      toast.error(err instanceof Error ? err.message : "保存到海象失败");
      return;
    }

    setIsUploading(false);
    toast.info("正在提交交易...");

    const tx = new Transaction();

    const newProposalId = tx.moveCall({
      target: `${packageId}::proposal::create_with_u8_visibility`,
      arguments: [
        tx.pure.string(title.trim()),
        tx.pure.string(summaryValue),
        tx.pure.string(walrusBlobId),
        tx.pure.vector("u8", Array.from(contentKeyEncrypted)),
        tx.pure.vector("u8", Array.from(sealIdBytes)),
        tx.pure.u8(visibility === "Public" ? 0 : 1),
        tx.pure.vector("address", allowedViewers),
        tx.pure.u64(expirationMs),
      ],
    });

    tx.moveCall({
      target: `${packageId}::dashboard::register_proposal`,
      arguments: [
        tx.object(dashboardId),
        newProposalId,
      ],
    });

    signAndExecute(
      { transaction: tx as any },
      {
        onError: (err) => {
          console.error(err);
          toast.error("交易失败");
        },
        onSuccess: async ({ digest }) => {
          await suiClient.waitForTransaction({
            digest,
            options: { showEffects: true },
          });
          toast.success("文章已发布上链");
          resetForm();
        },
      }
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white p-6 shadow-xl">
        <h1 className="text-3xl font-bold">发布新文章</h1>
        <p className="text-sm opacity-90 mt-1">正文保存到 Walrus，摘要与加密信息上链。</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-6 backdrop-blur">
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={visibility === "Public"}
              onChange={() => setVisibility("Public")}
            />
            公开可见
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={visibility === "Restricted"}
              onChange={() => setVisibility("Restricted")}
            />
            指定地址可见（自动包含作者）
          </label>
        </div>

        {visibility === "Restricted" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1" htmlFor="allowed">
                可见地址（逗号分隔）
              </label>
              <input
                id="allowed"
                type="text"
                value={allowedViewersInput}
                onChange={(e) => setAllowedViewersInput(e.target.value)}
                placeholder="0xabc...,0xdef..."
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1">作者地址会自动加入可见列表</p>
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="title">
            标题
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入文章标题"
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="summary">
          摘要
        </label>
        <input
            id="summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="一句话介绍你的文章"
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

    <div>
      <label className="block text-sm font-medium mb-1" htmlFor="content">
        内容（支持 Markdown）
      </label>
      <textarea
        id="content"
        rows={8}
        value={content}
            onChange={(e) => setContent(e.target.value)}
        placeholder="在此输入正文..."
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>

    <div className="flex items-center gap-3 text-sm">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
        disabled={isPending || isUploading || isUploadingImage}
      />
      <button
        type="button"
        className="px-3 py-1 rounded border border-gray-500 disabled:opacity-50"
        onClick={handleImageUpload}
        disabled={isPending || isUploading || isUploadingImage}
      >
        {isUploadingImage ? "上传图片中..." : "上传图片并插入 Markdown"}
      </button>
    </div>

        <button
          type="submit"
          disabled={isPending || isUploading || isUploadingImage}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isPending || isUploading || isUploadingImage ? "发布中..." : "提交发布"}
        </button>
      </form>
    </div>
  );
};

export default CreateArticleView;

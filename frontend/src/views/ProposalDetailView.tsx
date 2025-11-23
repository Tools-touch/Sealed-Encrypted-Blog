import { useEffect, useMemo, useState } from "react";
import { useSuiClient, useSuiClientQuery, useCurrentAccount, useSignAndExecuteTransaction, useSignPersonalMessage } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { toast } from "react-toastify";
import ReactMarkdown from "react-markdown";
import { useNavigation } from "../providers/navigation/NavigationContext";
import { Comment, Proposal } from "../types";
import { useNetworkVariable } from "../config/networkConfig";
import { SuiObjectData } from "@mysten/sui/client";
import { fetchWalrusContent, storeToWalrus } from "../services/walrus";
import { createSealClient, createSessionKey } from "../services/seal";
import { decryptFromBase64, fromBase64, importAesKey, generateAesKey, encryptToBase64 } from "../services/crypto";
import { fromB64, fromHEX, toHEX } from "@mysten/sui/utils";
import { getSealServerIds } from "../config/sealConfig";

function ProposalDetailView() {
  const { currentPage, navigate } = useNavigation();
  const proposalId = useMemo(() => currentPage.replace("/proposal/", ""), [currentPage]);
  const packageId = useNetworkVariable("packageId");
  const suiClient = useSuiClient();
  const account = useCurrentAccount();
  const { mutate: signPersonalMessage } = useSignPersonalMessage();
  const { mutate: signAndExecute, isPending: isSigning } = useSignAndExecuteTransaction();
  const [commentText, setCommentText] = useState("");
  const [commentBodies, setCommentBodies] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editVisibility, setEditVisibility] = useState<"Public" | "Restricted">("Public");
  const [editAllowedInput, setEditAllowedInput] = useState("");
  const [walrusContent, setWalrusContent] = useState("");
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [isUploadingContent, setIsUploadingContent] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const { data, error, isPending, refetch } = useSuiClientQuery(
    "getObject",
    {
      id: proposalId,
      options: { showContent: true }
    },
    { enabled: !!proposalId }
  );

  if (!proposalId) {
    return <div className="text-red-500">无效的文章 ID</div>;
  }

  if (isPending) return <div className="text-center text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-500">加载失败: {error.message}</div>;
  if (!data?.data) return <div className="text-red-500">未找到文章</div>;

  const proposal = parseProposal(data.data);

  useEffect(() => {
    if (!proposal?.contentBlobId) {
      setWalrusContent("");
      setContentError("");
      setIsContentLoading(false);
      return;
    }

    setIsContentLoading(true);
    setContentError("");
    fetchWalrusContent(proposal.contentBlobId)
      .then(async (raw) => {
        if (proposal.visibility === "Public") {
          setWalrusContent(raw);
          return;
        }
        // 受限：需要解密
        if (!proposal.contentKeyEncrypted || !proposal.sealId) {
          throw new Error("缺少加密密钥或 Seal Id");
        }
        if (!account?.address || !packageId) {
          throw new Error("请先连接钱包以解密受限内容");
        }

        setIsDecrypting(true);
        const sealClient = createSealClient(suiClient);
        const sessionKey = await createSessionKey(account.address, packageId, suiClient);
        const message = sessionKey.getPersonalMessage();

        await new Promise<void>((resolve, reject) => {
          signPersonalMessage(
            { message },
            {
              onError: reject,
              onSuccess: ({ signature }) => {
                sessionKey.setPersonalMessageSignature(signature);
                resolve();
              },
            }
          );
        });

        // 构建只调用 seal_approve 的 txBytes
        const sealIdBytes = typeof proposal.sealId === "string" ? fromHEX(proposal.sealId) : new Uint8Array();
        if (sealIdBytes.length === 0) {
          throw new Error("缺少加密密钥或 Seal Id");
        }
        const tx = new Transaction();
        tx.moveCall({
          target: `${packageId}::proposal::seal_approve`,
          arguments: [
            tx.pure.vector("u8", Array.from(sealIdBytes)),
            tx.object(proposalId),
          ],
        });
        const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

        const encryptedBytes = fromBase64(proposal.contentKeyEncrypted);
        const decryptedKeyBytes = await sealClient.decrypt({
          data: encryptedBytes,
          sessionKey,
          txBytes,
        });
        const aesKey = await importAesKey(decryptedKeyBytes);
        const plain = await decryptFromBase64(raw, aesKey);
        setWalrusContent(plain);
      })
      .catch((err) => {
        console.error(err);
        setContentError(err instanceof Error ? err.message : "文章内容加载失败");
      })
      .finally(() => {
        setIsContentLoading(false);
        setIsDecrypting(false);
      });
  }, [proposal?.contentBlobId, proposal?.visibility, proposal?.contentKeyEncrypted, proposal?.sealId, account?.address, packageId, proposalId]);

  useEffect(() => {
    const fetchComments = async () => {
      if (!proposal?.comments?.length) {
        setCommentBodies({});
        return;
      }
      const entries = proposal.comments.map((c, idx) => ({
        key: `${c.author}-${c.timestamp}-${idx}`,
        blobId: c.contentBlobId,
      }));
      const newBodies: Record<string, string> = {};
      await Promise.all(entries.map(async ({ key, blobId }) => {
        if (!blobId) {
          newBodies[key] = "";
          return;
        }
        try {
          newBodies[key] = await fetchWalrusContent(blobId);
        } catch (err) {
          console.error(err);
          newBodies[key] = "";
        }
      }));
      setCommentBodies(newBodies);
    };
    fetchComments();
    // 仅在评论列表内容（作者+时间+blobId）变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.comments?.map((c, idx) => `${c.author}-${c.timestamp}-${idx}-${c.contentBlobId}`).join("|")]);

  if (!proposal) return <div className="text-red-500">解析文章数据失败</div>;

  const isDelisted = proposal.status.variant === "Delisted";
  const isExpired = isUnixTimeExpired(proposal.expiration);
  const isOwner = account?.address === proposal.creator;

  const handleComment = async () => {
    if (!account?.address) {
      toast.error("请先连接钱包");
      return;
    }

    if (!packageId) {
      toast.error("缺少 packageId 配置");
      return;
    }

    const text = commentText.trim();
    if (!text) {
      toast.error("评论不能为空");
      return;
    }

    toast.info("正在将评论保存到海象...");
    let commentBlobId: string;
    try {
      const { blobId } = await storeToWalrus(text);
      commentBlobId = blobId;
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "评论存储失败");
      return;
    }

    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::proposal::add_comment`,
      arguments: [
        tx.object(proposalId),
        tx.pure.string(commentBlobId),
        tx.object("0x6")
      ]
    });

    toast.info("评论提交中...");
    try {
      signAndExecute(
        { transaction: tx as any },
        {
          onError: (err) => {
            console.error(err);
            toast.error("提交失败");
          },
          onSuccess: async ({ digest }) => {
            await suiClient.waitForTransaction({ digest, options: { showEffects: true } });
            toast.success("评论成功");
            setCommentText("");
            refetch();
          },
        }
      );
    } catch (err) {
      console.error(err);
      toast.error("提交失败");
    }
  };

  const handleDelete = async () => {
    if (!account?.address) {
      toast.error("请先连接钱包");
      return;
    }

    if (!packageId) {
      toast.error("缺少 packageId 配置");
      return;
    }

    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::proposal::remove`,
      arguments: [tx.object(proposalId)],
    });

    toast.info("删除交易提交中...");
      signAndExecute(
        { transaction: tx as any },
        {
        onError: (err) => {
          console.error(err);
          toast.error("删除失败");
        },
        onSuccess: async ({ digest }) => {
          await suiClient.waitForTransaction({ digest, options: { showEffects: true } });
          toast.success("文章已删除");
          navigate("/");
        },
      }
    );
  };

  const handleVote = async (voteYes: boolean) => {
    if (!account?.address) {
      toast.error("请先连接钱包");
      return;
    }

    if (!packageId) {
      toast.error("缺少 packageId 配置");
      return;
    }

    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::proposal::vote`,
      arguments: [
        tx.object(proposalId),
        tx.pure.bool(voteYes),
        tx.object("0x6"),
      ],
    });

    toast.info("提交投票中...");
      signAndExecute(
        { transaction: tx as any },
        {
        onError: (err) => {
          console.error(err);
          toast.error("投票失败");
        },
        onSuccess: async ({ digest }) => {
          await suiClient.waitForTransaction({ digest, options: { showEffects: true } });
          toast.success("投票成功");
          refetch();
        },
      }
    );
  };

  const handleSaveEdit = async () => {
    if (!packageId) return toast.error("缺少 packageId 配置");
    if (!account?.address) return toast.error("请先连接钱包");
    if (!editTitle.trim() || !editContent.trim()) {
      toast.error("请填写完整信息");
      return;
    }

    setIsUploadingContent(true);

    const isRestricted = editVisibility === "Restricted";
    const sealClient = createSealClient(suiClient);

    // 解析可读地址
    const allowedViewers = Array.from(
      new Set(
        (editAllowedInput || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    if (isRestricted && !allowedViewers.includes(account.address)) {
      allowedViewers.push(account.address);
    }

    let walrusBlobId = proposal.contentBlobId;
    // 保留已有 sealId，否则生成新的；未受限则传空 bytes
    const existingSealIdBytes = typeof proposal.sealId === "string" && proposal.sealId
      ? (() => { try { return fromHEX(proposal.sealId); } catch { return new Uint8Array(); } })()
      : new Uint8Array();
    let sealIdBytes = isRestricted
      ? crypto.getRandomValues(new Uint8Array(32))
      : existingSealIdBytes;
    let contentKeyEncrypted: Uint8Array = new Uint8Array();
    if (!isRestricted && proposal.contentKeyEncrypted) {
      try {
        contentKeyEncrypted = fromBase64(proposal.contentKeyEncrypted);
      } catch {
        contentKeyEncrypted = new Uint8Array();
      }
    }
    let walrusPayload = editContent.trim();

    if (isRestricted) {
      try {
        const { cryptoKey, rawKey } = await generateAesKey();
        walrusPayload = await encryptToBase64(editContent.trim(), cryptoKey);

        const { encryptedObject } = await sealClient.encrypt({
          threshold: Math.min(2, getSealServerIds().length || 1),
          packageId,
          id: toHEX(sealIdBytes),
          data: rawKey,
        });
        contentKeyEncrypted = encryptedObject;
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Seal 加密失败");
        setIsUploadingContent(false);
        return;
      }
    }

    try {
      const { blobId } = await storeToWalrus(walrusPayload);
      walrusBlobId = blobId;
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "正文上传至海象失败");
      setIsUploadingContent(false);
      return;
    }

    setIsUploadingContent(false);
    const summaryValue = editSummary.trim() || editContent.trim().slice(0, 140);
    const newExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000; // 自动设置为 30 天后
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::proposal::update_content_with_u8_visibility`,
      arguments: [
        tx.object(proposalId),
        tx.pure.string(editTitle.trim()),
        tx.pure.string(summaryValue),
        tx.pure.string(walrusBlobId),
        tx.pure.vector("u8", Array.from(contentKeyEncrypted)),
        tx.pure.vector("u8", Array.from(sealIdBytes)),
        tx.pure.u8(editVisibility === "Public" ? 0 : 1),
        tx.pure.vector("address", allowedViewers),
        tx.pure.u64(newExpiration),
      ],
    });
      signAndExecute(
        { transaction: tx as any },
        {
        onError: (err) => {
          console.error(err);
          toast.error("更新失败");
        },
        onSuccess: async ({ digest }) => {
          await suiClient.waitForTransaction({ digest, options: { showEffects: true } });
          toast.success("文章已更新");
          setIsEditing(false);
          setWalrusContent(editContent.trim());
          refetch();
        },
      }
    );
  };

  const handleImageUpload = async () => {
    if (!imageFile) {
      toast.error("请先选择图片文件");
      return;
    }
    setIsUploadingImage(true);
    try {
      const { url } = await storeToWalrus(imageFile, { contentType: imageFile.type || "application/octet-stream" });
      setEditContent((prev) => `${prev}\n\n![${imageFile.name}](${url})\n`);
      toast.success("图片已上传并插入 Markdown 链接");
      setImageFile(null);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <button
        className="text-blue-500 hover:underline"
        onClick={() => navigate("/")}
      >
        ← 返回列表
      </button>

      <div className="relative overflow-hidden rounded-2xl shadow-2xl border border-indigo-200 dark:border-gray-700 bg-white dark:bg-gray-900/80 backdrop-blur">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10"></div>
        <div className="relative p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-indigo-500 dark:text-indigo-300">
                {isDelisted ? "已下架" : isExpired ? "已过期" : "进行中"}
              </p>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">{proposal.title}</h1>
              <div className="flex flex-wrap gap-2 mt-2 text-sm text-gray-600 dark:text-gray-300">
                <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
                  可见性：{proposal.visibility === "Public" ? "公开" : "指定地址"}
                </span>
                <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  {isDelisted ? "已下架" : formatUnixTime(proposal.expiration)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600 dark:text-gray-300">作者</span>
                <button
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/70 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-100 dark:border-indigo-700 hover:shadow"
                  onClick={() => copyToClipboard(proposal.creator)}
                  title="点击复制地址"
                >
                  <span className="font-mono">{formatAddress(proposal.creator)}</span>
                  <span className="text-xs opacity-80">复制</span>
                </button>
              </div>
              {isOwner && (
                <div className="flex gap-2">
                  <button
                    className="text-sm px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow hover:shadow-md transition disabled:opacity-50"
                    onClick={() => {
                      setIsEditing(true);
                      setEditTitle(proposal.title);
                      setEditSummary(proposal.description);
                      setEditContent(walrusContent || proposal.description);
                      setEditVisibility(proposal.visibility);
                      setEditAllowedInput(proposal.allowedViewers?.join(",") || "");
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="text-sm px-4 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-red-600 text-white shadow hover:shadow-md transition disabled:opacity-50"
                    onClick={handleDelete}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        {isEditing ? (
          <div className="space-y-3 mb-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={editVisibility === "Public"}
                  onChange={() => setEditVisibility("Public")}
                  disabled={isSigning || isUploadingContent}
                />
                公开可见
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={editVisibility === "Restricted"}
                  onChange={() => setEditVisibility("Restricted")}
                  disabled={isSigning || isUploadingContent}
                />
                指定地址可见
              </label>
            </div>
            {editVisibility === "Restricted" && (
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="allowed-edit">
                  可见地址（逗号分隔）
                </label>
                <input
                  id="allowed-edit"
                  type="text"
                  value={editAllowedInput}
                  onChange={(e) => setEditAllowedInput(e.target.value)}
                  disabled={isSigning || isUploadingContent}
                  placeholder="0xabc...,0xdef..."
                  className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">作者地址会自动加入</p>
              </div>
            )}
            <input
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="标题"
              disabled={isSigning || isUploadingContent}
            />
            <input
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              placeholder="摘要（上链保存）"
              disabled={isSigning || isUploadingContent}
            />
            <textarea
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={6}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="内容（支持 Markdown）"
              disabled={isSigning || isUploadingContent}
            />
            <div className="flex items-center gap-3 text-sm">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                disabled={isSigning || isUploadingImage || isUploadingContent}
              />
              <button
                className="px-3 py-1 rounded border border-gray-500 disabled:opacity-50"
                type="button"
                onClick={handleImageUpload}
                disabled={isSigning || isUploadingImage || isUploadingContent}
              >
                {isUploadingImage ? "上传图片中..." : "上传图片并插入 Markdown"}
              </button>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              正文会先上传到海象存储，摘要直接上链。过期时间将自动更新为 30 天后。
            </div>
            <div className="flex gap-3">
              <button
                className="px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600"
                onClick={handleSaveEdit}
                disabled={isSigning || isUploadingContent}
              >
                {isUploadingContent ? "上传中..." : "保存修改"}
              </button>
              <button
                className="px-3 py-1 rounded border border-gray-500"
                onClick={() => setIsEditing(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              摘要：{proposal.description || "暂无摘要"}
            </p>
            {isContentLoading ? (
              <div className="text-gray-500">正文从海象加载中...</div>
            ) : isDecrypting ? (
              <div className="text-gray-500">受限内容解密中...</div>
            ) : contentError ? (
              <div className="text-red-500">{contentError}</div>
            ) : (
              <div className="prose prose-slate dark:prose-invert max-w-none">
                {walrusContent ? (
                  <ReactMarkdown>{walrusContent}</ReactMarkdown>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">暂无正文</p>
                )}
              </div>
            )}
          </div>
        )}
        
        <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-300 items-center flex-wrap">
          <div className="flex gap-2">
            <button
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/70 dark:text-indigo-200 hover:shadow disabled:opacity-60"
              onClick={() => handleVote(true)}
              disabled={isExpired || isDelisted || isSigning}
            >
              👍 <span className="font-semibold">{proposal.votedYesCount}</span>
            </button>
            <button
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/70 dark:text-amber-200 hover:shadow disabled:opacity-60"
              onClick={() => handleVote(false)}
              disabled={isExpired || isDelisted || isSigning}
            >
              👎 <span className="font-semibold">{proposal.votedNoCount}</span>
            </button>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 shadow-sm">
            <span className="text-xs text-gray-500">作者</span>
            <button
              className="font-mono underline decoration-dotted hover:text-indigo-500"
              onClick={() => copyToClipboard(proposal.creator)}
              title="点击复制地址"
            >
              {formatAddress(proposal.creator)}
            </button>
          </div>
          <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            状态: {isExpired ? "已过期" : "进行中"}
          </span>
          <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            可见性: {proposal.visibility === "Public" ? "公开" : "指定地址"}
          </span>
          {proposal.visibility === "Restricted" && (
            <span className="text-xs text-gray-500">受限正文需解密</span>
          )}
          {!account && (
            <span className="text-red-500">请连接钱包以操作</span>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 p-6 rounded-2xl shadow-xl backdrop-blur space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">评论</h2>
          <span className="text-sm text-gray-500">共 {proposal.comments.length} 条</span>
        </div>

        <div className="space-y-2">
          {proposal.comments.length === 0 && (
            <div className="text-gray-500">暂无评论</div>
          )}
          {proposal.comments.map((c, idx) => {
            const key = `${c.author}-${c.timestamp}-${idx}`;
            const body = commentBodies[key];
            return (
              <div key={key} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white/70 dark:bg-gray-900/60">
                <div className="flex items-center justify-between text-sm text-gray-500 mb-2">
                  <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-100 border border-indigo-100 dark:border-indigo-800">
                    <span className="text-xs text-gray-500">评论者</span>
                    <button
                      className="font-mono underline decoration-dotted hover:text-indigo-400"
                      onClick={() => copyToClipboard(c.author)}
                      title="点击复制地址"
                    >
                      {formatAddress(c.author)}
                    </button>
                  </div>
                  <span className="text-xs text-gray-500">{formatUnixTime(c.timestamp)}</span>
                </div>
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {body === undefined ? "加载中..." : body || "暂无内容"}
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={isExpired ? "文章已过期/下架，无法评论" : "写下你的看法..."}
            disabled={isExpired || isDelisted || isSigning}
            className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-200 dark:disabled:bg-gray-700"
            rows={4}
          />
          <button
            onClick={handleComment}
            disabled={isExpired || isDelisted || isSigning}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white py-3 px-4 rounded-xl hover:from-indigo-600 hover:to-purple-600 transition-all shadow disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed"
          >
            {isSigning ? "提交中..." : "发表评论"}
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

function normalizeComment(raw: any): Comment {
  const fields = raw?.fields ?? raw ?? {};
  return {
    author: fields.author ?? "",
    contentBlobId: fields.content_blob_id ?? "",
    timestamp: Number(fields.timestamp ?? 0),
  };
}

function parseProposal(data: SuiObjectData): Proposal | null {
  if (data.content?.dataType !== "moveObject") return null;

  const { voted_yes_count, voted_no_count, expiration, comments, content_blob_id, content_key_encrypted, seal_id, visibility, allowed_viewers, ...rest } = data.content.fields as any;

  const parsedComments: Comment[] = Array.isArray(comments)
    ? comments.map(normalizeComment)
    : [];

  const normalizeB64 = (value: any) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      try {
        return btoa(String.fromCharCode(...value));
      } catch {
        return "";
      }
    }
    return "";
  };

  const normalizeSealId = (value: any) => {
    if (!value) return "";
    if (typeof value === "string") {
      try {
        return toHEX(fromB64(value));
      } catch {
        return "";
      }
    }
    if (Array.isArray(value)) {
      try {
        return toHEX(new Uint8Array(value));
      } catch {
        return "";
      }
    }
    return "";
  };

  return {
    ...rest,
    contentBlobId: content_blob_id ?? "",
    contentKeyEncrypted: normalizeB64(content_key_encrypted),
    sealId: normalizeSealId(seal_id),
    visibility: visibility?.fields?.Public != undefined || visibility?.variant === "Public" ? "Public" : "Restricted",
    allowedViewers: Array.isArray(allowed_viewers) ? allowed_viewers.map(String) : [],
    votedYesCount: Number(voted_yes_count),
    votedNoCount: Number(voted_no_count),
    expiration: Number(expiration),
    comments: parsedComments,
  };
}

function isUnixTimeExpired(unixTimeMs: number) {
  return new Date(unixTimeMs) < new Date();
}

function formatUnixTime(timestampMs: number) {
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return "Invalid Date";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatAddress(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function copyToClipboard(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

export default ProposalDetailView;

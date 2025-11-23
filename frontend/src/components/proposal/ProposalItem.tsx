import { useSuiClientQuery } from "@mysten/dapp-kit";
import { FC } from "react";
import { EcText } from "../Shared";
import { SuiObjectData } from "@mysten/sui/client";
import { Comment, Proposal, VoteNft } from "../../types";
import { useNavigation } from "../../providers/navigation/NavigationContext";
import { fromB64, toHEX } from "@mysten/sui/utils";

interface ProposalItemsProps {
  id: string;
  voteNft: VoteNft | undefined;
};

export const ProposalItem: FC<ProposalItemsProps> = ({id, voteNft}) => {
  const { navigate } = useNavigation();
  const { data: dataResponse, error, isPending} = useSuiClientQuery(
    "getObject", {
      id,
      options: {
        showContent: true
      }
    }
  );

  if (isPending) return <EcText centered text="Loading..."/>;
  if (error) return <EcText isError text={`Error: ${error.message}`}/>;
  if (!dataResponse.data) return null;

  const proposal = parseProposal(dataResponse.data);

  if (!proposal) return <EcText text="No data found!"/>

  const expiration = proposal.expiration;
  const isDelisted = proposal.status.variant === "Delisted";
  const isExpired = isUnixTimeExpired(expiration) || isDelisted;

  return (
      <div
        onClick={() => navigate(`/proposal/${id}`)}
        className="group relative overflow-hidden rounded-2xl border border-indigo-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow hover:shadow-xl transition-all cursor-pointer"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative p-5 space-y-3">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-indigo-500 dark:text-indigo-300">{isDelisted ? "已下架" : isExpired ? "已过期" : "进行中"}</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">{proposal.title}</p>
            </div>
            { !!voteNft && <img className="w-9 h-9 rounded-full ring-2 ring-white/50" src={voteNft?.url} alt="vote nft" />}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3 min-h-[60px]">
            {proposal.description}
          </p>
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
            <div className="flex gap-3">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                👍 {proposal.votedYesCount}
              </span>
              <span className="flex items-center gap-1 text-red-500">
                👎 {proposal.votedNoCount}
              </span>
            </div>
            <span className="text-xs text-gray-500">{ isDelisted ? "Delisted" : formatUnixTime(expiration)}</span>
          </div>
        </div>
      </div>
  )
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

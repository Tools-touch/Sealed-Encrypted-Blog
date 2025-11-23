

export type ProposalStatus = {
  variant: "Active" | "Delisted";
};

export interface Comment {
  author: string;
  contentBlobId: string;
  contentText?: string; // 解密后的正文（前端使用）
  timestamp: number;
};

export interface Proposal {
  id: SuiID;
  title: string;
  description: string;
  contentBlobId: string;
  contentKeyEncrypted: string; // base64 (Seal 加密后的对称密钥)
  sealId: string; // hex string
  visibility: "Public" | "Restricted";
  allowedViewers: string[];
  status: ProposalStatus,
  votedYesCount: number;
  votedNoCount: number;
  expiration: number;
  creator: string;
  voter_registry?: string[];
  comments: Comment[];
};

export interface VoteNft {
  id: SuiID;
  proposalId: string;
  url: string;
};

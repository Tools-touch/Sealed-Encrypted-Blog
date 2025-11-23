module voting_system::proposal;

use std::string::String;
use sui::table::{Self, Table};
use sui::url::{Url, new_unsafe_from_bytes};
use sui::clock::Clock;
use sui::event;

const EDuplicateVote: u64 = 0;
const EProposalDelisted: u64 = 1;
const EProposalExpired: u64 = 2;
const EEmptyComment: u64 = 3;
const ENotCreator: u64 = 4;
const ENoAccess: u64 = 5;

public enum Visibility has copy, store, drop {
    Public,
    Restricted,
}

public enum ProposalStatus has store, drop {
    Active,
    Delisted,
}

public struct Proposal has key {
    id: UID,
    title: String,
    description: String,
    content_blob_id: String,
    content_key_encrypted: vector<u8>, // Seal 加密后的对称密钥（若公开可为空）
    seal_id: vector<u8>, // Seal identity（不含 package 前缀）
    visibility: Visibility,
    allowed_viewers: vector<address>, // 受限可见时包含 creator
    voted_yes_count: u64,
    voted_no_count: u64,
    expiration: u64,
    creator: address,
    status: ProposalStatus,
    voters: Table<address, bool>,
    comments: vector<Comment>,
}

public struct VoteProofNFT has key {
    id: UID,
    proposal_id: ID,
    name: String,
    description: String,
    url: Url,
}

public struct VoteRegistered has copy, drop {
    proposal_id: ID,
    voter: address,
    vote_yes: bool,
}

public struct Comment has store, drop, copy {
    author: address,
    content_blob_id: String,
    timestamp: u64,
}

public struct CommentAdded has copy, drop {
    proposal_id: ID,
    commenter: address,
    timestamp: u64,
}

// Seal 访问控制函数
public fun seal_approve(id: vector<u8>, proposal: &Proposal, ctx: &TxContext) {
    match (proposal.visibility) {
        Visibility::Public => {
            // 公开：直接放行
        },
        Visibility::Restricted => {
            // id 必须匹配
            assert!(id == proposal.seal_id, ENoAccess);
            let sender = tx_context::sender(ctx);
            // 必须在 allowed_viewers 列表
            assert!(vector::contains(&proposal.allowed_viewers, &sender), ENoAccess);
        }
    };
}

// === Public Functions ===

public fun vote(self: &mut Proposal, vote_yes: bool, clock: &Clock, ctx: &mut TxContext) {
    assert!(self.expiration > clock.timestamp_ms(), EProposalExpired);
    assert!(self.is_active(), EProposalDelisted);
    assert!(!self.voters.contains(ctx.sender()), EDuplicateVote);
    
    if (vote_yes) {
        self.voted_yes_count = self.voted_yes_count + 1;
    } else {
        self.voted_no_count = self.voted_no_count + 1;
    };

    self.voters.add(ctx.sender(), vote_yes);
    issue_vote_proof(self, vote_yes, ctx);

    event::emit(VoteRegistered {
        proposal_id: self.id.to_inner(),
        voter: ctx.sender(),
        vote_yes
    });
}

public fun add_comment(self: &mut Proposal, content_blob_id: String, clock: &Clock, ctx: &mut TxContext) {
    assert!(self.expiration > clock.timestamp_ms(), EProposalExpired);
    assert!(self.is_active(), EProposalDelisted);
    assert!(!content_blob_id.is_empty(), EEmptyComment);

    let timestamp = clock.timestamp_ms();
    let comment = Comment {
        author: ctx.sender(),
        content_blob_id,
        timestamp,
    };

    self.comments.push_back(comment);

    event::emit(CommentAdded {
        proposal_id: self.id.to_inner(),
        commenter: ctx.sender(),
        timestamp,
    });
}


public fun vote_proof_url(self: &VoteProofNFT): Url {
    self.url
}

public fun is_active(self: &Proposal): bool {
    let status = self.status();

    match (status) {
        ProposalStatus::Active => true,
        _ => false,
    }
}

public fun status(self: &Proposal): &ProposalStatus {
    &self.status
}

public fun title(self: &Proposal): String {
    self.title
}

public fun description(self: &Proposal): String {
    self.description
}

public fun content_blob_id(self: &Proposal): String {
    self.content_blob_id
}

public fun content_key_encrypted(self: &Proposal): vector<u8> {
    self.content_key_encrypted
}

public fun seal_id(self: &Proposal): vector<u8> {
    self.seal_id
}

public fun visibility(self: &Proposal): &Visibility {
    &self.visibility
}

fun visibility_from_u8(raw: u8): Visibility {
    if (raw == 1) {
        Visibility::Restricted
    } else {
        Visibility::Public
    }
}

public fun allowed_viewers(self: &Proposal): &vector<address> {
    &self.allowed_viewers
}

public fun voted_yes_count(self: &Proposal): u64 {
    self.voted_yes_count
}

public fun voted_no_count(self: &Proposal): u64 {
    self.voted_no_count
}

public fun expiration(self: &Proposal): u64 {
    self.expiration
}

public fun creator(self: &Proposal): address {
    self.creator
}

public fun voters(self: &Proposal): &Table<address, bool> {
    &self.voters
}

// === Author Functions ===

public fun create(
    title: String,
    description: String,
    content_blob_id: String,
    content_key_encrypted: vector<u8>,
    seal_id: vector<u8>,
    visibility: Visibility,
    allowed_viewers: vector<address>,
    expiration: u64,
    ctx: &mut TxContext
): ID {
    let proposal = Proposal {
        id: object::new(ctx),
        title,
        description,
        content_blob_id,
        content_key_encrypted,
        seal_id,
        visibility,
        allowed_viewers,
        voted_yes_count: 0,
        voted_no_count: 0,
        expiration,
        creator: ctx.sender(),
        status: ProposalStatus::Active,
        voters: table::new(ctx),
        comments: vector::empty(),
    };

    let id = proposal.id.to_inner();
    transfer::share_object(proposal);

    id
}

public fun create_with_u8_visibility(
    title: String,
    description: String,
    content_blob_id: String,
    content_key_encrypted: vector<u8>,
    seal_id: vector<u8>,
    visibility_raw: u8,
    allowed_viewers: vector<address>,
    expiration: u64,
    ctx: &mut TxContext
): ID {
    create(
        title,
        description,
        content_blob_id,
        content_key_encrypted,
        seal_id,
        visibility_from_u8(visibility_raw),
        allowed_viewers,
        expiration,
        ctx
    )
}

public fun update_content(
    self: &mut Proposal,
    title: String,
    description: String,
    content_blob_id: String,
    content_key_encrypted: vector<u8>,
    seal_id: vector<u8>,
    visibility: Visibility,
    allowed_viewers: vector<address>,
    expiration: u64,
    ctx: &TxContext
) {
    assert!(self.creator == ctx.sender(), ENotCreator);
    self.title = title;
    self.description = description;
    self.content_blob_id = content_blob_id;
    self.content_key_encrypted = content_key_encrypted;
    self.seal_id = seal_id;
    self.visibility = visibility;
    self.allowed_viewers = allowed_viewers;
    self.expiration = expiration;
}

public fun update_content_with_u8_visibility(
    self: &mut Proposal,
    title: String,
    description: String,
    content_blob_id: String,
    content_key_encrypted: vector<u8>,
    seal_id: vector<u8>,
    visibility_raw: u8,
    allowed_viewers: vector<address>,
    expiration: u64,
    ctx: &TxContext
) {
    let visibility = visibility_from_u8(visibility_raw);
    update_content(
        self,
        title,
        description,
        content_blob_id,
        content_key_encrypted,
        seal_id,
        visibility,
        allowed_viewers,
        expiration,
        ctx
    );
}

public fun remove(self: Proposal, ctx: &TxContext) {
    let Proposal {
        id,
        title: _,
        description: _,
        content_blob_id: _,
        content_key_encrypted: _,
        seal_id: _,
        visibility: _,
        allowed_viewers: _,
        voted_yes_count: _,
        voted_no_count: _,
        expiration: _,
        status: _,
        voters,
        creator,
        comments: _,
    } = self;

    assert!(creator == ctx.sender(), ENotCreator);
    table::drop(voters);
    object::delete(id)
}

fun issue_vote_proof(proposal: &Proposal, vote_yes: bool, ctx: &mut TxContext) {
    let mut name = b"NFT ".to_string();
    name.append(proposal.title);

    let mut description = b"Proof of votting on ".to_string();
    let proposal_address = object::id_address(proposal).to_string();
    description.append(proposal_address);

    let vote_yes_image = new_unsafe_from_bytes(b"https://thrangra.sirv.com/vote_yes_nft.jpg");
    let vote_no_image = new_unsafe_from_bytes(b"https://thrangra.sirv.com/vote_no_nft.jpg");

    let url = if (vote_yes) { vote_yes_image } else { vote_no_image };

    let proof = VoteProofNFT {
        id: object::new(ctx),
        proposal_id: proposal.id.to_inner(),
        name,
        description,
        url
    };

    transfer::transfer(proof, ctx.sender());
}

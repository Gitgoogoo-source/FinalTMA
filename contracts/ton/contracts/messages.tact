message(0x504d494e) MintWithPermit {
    receiver: Address;
    nftId: Int as uint64;
    templateHash: Int as uint256;
    nonce: Int as uint128;
    expiry: Int as uint64;
    metadataUri: Cell;
    signature: Cell;
}

message(0x10a1b2c3) InitializeNft {
    owner: Address;
    metadataUri: Cell;
}

message(0x5fcc3d14) NftTransfer {
    queryId: Int as uint64;
    newOwner: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardAmount: Int as coins;
    forwardPayload: Cell?;
}

message(0x2fcb26a2) GetStaticData {
    queryId: Int as uint64;
}

message(0x8b771735) ReportStaticData {
    queryId: Int as uint64;
    index: Int as uint64;
    collection: Address;
}

message(0x693d3950) GetRoyaltyParams {
    queryId: Int as uint64;
}

message(0xa8cb00ad) ReportRoyaltyParams {
    queryId: Int as uint64;
    numerator: Int as uint16;
    denominator: Int as uint16;
    destination: Address;
}

message(0xd53276db) Excesses {
    queryId: Int as uint64;
}

struct NftData {
    initialized: Bool;
    index: Int;
    collectionAddress: Address;
    ownerAddress: Address;
    individualContent: Cell;
}

struct CollectionData {
    nextItemIndex: Int;
    collectionContent: Cell;
    ownerAddress: Address;
}

struct RoyaltyParameters {
    numerator: Int;
    denominator: Int;
    destination: Address;
}

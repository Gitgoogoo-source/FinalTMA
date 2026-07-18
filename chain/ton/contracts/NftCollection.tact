import "@stdlib/content";
import "./messages";
import "./NftItem";

contract PokePetsNftCollection {
    owner: Address;
    mintPublicKey: Int as uint256;
    royaltyDestination: Address;
    collectionContent: Cell;
    nextItemIndex: Int as uint64 = 0;
    usedNonces: map<Int as uint128, Bool>;
    mintedItems: map<Int as uint64, Bool>;

    init(owner: Address, mintPublicKey: Int, royaltyDestination: Address, collectionMetadataUri: String) {
        self.owner = owner;
        self.mintPublicKey = mintPublicKey;
        self.royaltyDestination = royaltyDestination;
        self.collectionContent = createOffchainContent(collectionMetadataUri);
    }

    receive("deploy") {
        require(sender() == self.owner, "NOT_OWNER");
    }

    receive(msg: MintWithPermit) {
        require(sender() == msg.receiver, "RECEIVER_MISMATCH");
        require(now() <= msg.expiry, "PERMIT_EXPIRED");
        require(self.usedNonces.get(msg.nonce) == null, "NONCE_REPLAY");
        require(self.mintedItems.get(msg.nftId) == null, "NFT_ALREADY_MINTED");
        let digest = beginCell()
            .storeAddress(myAddress())
            .storeAddress(msg.receiver)
            .storeUint(msg.nftId, 64)
            .storeUint(msg.templateHash, 256)
            .storeUint(msg.nonce, 128)
            .storeUint(msg.expiry, 64)
            .storeRef(msg.metadataUri)
            .endCell()
            .hash();
        require(checkSignature(digest, msg.signature.beginParse(), self.mintPublicKey), "INVALID_PERMIT");
        self.usedNonces.set(msg.nonce, true);
        self.mintedItems.set(msg.nftId, true);
        self.nextItemIndex += 1;
        let item = initOf PokePetsNftItem(myAddress(), msg.nftId);
        send(SendParameters {
            to: contractAddress(item),
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            code: item.code,
            data: item.data,
            body: InitializeNft { owner: msg.receiver, metadataUri: msg.metadataUri }.toCell(),
        });
    }

    receive(msg: GetRoyaltyParams) {
        send(SendParameters {
            to: sender(),
            value: 0,
            mode: SendRemainingValue,
            bounce: false,
            body: ReportRoyaltyParams { queryId: msg.queryId, numerator: 1, denominator: 100, destination: self.royaltyDestination }.toCell(),
        });
    }

    get fun get_collection_data(): CollectionData {
        return CollectionData { nextItemIndex: self.nextItemIndex, collectionContent: self.collectionContent, ownerAddress: self.owner };
    }

    get fun get_nft_address_by_index(index: Int): Address {
        return contractAddress(initOf PokePetsNftItem(myAddress(), index));
    }

    get fun get_nft_content(_index: Int, individualContent: Cell): Cell {
        return individualContent;
    }

    get fun royalty_params(): RoyaltyParameters {
        return RoyaltyParameters { numerator: 1, denominator: 100, destination: self.royaltyDestination };
    }

    get fun mint_public_key(): Int {
        return self.mintPublicKey;
    }

    get fun is_nonce_used(nonce: Int): Bool {
        return self.usedNonces.get(nonce) != null;
    }
}

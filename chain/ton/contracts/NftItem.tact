import "./messages";

contract PokePetsNftItem {
    collection: Address;
    index: Int as uint64;
    owner: Address;
    content: Cell;
    initialized: Bool = false;

    init(collection: Address, index: Int) {
        self.collection = collection;
        self.index = index;
        self.owner = collection;
        self.content = emptyCell();
    }

    receive(msg: InitializeNft) {
        require(sender() == self.collection, "NOT_COLLECTION");
        require(!self.initialized, "ALREADY_INITIALIZED");
        self.owner = msg.owner;
        self.content = msg.metadataUri;
        self.initialized = true;
    }

    receive(msg: NftTransfer) {
        let ctx = context();
        require(self.initialized, "NOT_INITIALIZED");
        require(ctx.sender == self.owner, "NOT_OWNER");
        require(ctx.value >= msg.forwardAmount, "VALUE_TOO_LOW");
        let previousOwner = self.owner;
        self.owner = msg.newOwner;
        if (msg.forwardAmount > 0) {
            send(SendParameters {
                to: msg.newOwner,
                value: msg.forwardAmount,
                bounce: false,
                body: beginCell().storeUint(0x05138d91, 32).storeUint(msg.queryId, 64).storeAddress(previousOwner).storeMaybeRef(msg.forwardPayload).endCell(),
            });
        }
        send(SendParameters {
            to: msg.responseDestination,
            value: 0,
            mode: SendRemainingValue,
            bounce: false,
            body: Excesses { queryId: msg.queryId }.toCell(),
        });
    }

    receive(msg: GetStaticData) {
        send(SendParameters {
            to: sender(),
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: ReportStaticData { queryId: msg.queryId, index: self.index, collection: self.collection }.toCell(),
        });
    }

    get fun get_nft_data(): NftData {
        return NftData {
            initialized: self.initialized,
            index: self.index,
            collectionAddress: self.collection,
            ownerAddress: self.owner,
            individualContent: self.content,
        };
    }
}

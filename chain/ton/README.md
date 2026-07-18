# PokePets TON NFT

本目录是 PokePets 唯一 TON 合约来源：`PokePetsNftCollection`、`PokePetsNftItem`、部署/验收命令与公开 metadata JSON Schema。

## 固定链上规则

- Collection content、owner、Mint permit 公钥在部署后不可修改。
- NFT Item content 在部署时写入且不可修改。
- 版税固定为 1%，接收地址在 Collection 部署时确定。
- 每个 permit 绑定 Collection、receiver、template hash、`nft_id`、nonce、expiry 和 metadata URI；nonce 只能使用一次。
- 用户通过 TON Connect 发送交易并承担网络费；服务端私钥只签 permit，不托管用户钱包。

## 命令

```sh
pnpm --filter @pokepets/ton build
pnpm --filter @pokepets/ton typecheck
pnpm --filter @pokepets/ton deploy:testnet
pnpm --filter @pokepets/ton verify
pnpm --filter @pokepets/ton deploy:mainnet
```

mainnet 命令除完整环境变量外，必须显式设置 `TON_MAINNET_DEPLOY_APPROVED=I_UNDERSTAND_MAINNET`。真实部署仍要求用户当次授权和部署钱包；仓库不保存 mnemonic、私钥或 provider token。

## Metadata 真相

Mint 成功后，服务端从正式目录构造快照，数据库在同一原子完成动作中冻结 JSON 与 checksum；公开端点只按 `nft_id` 返回该快照。仓库不提交临时 metadata 或图片。发布前必须先通过 `python3 tools/catalog/build.py --check-assets`。

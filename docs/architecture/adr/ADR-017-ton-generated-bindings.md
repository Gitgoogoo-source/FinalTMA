# ADR-017：TON 生成绑定与静态门禁

- 状态：已接受
- 日期：2026-07-31

## 背景

`contracts/ton/commands/deploy.ts` 与 `commands/verify.ts` 静态导入 Tact 编译器生成的 Collection TypeScript 绑定。根 `pnpm typecheck` 会检查 TON workspace，但原 `@evomypet/ton typecheck` 只运行 TypeScript；当全新 Git 副本没有被忽略的 `contracts/ton/build/` 时，静态门禁会因绑定不存在而失败。发布手册又把 `pnpm chain:build` 放在 typecheck 之后，因此人工预生成不是正式发布链的一部分。

## 决策

Tact 合约源码、`tact.config.json`、锁定的 `@tact-lang/compiler` 与锁文件是生成绑定和编译产物的唯一来源。`@evomypet/ton typecheck` 固定先执行本 workspace 的 `build`，再对生成绑定、部署命令和验收命令运行 TypeScript 检查。根 `pnpm typecheck`、CI、全新开发机和正式发布因此使用同一条显式依赖链，不要求人工前置命令。

`contracts/ton/build/` 继续保持 Git 忽略。生成的 TypeScript、ABI、BoC、FunC、Fift、package 与 report 都不是独立源码，不手写、不提交、不作为配置来源。正式发布顺序保留后续独立的 `pnpm chain:build`，用于再次确认完整 Tact 编译可以从仓库源码确定性完成。

## 不变量

- typecheck 生成只运行锁定的本地 Tact 编译器，不读取 RPC、钱包、mnemonic、Token、Telegram 凭据或云端秘密，不部署合约或发送交易。
- 合约源码、Tact 编译选项、部署地址计算、部署与链上验证命令的行为不因本裁决改变。
- 一个初始不存在 `contracts/ton/build/` 的干净副本在锁文件安装后直接运行 `pnpm typecheck` 必须成功。
- 重复 typecheck 或 `pnpm chain:build` 必须生成相同 ABI、BoC 与 TypeScript 绑定，且不得改变受 Git 跟踪文件。

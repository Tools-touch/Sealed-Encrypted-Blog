# Sealed Encrypted Blog 部署指南（中文）

## 一、项目结构
- `contracts/`：Move 智能合约（发布文章与 Dashboard）。
- `frontend/`：Vite + React 前端（含 Walrus 存储、Seal 加密）。

## 二、环境要求
1. **Sui CLI**：按官方指南安装并创建账户  
   <https://docs.sui.io/guides/developer/getting-started/sui-install>
2. **Node.js & pnpm**：安装 Node.js 后，全局安装 pnpm  
   `npm install -g pnpm`
3. （可选）**Walrus 聚合器/发布者**：默认使用 Testnet 公共服务，可通过环境变量自定义。

## 三、合约编译与发布
```bash
cd contracts/Sealed
sui move build
sui client publish --gas-budget 200000000 --json
```
发布完成后记录：`packageId`、`Dashboard` 对象 ID、`UpgradeCap`（admin cap）。

## 四、前端配置
编辑 `frontend/src/constants.ts`，填入你的链上 ID（示例为 testnet）：
```ts
export const TESTNET_PACKAGE_ID = "<your-package-id>";
export const TESTNET_DASHBOARD_ID = "<your-dashboard-id>";
export const TESTNET_ADMIN_CAP   = "<your-admin-cap-id>";
```
本地/其他网络按需填 `DEVNET_*`、`LOCAL_*` 等。

### 可选环境变量
前端可通过 `.env` 设置：
```bash
VITE_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
VITE_SEAL_SERVER_IDS=0x...,0x...   # Seal key server 对象 ID，默认内置官方 testnet 示例
```

## 五、安装依赖与运行前端
```bash
cd frontend
pnpm install     # 如需镜像，可先设 registry
pnpm dev         # 默认开发模式
```
启动后按提示访问本地地址（通常为 http://localhost:5173）。

## 六、主要功能说明
- **文章发布**：正文上传 Walrus，摘要/元数据上链；支持“公开/指定地址可见”，可插入图片（上传至 Walrus）。
- **加密正文**：受限可见模式使用 Seal 加密对称密钥，前端需连接钱包、签名 SessionKey 并调用 `seal_approve` 解密。
- **评论**：评论正文上传 Walrus，仅存 blobId 上链。
- **投票与凭证**：支持投票并获取 NFT 凭证；列表显示已有 NFT。
- **编辑/删除**：作者可更新文章内容（重新加密并上传）或删除文章。

## 七、常见问题
- **FunctionNotFound / ABI 变更**：每次修改合约需重新发布，更新前端 `packageId`/`dashboardId`。
- **tx.pure 参数错误**：前端已改用 `create_with_u8_visibility` / `update_content_with_u8_visibility`，确保调用的包版本匹配。
- **网络/依赖安装失败**：如 npm 被墙，请设置 registry（例如 `https://registry.npmmirror.com`），再 `pnpm install --force`。

## 八、调试技巧
- 检查当前网络配置（前端右上角连接钱包及 network）。
- 使用 `sui client object <id>` 查看链上对象状态。
- 前端报错查看浏览器控制台与终端日志；Seal/Walrus 相关错误通常与网络或配置有关。

祝部署顺利，编码愉快！🚀

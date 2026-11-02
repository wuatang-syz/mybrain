# TheMind

Organize an Obsidian vault through relationship graphs, mind maps and a three-dimensional knowledge world. Desktop only; minimum declared version: Obsidian 1.8.7 (release compatibility still requires manual verification).

## Paid access

**All plugin features require a ¥99 one-time lifetime license.** There is no automatic renewal. Existing Markdown files remain accessible in Obsidian without a license. Future separately priced cloud services are not included. This build provides a WeChat payment QR code, offline activation and operator-issued licenses.

Open TheMind settings or the ribbon icon, scan the WeChat payment QR code and pay ¥99, then contact WeChat **wuatangiii** with the payment time and transaction number. The seller checks settlement manually before issuing a license. After receiving a signed `MB1.…` license, paste it into the activation field, save, then disable and re-enable the plugin. No TheMind account is required for offline activation. Never share your license code. Alipay is not currently configured.

## Install

Copy `main.js`, `manifest.json` and `styles.css` from a release into `<Vault>/.obsidian/plugins/themind/`, then enable TheMind under Community plugins. No approved community listing is claimed yet.

After activation, use the ribbon icon or **Open knowledge graph** command. Relationships follow real folders and internal links; edits can modify folders and note content. Back up your vault before trying structural editing. Switch views from the toolbar to use mind maps, the native graph, or the knowledge world.

## Upgrade from the development build

Disable `obsidian-brain` first. Back up its `data.json`, install `themind`, and copy the backed-up `data.json` into the new plugin folder before enabling it. Do not enable both plugins together. Graph layouts and settings are retained, but command hotkeys need reassignment because the plugin ID changed. Local `npm run sync` intentionally keeps the legacy development installation ID and folder; release packages use `themind`.

## Privacy and network disclosure

The plugin performs offline signature verification and does not send notes, filenames or license codes to a server. It contains no client telemetry. Clicking a purchase link opens an external HTTPS website; that site's payment/privacy terms apply. License tokens and settings are saved in the vault's plugin `data.json` and may be copied by vault sync. See [privacy details](docs/privacy.md).

## Development and release

Use `npm ci`, `npm test`, `npm run lint`, `npm run build`, and `npm run package`. Installable files are in `dist/themind`. Run `npm run release:check` before release; it blocks incomplete payment configuration. GitHub release tag must equal the manifest version (no `v` prefix); attach the three build files individually. Submit through the Obsidian Community developer dashboard.

See [commercial launch instructions](docs/commercial-launch.md) for payment configuration and offline signing. Private signing keys are never distributed with the plugin.

## License and attribution

The existing repository LICENSE has been preserved. It contains Dynalist's permissive template grant. Payment gating does not replace that grant or revoke existing recipients' rights. Commercial licensing and ownership of original/third-party contributions must be reviewed before public sale; do not represent this repository as proprietary until that work is complete. Dependencies include Three.js and d3-force; retain applicable third-party notices. Check bundled image provenance before release. TheMind is an independent community plugin and is not an official Obsidian product.

## 当前购买方式

买断价为 **¥99**。在插件购买界面使用微信扫描收款码付款，再添加微信 **wuatangiii**，提供付款时间和交易单号。运营者在收款记录核实到账后，人工发送授权码。二维码原图随插件打包，显示图片不产生网络请求。扫码并不自动激活；支付宝目前未配置，不显示购买入口。

TheMind was previously developed as Mybrain. Offline license tokens retain the internal product identifier `mybrain` so existing licenses remain valid. The GitHub repository remains `wuatang-syz/mybrain`.

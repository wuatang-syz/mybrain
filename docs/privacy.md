# Privacy

Mybrain reads vault notes and relationships locally. Editing relationships can update note links and folders. Activation verifies an ECDSA signature locally and does not access a licensing server. No notes, filenames, device fingerprint, analytics events or license tokens are uploaded by this implementation.

The license token is stored in plugin data.json with settings. It contains a random license ID, product, plan and issue timestamp; no customer name, email or payment order number. Protect the token and be aware that vault backup/sync may copy it.

WeChat/Alipay purchase links open external websites only after a user click. Payment processing, order records and customer support are handled outside the plugin. The merchant must publish its identity, contact details, order retention, refund terms and payment-provider privacy information before accepting payments.

The current manual payment flow displays a bundled WeChat payment QR image offline. Users scan it in WeChat and contact wuatangiii with payment time and transaction number for manual verification and license delivery. The plugin itself does not submit payment data, confirm settlement, or contact WeChat. Alipay is not configured in this release.

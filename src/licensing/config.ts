import wechatQr from './assets/wechat-pay.png';
/** Public release configuration. Never put a signing private key here. */
export const commerce = {
  publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmbFeC1+1XGFocaS7favYKPJ5jxk19R+eojJwPh98/FktGExsplIiWxyIqUqS4ITeQowc6nKYBtwiOXswTPAPtA==',
  wechatUrl: '', // HTTPS hosted one-time checkout / purchase instructions
  alipayUrl: '',
  wechatQr,
  priceLabel: '¥99 一次性买断 · 全部功能',
  support: '微信：wuatangiii',
};

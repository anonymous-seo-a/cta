require('dotenv').config();

module.exports = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514',
  },
  wp: {
    username: process.env.WP_USERNAME,
    appPassword: process.env.WP_APP_PASSWORD,
    restBase: `${process.env.SITE_URL}/wp-json/wp/v2`,
  },
  site: {
    url: process.env.SITE_URL,
    phpToken: process.env.PHP_API_TOKEN,
  },
  partnerPriority: {
    securities: ['rakuten', 'sbi', 'monex', 'matsui', 'moomoo', 'okasan', 'mufjesmart'],
    cardloan: ['promise', 'aiful', 'acom', 'lakealsa', 'smbcmobit'],
    cryptocurrency: ['bitflyer', 'coincheck', 'gmo_coin', 'sbi_vc'],
  },
  categoryBlockConfig: {
    cardloan: { entityKey: 'company', inlineCta: 'cardloan-inline-cta' },
    cryptocurrency: { entityKey: 'exchange', inlineCta: 'crypto-inline-cta' },
    securities: { entityKey: 'company', inlineCta: 'inline-cta' },
  },
  partnerSlugMap: {
    'promise': 'promise', 'acom': 'acom', 'aiful': 'aiful',
    'lakealsa': 'lakealsa', 'smbcmobit': 'smbcmobit',
    'bitflyer': 'bitflyer', 'coincheck': 'coincheck',
    'gmo-coin': 'gmo_coin', 'gmo_coin': 'gmo_coin',
    'sbi_vc': 'sbi_vc',
    'sbi': 'sbi', 'rakuten': 'rakuten',
    'monex': 'monex', 'matsui': 'matsui', 'moomoo': 'moomoo',
    'okasan': 'okasan', 'mufjesmart': 'mufjesmart',
  },
  supportedCategories: ['cardloan', 'cryptocurrency', 'securities'],
};

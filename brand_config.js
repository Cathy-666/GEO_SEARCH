const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configPath = path.join(__dirname, 'demo-config.json');
function validateName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('品牌名称须为 1–60 个字符，不能包含换行或控制字符');
  return name;
}
const BRAND_NAME = validateName(fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')).brandName : '品牌');
const BRAND_ID = crypto.createHash('sha256').update(BRAND_NAME).digest('hex').slice(0, 16);
const DATA_ROOT = path.join(__dirname, 'data', BRAND_ID);
function getBrand(text) { return getBrandRank(text) > 0 ? [BRAND_NAME] : []; }
function resolveQuestion(text) { return String(text).replaceAll('{{品牌}}', BRAND_NAME); }
module.exports = { BRAND_NAME, BRAND_ID, DATA_ROOT, getBrand, resolveQuestion, validateName, configPath };
// 根据原版章节、表格与正文品牌顺序计算名次。
const rankCurrentBrand = require('./brand_ranking')(BRAND_NAME);
function getBrandRank(text) { return rankCurrentBrand(text); }
function isOwnReference(ref) { return String(ref.title || '').includes(BRAND_NAME); }
module.exports.getBrandRank = getBrandRank;
module.exports.isOwnReference = isOwnReference;

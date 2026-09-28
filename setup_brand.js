const fs = require('fs');
const readline = require('readline');
const { BRAND_NAME, validateName, configPath } = require('./brand_config');
async function main() {
  const idx = process.argv.indexOf('--name');
  let value;
  if (idx >= 0) value = process.argv[idx + 1];
  else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    value = await new Promise(resolve => rl.question(`请输入品牌名称（回车保留“${BRAND_NAME}”）：`, resolve));
    rl.close();
    value = value.trim() || BRAND_NAME;
  }
  const brandName = validateName(value);
  fs.writeFileSync(configPath, JSON.stringify({ brandName }, null, 2) + '\n');
  console.log(`已设置品牌：${brandName}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });

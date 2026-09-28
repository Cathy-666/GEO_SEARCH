const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
let files;
try { files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:__dirname,encoding:'utf8'}).split('\0').filter(Boolean); }
catch { console.error('请先在发布目录 git init，再运行检查。');process.exit(1); }
files=[...new Set(files)];
const bad=[];
for(const f of files){
 if(/(^|\/)(node_modules|chrome_cdp|data|\.env)(\/|$|\.)|(^|\/)(demo-config\.json|url_cache\.json)$|\.(log|zip)$/i.test(f))bad.push(f+': 禁止发布的运行文件');
 const file=path.join(__dirname,f);if(!fs.existsSync(file))continue;
 const text=fs.readFileSync(file,'utf8');
 if(/sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))bad.push(f+': 疑似密钥');
}
if(bad.length){console.error(bad.join('\n'));process.exit(1);}
console.log('PASS: '+files.length+' 个待发布文件，未发现被禁止的路径或常见密钥。');

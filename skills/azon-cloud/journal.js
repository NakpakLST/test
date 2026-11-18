const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const file = path.join(__dirname, 'run.json');
function save(x) { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(x, null, 2)); fs.renameSync(t, file); }
function col(i) { let n=i+3,s=''; while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)} return s; }
function init(urls) {
  if (fs.existsSync(file)) throw Error('Journal already exists');
  if (!Array.isArray(urls) || urls.length !== 54 || urls.some(u => typeof u !== 'string' || !/^https:\/\/www\.ozon\.ru\/product\//.test(u))) throw Error('Expected 54 exact product URLs');
  const inputs=urls.map((url,i)=>({column:col(i),url}));
  const x={version:1,started_at:new Date().toISOString(),source:'test!C5:BD5',digest:crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),inputs,attempts:[]}; save(x); return x;
}
function validate(x) {
  if (!x || x.version!==1 || !Array.isArray(x.inputs) || x.inputs.length!==54) throw Error('Invalid journal');
  if (crypto.createHash('sha256').update(JSON.stringify(x.inputs)).digest('hex')!==x.digest) throw Error('Input digest mismatch');
  if (x.inputs.some((a,i)=>a.column!==col(i))) throw Error('Input column mismatch');
  for (const a of x.attempts) { const src=x.inputs.find(i=>i.column===a.column); if(!src||src.url!==a.url) throw Error('Result mapping mismatch'); }
}
function ingest(x,records) {
  validate(x);
  if(!Array.isArray(records)||!records.length||records.length>5)throw Error('Invalid batch');
  const seen=new Set();
  for(const r of records){
    const src=x.inputs.find(i=>i.column===r.column); const prior=x.attempts.filter(a=>a.column===r.column);
    if(!src||src.url!==r.url||seen.has(r.column)||prior.some(a=>a.status==='ok'||a.status==='out_of_stock'))throw Error('Unexpected, duplicate or completed result');
    if(!['ok','out_of_stock','unavailable','infrastructure_error','blocked'].includes(r.status))throw Error('Invalid status');
    if(r.status==='ok'&&(!Number.isSafeInteger(r.price_rub)||r.price_rub<=0))throw Error('Invalid price');
    if(r.status!=='ok'&&r.price_rub!==null)throw Error('Unexpected price');
    if(prior.length && prior.at(-1).status!=='infrastructure_error')throw Error('Only infrastructure errors may be retried');
    if(prior.length>=3)throw Error('Retry limit exceeded'); seen.add(r.column);
  }
  x.attempts.push(...records.map(r=>({...r,recorded_at:new Date().toISOString()}))); save(x);
}
function pending(x){validate(x);if(x.attempts.some(a=>a.status==='blocked'))throw Error('Site verification: stop');return x.inputs.filter(i=>!x.attempts.some(a=>a.column===i.column)).slice(0,5)}
function recovery(x){validate(x);if(x.attempts.some(a=>a.status==='blocked'))throw Error('Site verification: stop');return x.inputs.filter(i=>{const a=x.attempts.filter(r=>r.column===i.column);return a.length>0&&a.length<3&&a.at(-1).status==='infrastructure_error'}).slice(0,1)}
function finish(x){validate(x); const records=x.inputs.map(i=>x.attempts.filter(a=>a.column===i.column).at(-1)); if(records.some(r=>!r||!['ok','out_of_stock'].includes(r.status)))throw Error('Incomplete or unresolved: write forbidden'); return records;}
if(require.main===module){try{const cmd=process.argv[2];if(cmd==='init'){init(JSON.parse(fs.readFileSync(process.argv[3],'utf8'))); console.log('initialized');}else{const x=JSON.parse(fs.readFileSync(file,'utf8'));if(cmd==='next')console.log(JSON.stringify(pending(x)));else if(cmd==='recovery')console.log(JSON.stringify(recovery(x)));else if(cmd==='ingest')ingest(x,JSON.parse(fs.readFileSync(0,'utf8')));else if(cmd==='validate')console.log(JSON.stringify(finish(x)));else throw Error('Unknown command');}}catch(e){console.error(e.message);process.exitCode=1}}
module.exports={init,validate,ingest,pending,recovery,finish,col};

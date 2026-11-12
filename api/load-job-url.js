import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

const MAX_BYTES = 1_500_000;
const COOKIE_NAME = 'leic_session';

function safeEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
function authenticated(req) {
  const secret=process.env.SESSION_SECRET;
  if (!secret || typeof req.headers.cookie!=='string') return false;
  const cookie=req.headers.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE_NAME+'='));
  const match=cookie && /^v1\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(cookie.slice(COOKIE_NAME.length+1));
  if (!match) return false;
  const exp=Number(match[1]), now=Math.floor(Date.now()/1000);
  if (!Number.isSafeInteger(exp)||exp<=now||exp>now+28800) return false;
  return safeEqual(match[2],createHmac('sha256',secret).update('v1.'+match[1]).digest('base64url'));
}
function isPublicIPv4(ip) {
  if (net.isIP(ip)!==4) return false;
  const [a,b,c]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||
    a===172&&b>=16&&b<=31||a===192&&b===168||
    a===100&&b>=64&&b<=127||a===192&&b===0&&c===0||
    a===192&&b===0&&c===2||a===198&&b===18||a===198&&b===19||
    a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
function validateUrl(value) {
  if (typeof value!=='string'||value.length>2048) throw Error('Invalid URL.');
  let url;
  try { url=new URL(value); } catch { throw Error('Invalid URL.'); }
  if (url.protocol!=='https:'||url.port||url.username||url.password||!url.hostname||
      url.hostname==='localhost'||url.hostname.endsWith('.localhost')||
      url.hostname.endsWith('.local')||net.isIP(url.hostname)) {
    throw Error('Use a public HTTPS job posting URL without a custom port.');
  }
  return url;
}
function decodeEntities(s) {
  return s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
    const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
  }).replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi,m=>({
    '&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"
  })[m.toLowerCase()]||m);
}
function plainText(html) {
  // Preserve semantic breaks before removing HTML. Structured JobPosting
  // descriptions often contain HTML encoded as a JSON string.
  let text = String(html || '')
    .replace(/<\s*(?:script|style|nav|footer|header|svg|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|nav|footer|header|svg|noscript)\s*>/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<\s*br\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<\s*h[1-6]\b[^>]*>/gi, '\n\n')
    .replace(/<\s*\/\s*h[1-6]\s*>/gi, '\n')
    .replace(/<\s*(?:p|section|article|blockquote)\b[^>]*>/gi, '\n\n')
    .replace(/<\s*\/\s*(?:p|section|article|blockquote)\s*>/gi, '\n\n')
    .replace(/<\s*\/\s*(?:div|ul|ol|table|tr)\s*>/gi, '\n')
    .replace(/<\s*(?:td|th)\b[^>]*>/gi, '  ')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text).replace(/\u00a0/g, ' ').replace(/\r/g, '');
  // Some feeds HTML-encode the description twice.
  if (/<\/?(?:p|div|ul|ol|li|br|h[1-6])\b/i.test(text)) {
    text = text.replace(/<\s*br\b[^>]*\/?\s*>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '\n• ')
      .replace(/<\s*\/\s*(?:li|p|div|ul|ol|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
  }
  return text.split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// Some job boards publish JSON-LD descriptions as a single plain-text paragraph.
// In that case, there are no HTML tags to preserve: add readable paragraph breaks
// without paraphrasing, removing requirements, or invoking AI.
function formatDescription(value) {
  const original = String(value || '');
  const formatted = plainText(original);
  if (!formatted || formatted.includes('\n')) return formatted;
  if (formatted.length < 350) return formatted;

  // Split only at likely sentence endings, not at decimal points or abbreviations.
  const sentences = formatted.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [formatted];
  const sections = [];
  let paragraph = [];
  let count = 0;
  const flush = () => {
    if (paragraph.length) sections.push(paragraph.join(' ').trim());
    paragraph = [];
    count = 0;
  };
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    // Do not discard short sentences or alter their words.
    if (count >= 280 || (count >= 155 && paragraph.length >= 2)) flush();
    paragraph.push(sentence);
    count += sentence.length + 1;
  }
  flush();
  return sections.join('\n\n');
}
function textValue(v) {
  if (typeof v==='string') return plainText(v);
  if (v && typeof v==='object') return textValue(v.name||v.value||'');
  return '';
}
function findPosting(value) {
  if (!value||typeof value!=='object') return null;
  if (Array.isArray(value)) { for (const item of value) { const found=findPosting(item); if(found) return found; } return null; }
  const type=value['@type'];
  if ((Array.isArray(type)?type:[type]).some(t=>typeof t==='string'&&t.toLowerCase().endsWith('jobposting')) && value.description) return value;
  for (const key of ['@graph','mainEntity','itemListElement']) {
    const found=findPosting(value[key]); if(found) return found;
  }
  return null;
}
function extract(html) {
  const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const job=findPosting(JSON.parse(script[1].trim()));
      if (!job) continue;
      const description=formatDescription(job.description);
      if (description.length<100) continue;
      return {title:textValue(job.title),company:textValue(job.hiringOrganization),description:description.slice(0,20000),source:'structured'};
    } catch { /* Try another script. */ }
  }
  const main=/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ||
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || '';
  const description=formatDescription(main);
  if (description.length<250) throw Error('No complete public job description was found on this page.');
  const title=decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]||'').trim();
  return {title:title.slice(0,120),company:'',description:description.slice(0,20000),source:'page'};
}
async function download(url, redirects=0) {
  if (redirects>3) throw Error('Too many redirects.');
  const addresses=await resolve4(url.hostname);
  if (!addresses.length||addresses.some(ip=>!isPublicIPv4(ip))) throw Error('This destination is not permitted.');
  const ip=addresses[0];
  return await new Promise((resolve,reject)=>{
    const req=https.get(url,{
      lookup:(_hostname,options,callback)=>{
        if (options?.all) callback(null,[{address:ip,family:4}]);
        else callback(null,ip,4);
      },
      timeout:8000,
      headers:{'User-Agent':'LiveEvidenceInterviewCoach/1.0 (job posting reader)','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'}
    },res=>{
      const status=res.statusCode||0;
      if ([301,302,303,307,308].includes(status)) {
        const location=res.headers.location; res.resume();
        if (!location) return reject(Error('Redirect missing destination.'));
        let next; try { next=validateUrl(new URL(location,url).href); } catch(e) { return reject(e); }
        return resolve(download(next,redirects+1));
      }
      if (status!==200) { res.resume(); return reject(Error(`The website returned HTTP ${status}.`)); }
      if (!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type']||'')) {
        res.resume(); return reject(Error('The URL did not return an HTML page.'));
      }
      const chunks=[];let total=0;
      res.on('data',chunk=>{
        total+=chunk.length;
        if(total>MAX_BYTES){res.destroy(Error('The page exceeds the size limit.'));return;}
        chunks.push(chunk);
      });
      res.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),url:url.href}));
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('The website took too long to respond.')));
    req.on('error',reject);
  });
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed.'});}
  if(!authenticated(req)) return res.status(401).json({error:'Please sign in first.'});
  if(req.headers.origin!==`https://${req.headers.host}`) return res.status(403).json({error:'Invalid request origin.'});
  try {
    const url=validateUrl(req.body?.url);
    const downloaded=await download(url);
    return res.status(200).json({...extract(downloaded.html),url:downloaded.url});
  } catch(error) {
    const message=String(error?.message||'Unable to retrieve this page.').slice(0,180);
    return res.status(422).json({error:message});
  }
}

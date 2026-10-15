// Leitor mínimo de .xlsx: valores, datas seriais e cor de preenchimento das células, sem bibliotecas.
// TextDecoder criado sob demanda: os testes da interface carregam este módulo sem essa global.
const decode=bytes=>new TextDecoder().decode(bytes);
async function inflate(bytes){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new Uint8Array(await new Response(stream).arrayBuffer());}
async function unzip(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Arquivo não é uma planilha .xlsx válida.');
 // Os tamanhos vêm do diretório central: Excel e Google Planilhas podem zerá-los no cabeçalho local.
 let p=v.getUint32(end+16,true);
 for(let n=v.getUint16(end+10,true);n>0;n--){
  if(v.getUint32(p,true)!==0x02014b50)throw Error('Arquivo não é uma planilha .xlsx válida.');
  const method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),nameLen=v.getUint16(p+28,true),local=v.getUint32(p+42,true);
  const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);
  files.set(decode(bytes.subarray(p+46,p+46+nameLen)),{method,data:bytes.subarray(start,start+size)});
  p+=46+nameLen+v.getUint16(p+30,true)+v.getUint16(p+32,true);
 }
 return async name=>{const f=files.get(name);if(!f)return null;if(f.method===0)return decode(f.data);if(f.method===8)return decode(await inflate(f.data));throw Error('Compactação da planilha não suportada.');};
}
export function colorName(rgb){
 if(!/^([0-9A-Fa-f]{2})?[0-9A-Fa-f]{6}$/.test(rgb||''))return null;
 const h=rgb.slice(-6),[r,g,b]=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)),max=Math.max(r,g,b),d=max-Math.min(r,g,b);
 if(d<30)return null;
 const hue=max===r?60*(((g-b)/d+6)%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);
 return hue>=40&&hue<75?'yellow':hue>=75&&hue<=170?'green':null;
}
const byTag=(node,tag)=>[...node.getElementsByTagName(tag)];
const colIndex=ref=>{let n=0;for(const ch of ref.match(/^[A-Z]+/)[0])n=n*26+ch.charCodeAt(0)-64;return n-1;};
export async function parseWorkbook(bytes,Parser=globalThis.DOMParser){
 let read;try{read=await unzip(bytes);}catch{throw Error('Arquivo não é uma planilha .xlsx válida.');}
 const xml=async name=>{try{const t=await read(name);if(t==null)return null;const doc=new Parser().parseFromString(t,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error();return doc;}catch{throw Error('Arquivo não é uma planilha .xlsx válida.');}};
 const wb=await xml('xl/workbook.xml');if(!wb)throw Error('Arquivo não é uma planilha .xlsx válida.');
 const [rels,strings,styles]=await Promise.all(['xl/_rels/workbook.xml.rels','xl/sharedStrings.xml','xl/styles.xml'].map(xml));
 const shared=strings?byTag(strings,'si').map(si=>byTag(si,'t').map(t=>t.textContent).join('')):[];
 const fillList=styles&&byTag(styles,'fills')[0],fills=fillList?byTag(fillList,'fill').map(f=>colorName(byTag(f,'fgColor')[0]?.getAttribute('rgb'))):[];
 const xfList=styles&&byTag(styles,'cellXfs')[0],xfs=xfList?byTag(xfList,'xf').map(x=>fills[Number(x.getAttribute('fillId')||0)]??null):[];
 const targets=new Map(rels?byTag(rels,'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]):[]);
 const date1904=['1','true'].includes(byTag(wb,'workbookPr')[0]?.getAttribute('date1904'));
 for(const sheet of byTag(wb,'sheet')){
  const target=targets.get(sheet.getAttribute('r:id'));if(!target)continue;
  const doc=await xml(target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,''));if(!doc)continue;
  const rows=[];let previous=-1;
  for(const row of byTag(doc,'row')){
   let r=row.hasAttribute('r')?Number(row.getAttribute('r'))-1:previous+1;
   for(const c of byTag(row,'c')){
    const ref=c.getAttribute('r');if(ref)r=Number(ref.match(/\d+$/)[0])-1;
    const col=ref?colIndex(ref):(rows[r]?.length??0),type=c.getAttribute('t'),raw=byTag(c,'v')[0]?.textContent;
    let value=null;
    if(type==='s')value=raw==null?null:shared[Number(raw)]??null;else if(type==='inlineStr')value=byTag(c,'t').map(t=>t.textContent).join('');else if(type==='str')value=raw??null;else if(!type||type==='n')value=raw==null||raw===''?null:Number(raw);
    if(typeof value==='string'&&!value.trim())value=null;
    (rows[r]??=[])[col]={value,color:xfs[Number(c.getAttribute('s')||0)]??null};
   }
   previous=r;
  }
  if(rows.some(r=>r?.some(c=>c?.value!=null)))return {sheetName:sheet.getAttribute('name'),rows,date1904};
 }
 throw Error('A planilha não tem dados.');
}

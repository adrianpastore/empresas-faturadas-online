import {blankRecord,monthKey,shiftMonth,parseMoney} from './domain.js';
const BOLETO=/\s*[\/\\|\-–—]*\s*\bboleto\b\s*[\/\\|\-–—]*\s*/gi;
const label=m=>m.split('-').reverse().join('/');
export function cleanName(raw){
 const text=String(raw).replace(/\s+/g,' ').trim(),positions=[];
 let normalized='',offset=0;
 // Os índices normalizados apontam para o nome original, preservando seus acentos.
 for(const char of text){
  const plain=char.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  for(let i=0;i<plain.length;i++)positions.push(offset);
  normalized+=plain;offset+=char.length;
 }
 const matches=[...normalized.matchAll(BOLETO)];
 let name=text;
 for(const match of matches.reverse()){
  const start=positions[match.index],end=positions[match.index+match[0].length]??text.length;
  name=name.slice(0,start)+' '+name.slice(end);
 }
 name=name.replace(/\s+/g,' ').trim();
 return {name:name||text,boleto:matches.length>0};
}
export const nameKey=raw=>cleanName(raw).name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\/\\|\-–—.,]+/g,' ').replace(/\s+/g,' ').trim();
export function serialMonth(serial,date1904=false){if(typeof serial!=='number'||!Number.isFinite(serial)||serial<1)return null;const d=new Date(Date.UTC(1899,11,30)+Math.floor(serial+(date1904?1462:0))*86400000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}
export function planImport({rows,date1904=false},data,newId=()=>crypto.randomUUID()){
 const warnings=[],pairs=[],width=Math.max(0,...rows.map(r=>r?.length||0));
 // Cada par de colunas (Data | Valor) é uma cobrança; a data mais comum cobre linhas sem data.
 for(let c=1;c<width;c+=2){const counts=new Map();for(const row of rows.slice(1)){const m=serialMonth(row?.[c]?.value,date1904);if(m)counts.set(m,(counts.get(m)||0)+1);}pairs.push({date:c,value:c+1,common:[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||null});}
 const known=new Map(data.companies.map(c=>[nameKey(c.name),c])),entries=new Map();
 for(const row of rows.slice(1)){
  const raw=row?.[0]?.value;if(typeof raw!=='string'||!raw.trim())continue;
  const key=nameKey(raw);let e=entries.get(key);
  if(!e){const existing=known.get(key),{name,boleto}=cleanName(raw);e={existing,name:existing?.name||name,method:existing?.method||(boleto?'boleto':'deposito'),months:new Map()};entries.set(key,e);}
  for(const p of pairs){
   const cell=row?.[p.value];if(cell?.value==null)continue;
   const date=row?.[p.date]?.value,rowMonth=serialMonth(date,date1904);
   if(date!=null&&rowMonth===null)warnings.push(`${e.name}: data "${date}" inválida; usada a data mais comum da coluna.`);
   const base=rowMonth||p.common;
   if(!base){warnings.push(`${e.name}: valor sem data, não importado.`);continue;}
   const month=shiftMonth(base,-1);let amount;
   if(typeof cell.value==='number')amount=Math.round(cell.value*100);else try{if(/[\d.,]\s+[\d.,]/.test(String(cell.value)))throw Error("espaço");amount=parseMoney(cell.value);}catch{warnings.push(`${e.name} (${label(month)}): "${cell.value}" não é um valor. Lance à mão.`);continue;}
   if(!(amount>0)){warnings.push(`${e.name} (${label(month)}): valor zero ou negativo, não importado.`);continue;}
   if(!Number.isSafeInteger(amount)||amount>=1e11){warnings.push(`${e.name} (${label(month)}): valor fora do limite, não importado.`);continue;}
   if(e.months.has(month)){warnings.push(`${e.name} (${label(month)}): dois valores no mesmo mês; mantido o primeiro.`);continue;}
   if(!cell.color)warnings.push(`${e.name} (${label(month)}): valor sem cor, importado como em aberto.`);
   e.months.set(month,{amount,paid:cell.color==='green'});
  }
 }
 if(!entries.size)throw Error('Nenhuma empresa encontrada na coluna A da planilha.');
 const first=[...entries.values()].flatMap(e=>[...e.months.keys()]).sort()[0]||monthKey(),companies=[],records={},preview=[];
 for(const e of entries.values()){
  const id=e.existing?.id||newId(),months=[...e.months].sort(([a],[b])=>a.localeCompare(b));
  if(!e.existing){companies.push({id,name:e.name,method:e.method,dueDay:10,contacts:[],startMonth:first,cnpj:'',legalName:''});if(!months.length)warnings.push(`${e.name}: sem valores na planilha; cadastrada para os próximos meses.`);}
  else if(e.existing.startMonth&&months.length&&months[0][0]<e.existing.startMonth)companies.push({...e.existing,startMonth:months[0][0]});
  preview.push({id,name:e.name,method:e.method,isNew:!e.existing,months:months.map(([month,v])=>{const kept=(data.records[`${id}:${month}`]?.launch??'pending')!=='pending';if(kept)warnings.push(`${e.name} (${label(month)}): já lançado no site, mantido.`);else records[`${id}:${month}`]={...blankRecord(),launch:'launched',amount:v.amount,paid:v.paid};return {month,...v,kept};})});
 }
 return {companies,records,preview,warnings};
}

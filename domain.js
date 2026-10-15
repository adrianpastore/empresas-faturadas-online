export const monthKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
export function shiftMonth(key,n){const [y,m]=key.split('-').map(Number);return monthKey(new Date(y,m-1+n,1));}
export const blankRecord=()=>({launch:'pending',amount:0,paid:false,receipt:'pending',boleto:false,due:'',note:'',invoice:'',paidDate:''});
export function gridMonths(companies,records,today=new Date()){
 const current=monthKey(today),end=shiftMonth(current,2);
 const starts=companies.length?[...companies.map(c=>c.startMonth).filter(Boolean),...Object.entries(records).filter(([,r])=>r.launch!=='pending').map(([k])=>k.slice(k.lastIndexOf(':')+1))]:[];
 const start=(starts.length?starts:[current]).sort()[0],months=[];for(let m=start;m<=end;m=shiftMonth(m,1))months.push(m);return months;
}
export function applyAmount(record,input,company,month){
 const text=String(input).trim().replace(/\s|R\$/g,''),kept={note:record.note};
 for(const k of ['attachments','lastContactAt','lastContactName'])if(Object.hasOwn(record,k))kept[k]=record[k];
 if(!text||/^0+(,0{1,2})?$/.test(text))return {...blankRecord(),...kept,launch:text?'none':'pending'};
 const amount=parseMoney(input);if(record.launch==='launched')return {...record,amount};
 const [y,m]=month.split('-').map(Number),day=Math.min(company.dueDay,new Date(y,m,0).getDate());
 return {...blankRecord(),...kept,launch:'launched',amount,due:`${month}-${String(day).padStart(2,'0')}`};
}
export function togglePaid(record,today=new Date()){
 if(record.launch!=='launched')return {...record};
 return {...record,paid:!record.paid,paidDate:record.paid?'':`${monthKey(today)}-${String(today.getDate()).padStart(2,'0')}`};
}
export const recordFor=(data,id,month)=>data.records[`${id}:${month}`]||blankRecord();
export const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
export function parseMoney(value){const s=String(value).trim().replace(/\s|R\$/g,'');if(!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(s))throw Error('Use um valor como 1.250,50.');const n=Math.round(Number(s.replaceAll('.','').replace(',','.'))*100);if(!Number.isSafeInteger(n)||n<=0)throw Error('Informe um valor maior que zero.');return n;}
export const onlyDigits=v=>String(v??'').replace(/\D/g,'');
export function isValidCnpj(value){const d=onlyDigits(value);if(!/^\d{14}$/.test(d)||/^(\d)\1{13}$/.test(d))return false;const digit=n=>{let sum=0,w=n-7;for(let i=0;i<n;i++){sum+=Number(d[i])*w--;if(w<2)w=9;}const r=sum%11;return r<2?0:11-r;};return digit(12)===Number(d[12])&&digit(13)===Number(d[13]);}
export const formatCnpj=d=>String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
export function boletoMessage(c,r,now=new Date()){
 if(!c.legalName?.trim()||!c.cnpj)throw Error('Cadastre a razão social e o CNPJ da empresa para gerar a mensagem do boleto.');
 if(!(r.amount>0))throw Error('Lance o valor do mês para gerar a mensagem do boleto.');
 const due=new Date(now.getFullYear(),now.getMonth(),now.getDate()+7),day=`${String(due.getDate()).padStart(2,'0')}/${String(due.getMonth()+1).padStart(2,'0')}/${due.getFullYear()}`;
 return `Emitir boleto contra ${c.legalName.trim()} de CNPJ ${formatCnpj(c.cnpj)} no valor de ${money(r.amount).replace(/\s/g,' ')}, com vencimento para dia ${day}, obrigado e fico no aguardo do retorno!`;
}
export function validateData(d){
  if(!d||d.version!==1||!Array.isArray(d.companies)||!d.records||typeof d.records!=='object'||Array.isArray(d.records))throw Error('Backup inválido.');
  const ids=new Set();
  for(const c of d.companies){if(typeof c.id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(c.id)||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>120||!['boleto','deposito'].includes(c.method)||!Array.isArray(c.contacts)||c.contacts.length>10||!c.contacts.every(x=>typeof x.name==='string'&&typeof x.phone==='string')||!Number.isInteger(c.dueDay)||c.dueDay<1||c.dueDay>31||(c.startMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(c.startMonth))||(c.cnpj!==undefined&&(typeof c.cnpj!=='string'||!/^(\d{14})?$/.test(c.cnpj)))||(c.legalName!==undefined&&(typeof c.legalName!=='string'||c.legalName.length>160)))throw Error('Empresa inválida no backup.');ids.add(c.id);}
  for(const [key,r] of Object.entries(d.records)){
    const i=key.lastIndexOf(':');if(!ids.has(key.slice(0,i))||!/^\d{4}-(0[1-9]|1[0-2])$/.test(key.slice(i+1))||!r||!['pending','launched','none'].includes(r.launch)||!Number.isSafeInteger(r.amount)||r.amount<0||typeof r.paid!=='boolean'||typeof r.boleto!=='boolean'||!['pending','requested','received','na'].includes(r.receipt)||!['due','note','invoice','paidDate'].every(x=>typeof r[x]==='string')||(r.launch!=='launched'&&(r.amount!==0||r.paid||r.boleto))||(r.launch==='launched'&&r.amount<=0))throw Error('Lançamento inválido no backup.');
    if(r.attachments!==undefined&&(!Array.isArray(r.attachments)||r.attachments.length>10||r.attachments.some(a=>!a||typeof a.id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(a.id)||typeof a.name!=='string'||!['application/pdf','image/jpeg','image/png','image/webp'].includes(a.mime)||!Number.isInteger(a.size)||a.size<1||a.size>614400)))throw Error('Anexos inválidos no backup.');
  }
  return d;
}
export function validateRestore(d){
 validateData(d);if(d.companies.some(c=>c.fictional||c.id.startsWith('demo-')))throw Error('Backups de demonstração não podem substituir os dados reais.');
 const refs=Object.values(d.records).flatMap(r=>r.attachments||[]),files=d.attachmentFiles||[];
 if(!Array.isArray(files))throw Error('Arquivos do backup inválidos.');
 const ids=new Set();for(const f of files){if(!f||ids.has(f.id)||!refs.some(a=>a.id===f.id&&a.name===f.name&&a.size===f.size&&a.mime===f.mime)||typeof f.content!=='string'||f.content.length>819200||! /^[A-Za-z0-9+/]*={0,2}$/.test(f.content))throw Error('Arquivo do backup inválido.');ids.add(f.id);}
 if(refs.some(a=>!ids.has(a.id)))throw Error('O backup não contém todos os anexos. Baixe um backup completo antes de restaurar.');
 return d;
}
export function summary(data,month){return data.companies.reduce((s,c)=>{const r=recordFor(data,c.id,month);if(r.launch==='pending')s.pending++;if(r.launch==='none')s.none++;if(r.launch==='launched'){s.total+=r.amount;if(r.paid)s.paid+=r.amount;else s.open+=r.amount;if(r.receipt==='requested')s.receipts++;}return s;},{total:0,paid:0,open:0,pending:0,none:0,receipts:0});}

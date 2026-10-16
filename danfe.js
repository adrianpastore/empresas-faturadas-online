import {isValidCnpj,onlyDigits,parseMoney,shiftMonth} from './domain.js';
export async function readPdfItems(file,loader=()=>import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs')){
 let pdf;try{pdf=await loader();}catch{throw Error('Não foi possível carregar o leitor de PDF. Confira a internet e tente de novo.');}
 try{
  pdf.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,items=[];
  try{
   for(let page=1;page<=doc.numPages;page++){
    const content=await (await doc.getPage(page)).getTextContent();
    for(const i of content.items)if(i.str?.trim())items.push({str:i.str,x:i.transform[4],y:i.transform[5],page});
   }
   if(!items.length)throw Error('Não foi possível ler este PDF. Use o PDF gerado pelo emissor da nota.');
   return items;
  }finally{await doc.destroy();}
 }catch(e){throw Error(e.name==='PasswordException'?'Este PDF tem senha. Use o PDF da nota sem senha.':'Não foi possível ler este PDF. Use o PDF gerado pelo emissor da nota.');}
}
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const date=s=>{const m=s.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';};
const amount=s=>{try{return parseMoney(s);}catch{return 0;}};
const accessKey=s=>s.replace(/\s/g,'').match(/(?<!\d)\d{44}(?!\d)/)?.[0]||'';
export function parseDanfe(items){
 items=items.filter(i=>i.str?.trim());
 const result={key:'',number:'',issued:'',cnpj:'',legalName:'',total:0,emitterCnpj:''};
 const labels=(...names)=>items.filter(i=>names.includes(normalize(i.str)));
 const below=label=>label?items.filter(i=>i.page===label.page&&i.y>=label.y-16&&i.y<=label.y-4&&i.x>=label.x-12&&i.x<=label.x+140).sort((a,b)=>Math.hypot(a.x-label.x,a.y-label.y)-Math.hypot(b.x-label.x,b.y-label.y))[0]?.str||'':'';
 for(const label of labels('CHAVE DE ACESSO')){result.key=accessKey(below(label));if(result.key)break;}
 if(!result.key)for(const i of items){result.key=accessKey(i.str);if(result.key)break;}
 result.emitterCnpj=result.key.slice(6,20);
 const title=labels('DESTINATARIO / REMETENTE')[0];
 const recipientLabel=(...names)=>title?labels(...names).filter(i=>i.page===title.page&&i.y<title.y).sort((a,b)=>b.y-a.y)[0]:null;
 result.legalName=below(recipientLabel('RAZAO SOCIAL','NOME / RAZAO SOCIAL')).trim();
 const cnpj=onlyDigits(below(recipientLabel('CNPJ / CPF')));
 if(isValidCnpj(cnpj)&&cnpj!==result.emitterCnpj)result.cnpj=cnpj;
 if(cnpj.length===11)result.warnings=['Destinatário com CPF. O CNPJ não foi preenchido.'];
 else if(cnpj&&!result.cnpj&&cnpj!==result.emitterCnpj)result.warnings=['CNPJ do destinatário inválido na nota. Confira e preencha o cadastro à mão.'];
 result.issued=date(below(labels('DATA DE EMISSAO','DATA DA EMISSAO')[0]));
 result.total=amount(below(labels('VALOR TOTAL DA NOTA')[0]));
 for(const i of items){const m=i.str.match(/N[º°o]\.?:?\s*([\d.]+)/);if(m){result.number=m[1].replace(/\./g,'').replace(/^0+(?=\d)/,'');break;}}
 // O canhoto pode vir dividido em duas linhas e fora da ordem de leitura.
 const firstPage=items.length?Math.min(...items.map(i=>i.page??1)):1;
 const page=items.filter(i=>(i.page??1)===firstPage),top=page.length?Math.max(...page.map(i=>i.y)):0;
 const receipt=page.find(i=>i.y>=top-40&&/EMISSAO\s*:/.test(normalize(i.str)));
 if(receipt){
  const text=page.filter(i=>Math.abs(i.y-receipt.y)<=16).sort((a,b)=>b.y-a.y||a.x-b.x).map(i=>i.str).join(' ');
  if(!result.issued)result.issued=date(text.match(/Emiss[aã]o\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]||'');
  if(!result.total)result.total=amount(text.match(/Valor Total\s*:\s*R\$\s*([\d.,]+)/i)?.[1]||'');
  if(!result.legalName)result.legalName=text.match(/Destinat[aá]rio\s*:\s*(.+)$/i)?.[1].trim()||'';
 }
 return result;
}
export const invoiceMonth=issued=>issued?shiftMonth(issued.slice(0,7),-1):'';

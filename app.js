import {monthKey,shiftMonth,blankRecord,recordFor,money,parseMoney,summary,validateData,onlyDigits,isValidCnpj,formatCnpj,boletoMessage,gridMonths,applyAmount,togglePaid,duplicateInvoice} from './domain.js';
import {initialDemo,retireDemo,shouldShowDemo} from './demo.js';
import * as cloud from './cloud.js';
import {parseWorkbook} from './xlsx.js';import {planImport,nameKey} from './importer.js';
import {readPdfItems,parseDanfe,invoiceMonth} from './danfe.js';
const $=s=>document.querySelector(s), KEY='empresas-faturadas-v1';
let layout='list';try{if(localStorage.getItem('layout')==='grid')layout='grid';}catch{}
let data={version:1,hasRealData:false,companies:[],records:{}},month=monthKey(),view='all',editing=null,demo=false,ready=false,user=null,contactCompany=null,importing=null,session=0;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthName=k=>new Date(k+'-02T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
const today=()=>{const d=new Date();return `${monthKey(d)}-${String(d.getDate()).padStart(2,'0')}`;};
const badge=(text,color)=>`<span class="badge ${color}">${text}</span>`;
let toastTimer;function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function requireReady(){if(!user)throw Error('Entre com sua conta Google para continuar.');if(!ready)throw Error('Aguarde a sincronização do banco.');}
function rememberReal(){try{localStorage.setItem(KEY+'-real-'+user.uid,'true');}catch{}}
function acceptData(next){ready=true;let retired=false;try{retired=localStorage.getItem(KEY+'-real-'+user.uid)==='true';}catch{}if(next.hasRealData||next.companies.length)rememberReal();demo=shouldShowDemo(next,retired);data=demo?initialDemo():next;render();$('#sync-status').textContent='● Sincronizado com Firebase';}
const activeCompanies=()=>data.companies.filter(c=>!c.startMonth||c.startMonth<=month);
function render(){
  $('#month').value=month;
  const visibleData={...data,companies:activeCompanies()},s=summary(visibleData,month);
  for(const k of ['total','paid','open'])$('#'+k).textContent=money(s[k]);
  $('#pending').textContent=s.pending;$('#pending-count').textContent=s.pending;
  $('#company-count').textContent=`${visibleData.companies.length} empresas`;
  $('#footer-month').textContent=monthName(month);
  const start=new Date().getDate()<=5&&month===monthKey();
  $('#reminder').className='reminder'+(s.pending?'':' done');
  $('#reminder').innerHTML=s.pending?`<span aria-hidden="true">◷</span><div><strong>${start?'Início do mês: hora de lançar as notas.':`${s.pending} ${s.pending===1?'empresa precisa':'empresas precisam'} de conferência.`}</strong><p>Confira as notas de ${esc(monthName(month))}. Sem movimento? Marque “Não teve compras”.</p></div><button class="quiet" id="review-pending">Conferir pendências →</button>`:`<span aria-hidden="true">✓</span><div><strong>${visibleData.companies.length?'Todas as empresas foram conferidas.':'Seu próximo mês organizado começa aqui.'}</strong><p>${visibleData.companies.length?`${s.none} sem compras neste mês. Acompanhe os pagamentos abaixo.`:'Cadastre as empresas e lance os valores da competência selecionada.'}</p></div>`;
  $('#review-pending')?.addEventListener('click',()=>setView('pending'));
  $('#list-title').textContent=({all:'Empresas do mês',pending:'Notas pendentes',receipts:'Comprovantes para conferir'})[view];
  $('#list-subtitle').textContent=({all:'Acompanhe cada etapa do faturamento.',pending:'Lance a nota ou registre que não houve compras.',receipts:'Confira recebimentos e solicite os comprovantes que faltam.'})[view];
  const query=$('#search').value.toLocaleLowerCase('pt-BR'),filter=$('#filter').value;
  const companies=visibleData.companies.filter(c=>{
    const r=recordFor(data,c.id,month),launched=r.launch==='launched';
    if(view==='pending'&&r.launch!=='pending')return false;
    if(view==='receipts'&&(!launched||['received','na'].includes(r.receipt)))return false;
    if(![c.name,...c.contacts.map(x=>x.name+' '+x.phone)].join(' ').toLocaleLowerCase('pt-BR').includes(query))return false;
    return ({all:true,unpaid:launched&&!r.paid,paid:launched&&r.paid,requested:launched&&r.receipt==='requested','missing-receipt':launched&&!['received','na'].includes(r.receipt),boleto:launched&&r.boleto,'missing-boleto':launched&&c.method==='boleto'&&!r.boleto,pending:r.launch==='pending',none:r.launch==='none'})[filter];
  }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  $('#rows').innerHTML=companies.map(c=>{
    const r=recordFor(data,c.id,month),on=r.launch==='launched',overdue=on&&!r.paid&&r.due&&r.due<today();
    const initial=c.name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    return `<tr><td><div class="company-cell"><span class="avatar">${esc(initial)}</span><div><div class="company-name">${esc(c.name)}</div><div class="contact">${esc(c.contacts[0]?.name||'Sem contato cadastrado')}${c.contacts.length>1?` · +${c.contacts.length-1}`:''}</div></div></div></td><td><div class="value">${on?money(r.amount):'—'}</div><div class="subline">${r.launch==='pending'?'Nota pendente':r.launch==='none'?'Não teve compras':r.due?'Vence '+r.due.split('-').reverse().join('/'):'Sem vencimento'}</div></td><td>${on?badge(r.paid?'✓ Pago':overdue?'Em atraso':'Em aberto',r.paid?'green':overdue?'red':'amber'):badge('—','gray')}</td><td>${on?badge(({pending:'Pendente',requested:'Aguardando envio',received:'✓ Recebido',na:'Não necessário'})[r.receipt],({pending:'gray',requested:'amber',received:'green',na:'gray'})[r.receipt]):badge('—','gray')}</td><td>${on&&c.method==='boleto'?badge(r.boleto?'✓ Emitido':'Para emitir',r.boleto?'blue':'amber'):badge(c.method==='deposito'?'Depósito':'—','gray')}</td><td><div class="row-actions"><button data-action="record" data-id="${esc(c.id)}">${r.launch==='pending'?'Lançar':'Editar mês'}</button><button data-action="contact" data-id="${esc(c.id)}" class="wa" aria-label="WhatsApp de ${esc(c.name)}">WhatsApp ↗</button><button data-action="company" data-id="${esc(c.id)}" aria-label="Editar cadastro de ${esc(c.name)}">⋯</button></div></td></tr>`;
  }).join('');
  const labels=['Empresa / contato','Valor do mês','Pagamento','Comprovante','Boleto','Ações'];$('#rows').querySelectorAll('tr').forEach(tr=>{[...tr.children].forEach((td,i)=>td.dataset.label=labels[i]);const id=tr.querySelector('[data-id]').dataset.id;const c=data.companies.find(c=>c.id===id),r=recordFor(data,id,month);const button=document.createElement('button');button.dataset.action='details';button.dataset.id=id;button.textContent='Anexos / histórico';tr.querySelector('.row-actions').append(button);if(c.method==='boleto'&&r.launch==='launched'&&!r.boleto){const copy=document.createElement('button');copy.dataset.action='boleto';copy.dataset.id=id;copy.textContent='Copiar mensagem do boleto';tr.querySelector('.row-actions').append(copy);}if(r.lastContactAt){const line=document.createElement('div');line.className='subline';line.textContent='Última cobrança: '+new Date(r.lastContactAt).toLocaleDateString('pt-BR');tr.querySelector('.company-name').parentNode.append(line);}});
  $('#empty').hidden=companies.length>0;
  if(!companies.length)$('#empty').innerHTML=!user?'<div class="empty-icon">▤</div><h3>Seu financeiro, onde você estiver.</h3><p>Entre com sua conta Google para acessar o controle da padaria.<br>As informações são compartilhadas entre seu celular e computador.</p><button class="primary" id="empty-login">Entrar com Google</button>':data.companies.length?'<div class="empty-icon">⌕</div><h3>Nenhuma empresa nesta lista.</h3><p>Confira a competência, a busca ou os filtros selecionados.</p>':'<div class="empty-icon">▤</div><h3>Vamos organizar o faturamento?</h3><p>Cadastre sua primeira empresa para acompanhar valores,<br>notas, pagamentos e comprovantes todos os meses.</p><button class="primary" id="empty-new">＋ Cadastrar primeira empresa</button>';
  $('#empty-new')?.addEventListener('click',()=>openCompany());$('#empty-login')?.addEventListener('click',signIn);
  $('#shown-count').textContent=`${companies.length} de ${visibleData.companies.length} empresas`;
  $('#demo-banner').hidden=!demo;
  if(demo)$('#demo-banner').innerHTML='Empresas e valores fictícios para conhecer o painel. Ao cadastrar sua primeira empresa real, todos os exemplos desaparecem definitivamente. <button class="quiet" id="begin-real">Cadastrar empresa real →</button>';
  $('#begin-real')?.addEventListener('click',()=>openCompany());
  $('#insert-invoices').disabled=!ready;$('#new-company').disabled=!ready;$('#restore').disabled=!ready;$('#import-sheet').disabled=!ready;$('#backup').disabled=!ready||demo;
  renderGrid(query);
}
function setLayout(next){layout=next;try{localStorage.setItem('layout',layout);}catch{}render();}
document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>setLayout(b.dataset.layout)));
let gridEditing=null,gridSpan='';
function renderGrid(query){
 const on=layout==='grid'&&!!user,opening=on&&$('#grid').hidden,months=gridMonths(data.companies,data.records),current=monthKey();
 $('#grid').hidden=!on;$('.panel .table-scroll').hidden=on;$('#filter').hidden=on;$('.table-footer').hidden=on;
 document.querySelectorAll('[data-layout]').forEach(b=>{b.classList.toggle('active',b.dataset.layout===layout);b.setAttribute('aria-pressed',String(b.dataset.layout===layout));});
 if(!on){gridEditing=null;$('#grid').innerHTML='';return;}
 // Não redesenhar com uma célula aberta: um snapshot no meio da digitação apagaria o campo.
 if(gridEditing)return;
 const cs=data.companies.filter(c=>[c.name,...c.contacts.map(x=>x.name+' '+x.phone)].join(' ').toLocaleLowerCase('pt-BR').includes(query)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 $('#empty').hidden=true;$('#company-count').textContent=`${cs.length} empresas`;
 const cls=m=>m===current?' current':'';
 $('#grid').innerHTML=`<table class="grid"><thead><tr><th scope="col">Empresa</th>${months.map(m=>`<th scope="col" class="${cls(m)}"><button data-month="${esc(m)}">${esc(new Date(m+'-02T12:00:00').toLocaleDateString('pt-BR',{month:'short'}).replace('.',''))}/${esc(m.slice(2,4))}</button></th>`).join('')}</tr></thead><tbody>${cs.map(c=>`<tr><th scope="row">${esc(c.name)}${c.method==='boleto'?' 🧾':''}</th>${months.map(m=>{
  const r=recordFor(data,c.id,m),locked=c.startMonth&&m<c.startMonth,on=r.launch==='launched',state=locked?'locked':on?r.paid?'paid':'open':r.launch;
  return `<td data-id="${esc(c.id)}" data-month="${esc(m)}" class="${state}${cls(m)}">${locked?'—':`<button class="cell" aria-label="${esc(c.name)} · ${esc(m)}">${on?esc(money(r.amount)):r.launch==='none'?'sem compras':''}</button>${on?'<button class="dot" data-toggle aria-label="Alternar pago">●</button>':''}`}</td>`;
 }).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Total do mês</th>${months.map(m=>`<td class="${cls(m)}">${esc(money(cs.reduce((sum,c)=>{const r=recordFor(data,c.id,m);return sum+(r.launch==='launched'?r.amount:0);},0)))}</td>`).join('')}</tr></tfoot></table>`;
 // Centralizar o mês atual ao abrir e quando chegam meses novos (os dados carregam depois da primeira tela).
 const span=months[0]+'/'+months.length;if(opening||span!==gridSpan){gridSpan=span;const g=$('#grid'),th=g.querySelector('th.current');if(th){const fixed=g.querySelector('th')?.offsetWidth||0;g.scrollLeft+=th.getBoundingClientRect().left-g.getBoundingClientRect().left-fixed-Math.max(0,(g.clientWidth-fixed-th.offsetWidth)/2);}}
}
const amountText=r=>r.launch==='launched'?(r.amount/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):r.launch==='none'?'0':'';
function gridTarget(td,dir){
 const row=td.parentNode,cells=[...row.querySelectorAll('td')],i=cells.indexOf(td);
 return dir==='down'?row.nextElementSibling?.querySelectorAll('td')[i]:cells[i+dir];
}
function findCell(id,m){return [...$('#grid').querySelectorAll('td[data-id]')].find(td=>td.dataset.id===id&&td.dataset.month===m);}
async function saveCell(td,next,base){
 const {id,month:m}=td.dataset,key=id+':'+m,current=session;td.textContent='salvando…';
 try{requireReady();if(!demo)await cloud.saveEntity('record',key,next,base,{companyId:id,month:m});if(current!==session)return false;data.records[key]=next;render();toast(demo?'Exemplo atualizado; nenhum dado fictício é salvo no banco.':'Salvo e sincronizado.');return true;}
 catch(e){if(current===session){render();toast(friendly(e));}return false;}
}
function editCell(td){
 if(!td?.querySelector('.cell')||!ready)return;
 const {id,month:m}=td.dataset,c=data.companies.find(c=>c.id===id),base=structuredClone(data.records[id+':'+m]||null),r=base||blankRecord(),value=amountText(r);
 td.innerHTML=`<input inputmode="decimal" aria-label="Valor de ${esc(c.name)} em ${esc(m)}">`;const input=td.querySelector('input');input.value=value;input.focus();input.select();let done=false;
 async function finish(dir){
  if(done||gridEditing?.input!==input)return false;done=true;gridEditing=null;const target=dir===undefined?null:gridTarget(td,dir),dest=target?{...target.dataset}:null;
  try{
   if(input.value!==value){const next=applyAmount(r,input.value,c,m);if(r.launch==='launched'&&next.launch!=='launched'&&!confirm('Isso removerá o valor, pagamento e controles deste mês. Continuar?')){render();return false;}if(!await saveCell(td,next,base))return false;}else render();
   if(dest)editCell(findCell(dest.id,dest.month));return true;
  }catch(e){render();toast(friendly(e));return false;}
 }
 gridEditing={input,finish};
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(gridEditing?.input===input){done=true;gridEditing=null;render();}}else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();finish(e.key==='Enter'?'down':e.shiftKey?-1:1);}});
 input.addEventListener('blur',()=>finish());
}
// Com uma célula aberta, o mousedown em outro botão não tira o foco: o clique fecha a edição e depois age.
$('#grid').addEventListener('mousedown',e=>{if(gridEditing&&e.target.closest('button'))e.preventDefault();});
$('#grid').addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 const head=b.dataset.month,toggle=b.hasAttribute('data-toggle'),t=b.closest('td')?{...b.closest('td').dataset}:null;
 if(gridEditing&&!await gridEditing.finish())return;
 if(head){month=head;setView('all');setLayout('list');return;}
 const td=t&&findCell(t.id,t.month);if(!td)return;if(toggle){const base=structuredClone(data.records[td.dataset.id+':'+td.dataset.month]||null);saveCell(td,togglePaid(base||blankRecord()),base);}else editCell(td);
});
function setView(v){view=v;$('#filter').value='all';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));render();}
const field=(label,name,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function showEditor(title,html,kind,id){editing={kind,id,month,base:id?structuredClone(kind==='company'?data.companies.find(c=>c.id===id):data.records[id+':'+month]||null):null};$('#editor-title').textContent=title;$('#form-fields').innerHTML=html;$('#form-error').textContent='';$('#editor').showModal();}
function openCompany(id){
 if(!ready){toast('Entre com sua conta Google e aguarde a sincronização.');return;}
 if(demo&&id){toast('Este cadastro é fictício. Use Nova empresa para cadastrar uma empresa real.');return;}
 const c=data.companies.find(c=>c.id===id)||{name:'',legalName:'',cnpj:'',method:'deposito',contacts:[],dueDay:10};
 showEditor(id?'Cadastro da empresa':'Nova empresa',`${field('Nome da empresa','name',c.name,'text','required maxlength="120"')}<div class="form-grid">${field('Razão social','legalName',c.legalName||'','text','maxlength="160"')}${field('CNPJ','cnpj',c.cnpj?formatCnpj(c.cnpj):'','text','inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00"')}</div><div class="form-grid"><label>Forma de pagamento<select name="method"><option value="deposito" ${c.method==='deposito'?'selected':''}>Depósito / transferência / Pix</option><option value="boleto" ${c.method==='boleto'?'selected':''}>Boleto</option></select></label>${field('Dia habitual de vencimento','dueDay',c.dueDay,'number','required min="1" max="31"')}</div><label>Contatos de cobrança<textarea name="contacts" rows="3" placeholder="Maria Financeiro | 5511999999999">${esc(c.contacts.map(x=>x.name+' | '+x.phone).join('\n'))}</textarea></label><p class="hint">Um contato por linha: nome | telefone com DDD (e código do país, se fora do Brasil).</p><p class="hint">O cadastro aparece a partir de ${esc(monthName(c.startMonth||month))}.</p>`, 'company',id);
}
function openRecord(id){
 const c=data.companies.find(c=>c.id===id),r=recordFor(data,id,month);
 const [y,m]=month.split('-').map(Number),day=Math.min(c.dueDay,new Date(y,m,0).getDate());
 const due=r.due||`${month}-${String(day).padStart(2,'0')}`;
 showEditor(c.name,`<p class="hint">Competência: ${esc(monthName(month))}</p><label>Situação das notas<select name="launch" id="launch-status"><option value="pending" ${r.launch==='pending'?'selected':''}>Pendente de lançamento</option><option value="launched" ${r.launch==='launched'?'selected':''}>Nota lançada</option><option value="none" ${r.launch==='none'?'selected':''}>Não teve compras</option></select></label><div id="launched-fields"><div class="form-grid">${field('Valor do mês (R$)','amount',r.amount?(r.amount/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'','text','inputmode="decimal" placeholder="0,00"')}${field('Vencimento','due',due,'date')}</div>${field('Número(s) da nota','invoice',r.invoice,'text','maxlength="200"')}<label class="checkbox-label"><input type="checkbox" name="paid" ${r.paid?'checked':''}>Pagamento confirmado</label>${field('Data do pagamento','paidDate',r.paidDate,'date')}<label>Comprovante<select name="receipt"><option value="pending">Pendente</option><option value="requested">Ficou de enviar / solicitado</option><option value="received">Recebido</option><option value="na">Não necessário</option></select></label>${c.method==='boleto'?`<label class="checkbox-label"><input type="checkbox" name="boleto" ${r.boleto?'checked':''}>Boleto já emitido</label><p class="hint">Este controle registra a emissão; o boleto é gerado no sistema do banco.</p><button type="button" class="quiet" id="copy-boleto">Copiar mensagem do boleto</button>`:''}</div><label>Observações<textarea name="note" rows="3" maxlength="3000" placeholder="Ex.: falei com o financeiro, enviará amanhã.">${esc(r.note)}</textarea></label>`,'record',id);
 $('#edit-form [name="receipt"]').value=r.receipt;
 const notes=document.createElement('section');notes.id='month-invoices';
 notes.innerHTML=`<button type="button" class="quiet" id="insert-record-invoice">Inserir nota (PDF)</button><h3>Notas deste mês</h3>${(r.notes||[]).map((n,i)=>`<div class="invoice-item"><span>Nota ${esc(n.number||'sem número')} · ${esc(n.issued)} · ${esc(money(n.amount))}</span><button type="button" class="quiet danger" data-remove-invoice="${i}">Remover</button></div>`).join('')||'<p class="hint">Nenhuma nota inserida por PDF.</p>'}`;
 $('#form-fields').append(notes);
 $('#insert-record-invoice').addEventListener('click',()=>chooseInvoices({id,month:editing.month}));
 notes.addEventListener('click',async e=>{
  const b=e.target.closest('[data-remove-invoice]');if(!b)return;const current=session,m=editing.month,index=Number(b.dataset.removeInvoice),n=r.notes[index];
  if(r.notes.length===1&&!confirm('Remover a última nota? O mês voltará para pendente.'))return;
  try{requireReady();b.disabled=true;if(demo)throw Error('Insira uma nota em uma empresa real para continuar.');const next=await cloud.removeInvoice(id,m,index,n);if(session!==current)return;data.records[id+':'+m]=next;openRecord(id);toast('Nota removida.');}catch(e){if(session===current)$('#form-error').textContent=friendly(e);}finally{b.disabled=false;}
 });
 function toggle(){const on=$('#launch-status').value==='launched';$('#launched-fields').hidden=!on;$('#edit-form [name="amount"]').required=on;}
 $('#launch-status').addEventListener('change',toggle);toggle();
 function toggleBoleto(){const button=$('#copy-boleto');if(button)button.hidden=$('#edit-form [name="boleto"]')?.checked;}
 $('#edit-form [name="boleto"]')?.addEventListener('change',toggleBoleto);toggleBoleto();
 $('#copy-boleto')?.addEventListener('click',()=>{if($('#edit-form [name="boleto"]')?.checked)return;let amount;try{amount=parseMoney($('#edit-form [name="amount"]').value);}catch(e){$('#form-error').textContent=e.message;return;}copyBoleto(c,{...r,amount},true);});
}
$('#edit-form').addEventListener('submit',async e=>{
 e.preventDefault();try{
 requireReady();const button=e.target.querySelector('[type="submit"]');button.disabled=true;
 const f=new FormData(e.target),next=editing.kind==='company'&&!editing.id&&demo?retireDemo(data):structuredClone(data);
 if(editing.kind==='company'){
   const name=f.get('name').trim();if(!name)throw Error('Informe o nome da empresa.');
   const contacts=f.get('contacts').split('\n').filter(x=>x.trim()).map(line=>{const i=line.lastIndexOf('|');if(i<1)throw Error('Use nome | telefone em cada contato.');let phone=line.slice(i+1).replace(/\D/g,'');if(phone.length===10||phone.length===11)phone='55'+phone;if(phone.length<12||phone.length>15)throw Error('Confira o telefone e inclua o DDD.');return {name:line.slice(0,i).trim(),phone};});
   if(contacts.length>10)throw Error('Cadastre até 10 contatos por empresa.');
   const existing=next.companies.find(c=>c.id===editing.id);
   const cnpj=onlyDigits(f.get('cnpj'));if(cnpj&&!isValidCnpj(cnpj))throw Error('CNPJ inválido. Confira os 14 dígitos.');
 const c={...existing,id:editing.id||crypto.randomUUID(),name,legalName:f.get('legalName').trim(),cnpj,method:f.get('method'),dueDay:Number(f.get('dueDay')),contacts,startMonth:existing?.startMonth||month};
   if(existing)next.companies[next.companies.indexOf(existing)]=c;else next.companies.push(c);
   validateData(next);await cloud.saveEntity('company',c.id,c,editing.base,{month:editing.month});rememberReal();demo=false;data=retireDemo(data);const i=data.companies.findIndex(x=>x.id===c.id);if(i<0)data.companies.push(c);else data.companies[i]=c;
 }else{
   const launch=f.get('launch'),prior=recordFor(next,editing.id,editing.month);
   if(launch!=='launched'&&prior.notes?.length)throw Error('Remova as notas deste mês antes de marcar como pendente ou sem compras.');
   if(launch!=='launched'&&prior.launch==='launched'&&!confirm('Isso removerá o valor, pagamento e controles deste mês. Continuar?'))return;
   const r={...prior,...blankRecord(),launch,note:f.get('note').trim(),attachments:prior.attachments||[],lastContactAt:prior.lastContactAt||'',lastContactName:prior.lastContactName||''};
   if(launch==='launched'){r.amount=parseMoney(f.get('amount'));r.due=f.get('due');r.invoice=f.get('invoice').trim();r.paid=f.has('paid');r.paidDate=r.paid?(f.get('paidDate')||today()):'';r.receipt=f.get('receipt');r.boleto=f.has('boleto');}
   next.records[`${editing.id}:${editing.month}`]=r;validateData(next);
   if(!demo){await cloud.saveEntity('record',editing.id+':'+editing.month,r,editing.base,{companyId:editing.id,month:editing.month});data={...data,records:{...data.records,[editing.id+':'+editing.month]:r}};}
 }
 if(demo)data=next;render();$('#editor').close();toast(demo?'Exemplo atualizado; nenhum dado fictício é salvo no banco.':'Salvo e sincronizado.');
 }catch(err){$('#form-error').textContent=friendly(err);}finally{e.target.querySelector('[type="submit"]').disabled=false;}
});
$('#rows').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;({record:openRecord,company:openCompany,contact:openContact,details:openDetails,boleto:copyRowBoleto})[b.dataset.action](b.dataset.id);});
function openContact(id){
 if(demo){toast('Os exemplos não possuem contatos reais. Cadastre sua empresa para usar o WhatsApp.');return;}
 contactCompany=id;
 const c=data.companies.find(c=>c.id===id),r=recordFor(data,id,month);
 if(!c.contacts.length){toast('Cadastre um contato de cobrança para abrir o WhatsApp.');openCompany(id);return;}
 $('#whatsapp-contact').innerHTML=c.contacts.map(x=>`<option value="${esc(x.phone)}">${esc(x.name)} · +${esc(x.phone)}</option>`).join('');
 const msg=r.paid||r.receipt==='requested'?`Olá! Tudo bem? Poderia enviar o comprovante do pagamento referente a ${monthName(month)} da empresa ${c.name}, no valor de ${money(r.amount)}? Obrigado!`:r.launch==='launched'?`Olá! Tudo bem? Estamos conferindo o faturamento de ${monthName(month)} da empresa ${c.name}, no valor de ${money(r.amount)}${r.due?`, com vencimento em ${r.due.split('-').reverse().join('/')}`:''}. Poderia confirmar a previsão de pagamento? Caso já tenha sido feito, por favor envie o comprovante. Obrigado!`:`Olá! Tudo bem? Estamos conferindo o faturamento de ${monthName(month)} da empresa ${c.name}. Poderia falar com o responsável financeiro? Obrigado!`;
 $('#whatsapp-message').value=msg;$('#whatsapp-dialog').showModal();
}
$('#open-whatsapp').addEventListener('click',()=>{const message=$('#whatsapp-message').value.trim();if(!message){toast('Escreva uma mensagem.');return;}window.open(`https://wa.me/${$('#whatsapp-contact').value}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');});
$('#close-whatsapp').addEventListener('click',()=>$('#whatsapp-dialog').close());
document.querySelectorAll('.close').forEach(b=>b.addEventListener('click',()=>$('#editor').close()));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#new-company').addEventListener('click',()=>openCompany());
$('#prev-month').addEventListener('click',()=>{month=shiftMonth(month,-1);render();});$('#next-month').addEventListener('click',()=>{month=shiftMonth(month,1);render();});$('#current-month').addEventListener('click',()=>{month=monthKey();render();});
$('#month').addEventListener('change',e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)){month=e.target.value;render();}});
$('#search').addEventListener('input',render);$('#filter').addEventListener('change',render);
function download(name,content,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),3000);}
$('#backup').addEventListener('click',async()=>{const b=$('#backup');try{requireReady();if(demo)throw Error('Os exemplos não fazem parte do backup.');b.disabled=true;const full=await cloud.backupAll(data);download(`empresas-faturadas-${today()}.json`,JSON.stringify(full,null,2),'application/json');toast('Backup com os anexos baixado.');}catch(e){toast(friendly(e));}finally{b.disabled=false;}});
$('#restore').addEventListener('click',()=>$('#restore-file').click());
$('#restore-file').addEventListener('change',async e=>{try{requireReady();const file=e.target.files[0];if(!file)return;if(file.size>15*1024*1024)throw Error('Backup maior que 15 MB.');const restored=validateData(JSON.parse(await file.text()));if(!confirm(`Restaurar ${restored.companies.length} empresas? Os dados compartilhados serão substituídos. Baixe um backup antes para preservá-los.`))return;await cloud.restoreAll(restored);rememberReal();toast('Backup restaurado no Firebase.');}catch(err){toast('Não foi possível restaurar: '+friendly(err));}finally{e.target.value='';}});
$('#export-csv').addEventListener('click',()=>{
 const cell=v=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@\-]/,"'$&")+'"';
 const rows=[['Empresa','Razão social','CNPJ','Competência','Valor','Situação da nota','Pagamento','Vencimento','Data do pagamento','Comprovante','Boleto emitido','Número da nota','Observações']];
 for(const c of activeCompanies()){const r=recordFor(data,c.id,month);rows.push([c.name,c.legalName||'',c.cnpj?formatCnpj(c.cnpj):'',month,(r.amount/100).toFixed(2).replace('.',','),({pending:'Pendente',launched:'Lançada',none:'Não teve compras'})[r.launch],r.launch==='launched'?(r.paid?'Pago':'Em aberto'):'',r.due,r.paidDate,({pending:'Pendente',requested:'Aguardando envio',received:'Recebido',na:'Não necessário'})[r.receipt],r.boleto?'Sim':'Não',r.invoice,r.note]);}
 download(`faturamento-${month}${demo?'-EXEMPLO':''}.csv`,'\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8');
});
function friendly(e){return e.code==='permission-denied'?'Esta conta não tem acesso ao controle. Entre com a conta Google autorizada.':e.code==='auth/popup-blocked'?'Permita a janela de login e tente novamente.':e.code==='auth/popup-closed-by-user'?'Login cancelado.':e.code==='unavailable'?'Sem conexão com o banco. Verifique sua internet e tente novamente.':e.message||'Não foi possível concluir.';}
let details=null;
async function openDetails(id){
 if(demo){toast('Anexos e histórico estarão disponíveis nas empresas reais.');return;}
 details={id,month};const c=data.companies.find(c=>c.id===id),r=recordFor(data,id,month);
 $('#details-title').textContent=c.name+' · '+monthName(month);$('#details-content').innerHTML=(r.attachments||[]).map(a=>`<button class="attachment-item quiet" data-file="${esc(a.id)}">▧ ${esc(a.kind)} · ${esc(a.name)} <small>${Math.ceil(a.size/1024)} KB · baixar</small></button>`).join('')||'<p class="hint">Nenhum documento anexado neste mês.</p>';
 $('#history-list').textContent='Carregando histórico…';$('#details-dialog').showModal();
 try{const history=await cloud.history(id,month);if(details?.id!==id||details?.month!==month)return;$('#history-list').innerHTML=history.map(h=>`<article class="history-item"><strong>${esc(h.detail)}</strong><small>${esc(new Date(h.at).toLocaleString('pt-BR'))} · ${esc(h.actor)}</small></article>`).join('')||'<p class="hint">Nenhuma cobrança ou alteração registrada.</p>';}catch(e){$('#history-list').textContent=friendly(e);}
}
$('#close-details').addEventListener('click',()=>{$('#details-dialog').close();details=null;});
$('#details-content').addEventListener('click',async e=>{const b=e.target.closest('[data-file]');if(!b)return;try{b.disabled=true;const f=await cloud.getAttachment(b.dataset.file);download(f.name,await f.blob.arrayBuffer(),f.blob.type);}catch(e){toast(friendly(e));}finally{b.disabled=false;}});
$('#attachment-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');try{requireReady();button.disabled=true;await cloud.addAttachment(details.id,details.month,$('#attachment-file').files[0],$('#attachment-kind').value);$('#attachment-file').value='';toast('Anexo salvo e compartilhado.');$('#details-dialog').close();await openDetails(details.id);}catch(e){toast(friendly(e));}finally{button.disabled=false;}});
$('#record-contact').addEventListener('click',async()=>{const b=$('#record-contact');try{requireReady();b.disabled=true;await cloud.recordContact(contactCompany,month,$('#whatsapp-contact').selectedOptions[0].textContent);toast('Cobrança registrada no histórico.');$('#whatsapp-dialog').close();}catch(e){toast(friendly(e));}finally{b.disabled=false;}});
$('#calendar').addEventListener('click',()=>{const next=shiftMonth(monthKey(),1).replace('-','')+'01';const uid=crypto.randomUUID();download('lembrete-faturamento.ics',['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Padaria//Empresas Faturadas//PT-BR','BEGIN:VEVENT',`UID:${uid}@empresas-faturadas`,`DTSTAMP:${today().replaceAll('-','')}T120000Z`,`DTSTART:${next}T090000`,`DTEND:${next}T093000`,'RRULE:FREQ=MONTHLY;BYMONTHDAY=1','SUMMARY:Lançar notas das empresas faturadas','DESCRIPTION:Confira todas as empresas e marque as que não tiveram compras.','BEGIN:VALARM','TRIGGER:-PT10M','ACTION:DISPLAY','DESCRIPTION:Lançar notas do faturamento mensal','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n')+'\r\n','text/calendar;charset=utf-8');toast('Importe o arquivo no calendário do celular para receber o lembrete mensal.');});
async function copyBoleto(c,r,fromEditor=false){
 const current=session;
 let text;try{text=boletoMessage(c,r);}catch(e){if(fromEditor){$('#form-error').textContent=e.message;return;}toast(e.message);if(!c.legalName?.trim()||!c.cnpj)openCompany(c.id);return;}
 try{await navigator.clipboard.writeText(text);if(session!==current)return;toast('Mensagem do boleto copiada. Cole no WhatsApp ou e-mail do financeiro.');}catch{if(session!==current)return;prompt('Copie a mensagem do boleto:',text);}
}
const copyRowBoleto=id=>copyBoleto(data.companies.find(c=>c.id===id),recordFor(data,id,month));
let invoiceRows=null,invoiceSuggestion=null,invoiceReading=0,invoiceSaving=false;
function chooseInvoices(suggestion=null){invoiceSuggestion=suggestion;$('#invoice-files').click();}
$('#insert-invoices').addEventListener('click',()=>chooseInvoices());
$('#invoice-files').addEventListener('change',async e=>{
 const current=session,reading=++invoiceReading,suggestion=invoiceSuggestion,files=[...e.target.files];e.target.value='';invoiceSuggestion=null;
 try{
  requireReady();if(!files.length)return;if(files.length>10)throw Error('Insira até 10 PDFs por vez; divida os arquivos.');
  const rows=[];
  for(const file of files){
   let parsed={key:'',number:'',issued:'',cnpj:'',legalName:'',total:0},error='';
   try{if(file.type!=='application/pdf')throw Error('Envie um arquivo PDF.');parsed=parseDanfe(await readPdfItems(file));}catch(e){error=friendly(e);}
   if(session!==current||reading!==invoiceReading)return;
   const companies=demo?[]:data.companies,name=nameKey(parsed.legalName),matched=companies.find(c=>parsed.cnpj&&c.cnpj===parsed.cnpj)||companies.find(c=>name&&(nameKey(c.legalName||'')===name||nameKey(c.name)===name));
   rows.push({file,parsed,error,company:matched?.id||(!demo&&suggestion?.id)||'new',month:suggestion?.month||invoiceMonth(parsed.issued),amount:parsed.total?(parsed.total/100).toFixed(2).replace('.',','):'',update:false,newId:crypto.randomUUID()});
  }
  invoiceRows=rows;renderInvoices();$('#invoice-review').showModal();
 }catch(e){if(session===current)toast(friendly(e));}
});
function invoicePlan(){
 const companies=demo?[]:data.companies,seen=[],newCompanies=new Map(),rows=[];
 for(const row of invoiceRows||[]){
  const p=row.parsed,isNew=row.company==='new';let company=companies.find(c=>c.id===row.company);
  if(isNew){const identity=p.cnpj||nameKey(p.legalName)||row.newId;company=newCompanies.get(identity);if(!company){company={id:row.newId,name:p.legalName.slice(0,120),legalName:p.legalName.slice(0,160),cnpj:p.cnpj,method:'deposito',dueDay:10,contacts:[],startMonth:row.month};newCompanies.set(identity,company);}}
  const prior=company?recordFor(data,company.id,row.month):blankRecord();let amount=0;try{amount=parseMoney(row.amount);}catch{}
  const note={...p,amount},duplicate=!!(company&&(seen.some(x=>x.id===company.id&&(p.key||x.month===row.month)&&duplicateInvoice(x.note,note))||Object.entries(demo?{}:data.records).some(([k,r])=>(p.key?k.startsWith(company.id+':'):k===company.id+':'+row.month)&&(r.notes||[]).some(n=>duplicateInvoice(n,note)))));
  const invalid=!company?.name.trim()||!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)||!amount||!p.number.trim()||p.number.length>20||!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.issued)||(p.cnpj&&!isValidCnpj(p.cnpj))||p.legalName.length>160;
  if(company)seen.push({id:company.id,month:row.month,note});
  const different=!isNew&&company&&((p.cnpj&&company.cnpj&&p.cnpj!==company.cnpj)||(p.legalName&&company.legalName&&nameKey(p.legalName)!==nameKey(company.legalName)));
  rows.push({row,company,prior,amount,duplicate,invalid,different,isNew});
 }
 return rows;
}
function renderInvoices(){
 const plan=invoicePlan(),companies=demo?[]:data.companies;
 $('#invoice-rows').innerHTML=plan.map((x,i)=>{
  const {row,prior,duplicate,invalid,different,isNew,company}=x,p=row.parsed;
  const group=plan.filter(y=>!y.duplicate&&!y.invalid&&y.company?.id===company?.id&&y.row.month===row.month),total=(prior.notes||[]).reduce((sum,n)=>sum+n.amount,0)+group.reduce((sum,y)=>sum+y.amount,0),count=(prior.notes||[]).length+group.length;
  const manual=prior.launch==='launched'&&prior.amount!==total&&(!prior.notes?.length||prior.amount!==prior.notes.reduce((sum,n)=>sum+n.amount,0));
  return `<article class="invoice-row${!duplicate&&invalid?' invalid':''}" data-invoice-row="${i}"><div class="invoice-heading"><strong>${esc(row.file.name)}</strong><button class="quiet danger" data-invoice-remove="${i}">Remover</button></div><label>Empresa<select data-invoice-company><option value="new" ${isNew?'selected':''}>Nova empresa</option>${companies.map(c=>`<option value="${esc(c.id)}" ${row.company===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><div class="form-grid">${field('Razão social','legalName',p.legalName,'text','maxlength="160"')}${field('CNPJ do destinatário','cnpj',p.cnpj.length===14?formatCnpj(p.cnpj):p.cnpj,'text','inputmode="numeric"')}</div><div class="invoice-fields">${field('Número','number',p.number,'text','maxlength="20"')}${field('Emissão','issued',p.issued,'date')}<label>Competência<input type="month" data-invoice-month value="${esc(row.month)}"></label><label>Valor (R$)<input data-invoice-amount inputmode="decimal" value="${esc(row.amount)}"></label></div><p class="invoice-status${!duplicate&&invalid?' error':''}">${duplicate?'Já inserida':invalid?'Campos faltando':'Nova nota'}</p>${row.error?`<p class="error">${esc(row.error)}</p>`:''}${(p.warnings||[]).map(w=>`<p class="invoice-warning">${esc(w)}</p>`).join('')}${row.file.size>600*1024?'<p class="invoice-warning">PDF acima de 600 KB: os dados serão gravados sem anexar o arquivo.</p>':''}${!isNew&&company&&((!company.legalName&&p.legalName)||(!company.cnpj&&p.cnpj))?'<p class="invoice-warning">Razão social e CNPJ serão preenchidos</p>':''}${different?`<p class="invoice-warning">CNPJ ou razão social diferente do cadastro</p><label class="checkbox-label"><input type="checkbox" data-invoice-update ${row.update?'checked':''}>Atualizar cadastro</label>`:''}${!duplicate&&company?`<p class="invoice-warning">Valor do mês: ${esc(money(prior.amount))} → ${esc(money(total))} (soma de ${count===1?'1 nota':esc(count)+' notas'})${manual?' · O valor anterior foi digitado à mão e será substituído.':''}</p>`:''}</article>`;
 }).join('');
 $('#invoice-rows').querySelectorAll('input,select,button').forEach(b=>b.disabled=invoiceSaving);
 for(const id of ['#close-invoices','#cancel-invoices'])$(id).disabled=invoiceSaving;
 $('#confirm-invoices').disabled=invoiceSaving||!plan.some(x=>!x.duplicate)||plan.some(x=>!x.duplicate&&x.invalid);
}
$('#invoice-rows').addEventListener('change',e=>{
 const article=e.target.closest('[data-invoice-row]');if(!article||invoiceSaving)return;const row=invoiceRows[Number(article.dataset.invoiceRow)],t=e.target;
 if(t.hasAttribute('data-invoice-company')){row.company=t.value;row.update=false;}
 else if(t.hasAttribute('data-invoice-month'))row.month=t.value;
 else if(t.hasAttribute('data-invoice-amount'))row.amount=t.value;
 else if(t.hasAttribute('data-invoice-update'))row.update=t.checked;
 else if(t.name==='cnpj')row.parsed.cnpj=onlyDigits(t.value);
 else if(['number','issued','legalName'].includes(t.name))row.parsed[t.name]=t.value.trim();
 renderInvoices();
});
$('#invoice-rows').addEventListener('click',e=>{const b=e.target.closest('[data-invoice-remove]');if(!b||invoiceSaving)return;invoiceRows.splice(Number(b.dataset.invoiceRemove),1);renderInvoices();});
$('#confirm-invoices').addEventListener('click',async()=>{
 const current=session,review=invoiceRows;try{
  requireReady();if(invoiceSaving||!invoiceRows)return;const plan=invoicePlan();if(plan.some(x=>!x.duplicate&&x.invalid))return;
  const items=plan.filter(x=>!x.duplicate).map(x=>({company:{...x.company,legalName:x.row.parsed.legalName,cnpj:x.row.parsed.cnpj},isNew:x.isNew,updateCompany:x.row.update,month:x.row.month,note:{key:x.row.parsed.key,number:x.row.parsed.number,issued:x.row.parsed.issued,amount:x.amount,attachmentId:''},file:x.row.file.size<=600*1024?x.row.file:null}));
  if(!items.length)return;invoiceSaving=true;renderInvoices();await cloud.addInvoices(items);if(session!==current||invoiceRows!==review)return;
  rememberReal();if(demo){demo=false;data=retireDemo(data);}for(const {company,month:m,updateCompany}of items){const i=data.companies.findIndex(c=>c.id===company.id),prior=data.companies[i];let c={...(prior||company),startMonth:[prior?.startMonth||m,m].sort()[0]};for(const k of ['cnpj','legalName'])if((!c[k]||updateCompany)&&company[k])c[k]=company[k];if(i<0)data.companies.push(c);else data.companies[i]=c;}$('#invoice-review').close();$('#editor').close();render();toast('Notas inseridas e sincronizadas.');
 }catch(e){if(session===current&&invoiceRows===review){$('#invoice-error').textContent=friendly(e);toast(friendly(e));}}finally{if(session===current&&invoiceRows===review){invoiceSaving=false;if(invoiceRows)renderInvoices();}}
});
$('#invoice-review').addEventListener('cancel',e=>{if(invoiceSaving)e.preventDefault();});
$('#invoice-review').addEventListener('close',()=>{invoiceRows=null;invoiceSuggestion=null;invoiceReading++;invoiceSaving=false;for(const id of ['#close-invoices','#cancel-invoices'])$(id).disabled=false;$('#invoice-rows').innerHTML='';$('#invoice-error').textContent='';});
for(const id of ['#close-invoices','#cancel-invoices'])$(id).addEventListener('click',()=>{if(!invoiceSaving)$('#invoice-review').close();});
$('#import-sheet').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{const currentSession=session;try{requireReady();const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('Planilha maior que 5 MB.');const bytes=new Uint8Array(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(file);}));if(session!==currentSession)return;const workbook=await parseWorkbook(bytes);if(session!==currentSession)return;importing=planImport(workbook,demo?retireDemo(data):data);showImport(importing);}catch(err){toast('Não foi possível ler a planilha: '+friendly(err));}finally{e.target.value='';}});
function showImport(p){
 const fresh=p.preview.filter(x=>x.isNew).length,count=Object.keys(p.records).length;
 $('#import-summary').textContent=`${p.preview.length} empresas (${fresh} novas) · ${count} lançamentos a gravar. Nada é salvo até confirmar.`;
 $('#import-warnings').innerHTML=p.warnings.length?`<ul class="import-warnings">${p.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:'';
 $('#import-rows').innerHTML=p.preview.map(x=>`<tr><td><div class="company-name">${esc(x.name)}</div><div class="subline">${x.isNew?'Nova empresa':'Já cadastrada'}</div></td><td>${badge(x.method==='boleto'?'Boleto':'Depósito','gray')}</td><td>${x.months.map(m=>`<div class="subline">${esc(monthName(m.month))}: ${money(m.amount)} · ${m.kept?'já lançado, mantido':m.paid?'Pago':'Em aberto'}</div>`).join('')||'<div class="subline">Sem valores</div>'}</td></tr>`).join('');
 $('#confirm-import').disabled=!p.companies.length&&!count;$('#import-dialog').showModal();
}
$('#confirm-import').addEventListener('click',async()=>{const currentSession=session,b=$('#confirm-import');try{requireReady();b.disabled=true;const next=structuredClone(demo?retireDemo(data):data);for(const c of importing.companies){const i=next.companies.findIndex(x=>x.id===c.id);if(i<0)next.companies.push(c);else next.companies[i]=c;}Object.assign(next.records,importing.records);validateData(next);await cloud.importAll(importing);if(session!==currentSession)return;rememberReal();if(demo){demo=false;data=retireDemo(data);}importing=null;$('#import-dialog').close();render();toast('Planilha importada e sincronizada.');}catch(e){toast(friendly(e));}finally{b.disabled=false;}});
$('#import-dialog').addEventListener('close',()=>{importing=null;for(const id of ['#import-rows','#import-warnings','#import-summary'])$(id).innerHTML='';});
for(const id of ['#close-import','#cancel-import'])$(id).addEventListener('click',()=>$('#import-dialog').close());
async function signIn(){try{await cloud.login();}catch(e){toast(friendly(e));}}
$('#login').addEventListener('click',signIn);$('#logout').addEventListener('click',async()=>{await cloud.logout();});
cloud.connect({onAuth:u=>{session++;document.querySelectorAll('dialog').forEach(d=>d.close());$('#form-fields').innerHTML='';$('#details-content').innerHTML='';$('#history-list').innerHTML='';$('#whatsapp-message').value='';editing=null;details=null;contactCompany=null;importing=null;$('#import-rows').innerHTML='';user=u;ready=false;data={version:1,hasRealData:false,companies:[],records:{}};demo=false;$('#login').hidden=!!u;$('#logout').hidden=!u;$('#account-name').textContent=u?.displayName||'';$('#sync-status').textContent=u?'Conectando ao Firebase…':'Entre para sincronizar';render();},onData:acceptData,onError:e=>{ready=false;$('#sync-status').textContent='Não sincronizado';toast(friendly(e));render();}}).catch(e=>toast(friendly(e)));
render();

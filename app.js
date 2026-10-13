import {monthKey,shiftMonth,blankRecord,recordFor,money,parseMoney,summary,validateData} from './domain.js';
import {initialDemo,retireDemo,shouldShowDemo} from './demo.js';
import * as cloud from './cloud.js';
const $=s=>document.querySelector(s), KEY='empresas-faturadas-v1';
let data={version:1,hasRealData:false,companies:[],records:{}},month=monthKey(),view='all',editing=null,demo=false,ready=false,user=null,contactCompany=null;
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
  const labels=['Empresa / contato','Valor do mês','Pagamento','Comprovante','Boleto','Ações'];$('#rows').querySelectorAll('tr').forEach(tr=>{[...tr.children].forEach((td,i)=>td.dataset.label=labels[i]);const id=tr.querySelector('[data-id]').dataset.id;const c=data.companies.find(c=>c.id===id),r=recordFor(data,id,month);const button=document.createElement('button');button.dataset.action='details';button.dataset.id=id;button.textContent='Anexos / histórico';tr.querySelector('.row-actions').append(button);if(r.lastContactAt){const line=document.createElement('div');line.className='subline';line.textContent='Última cobrança: '+new Date(r.lastContactAt).toLocaleDateString('pt-BR');tr.querySelector('.company-name').parentNode.append(line);}});
  $('#empty').hidden=companies.length>0;
  if(!companies.length)$('#empty').innerHTML=!user?'<div class="empty-icon">▤</div><h3>Seu financeiro, onde você estiver.</h3><p>Entre com sua conta Google para acessar o controle da padaria.<br>As informações são compartilhadas entre seu celular e computador.</p><button class="primary" id="empty-login">Entrar com Google</button>':data.companies.length?'<div class="empty-icon">⌕</div><h3>Nenhuma empresa nesta lista.</h3><p>Confira a competência, a busca ou os filtros selecionados.</p>':'<div class="empty-icon">▤</div><h3>Vamos organizar o faturamento?</h3><p>Cadastre sua primeira empresa para acompanhar valores,<br>notas, pagamentos e comprovantes todos os meses.</p><button class="primary" id="empty-new">＋ Cadastrar primeira empresa</button>';
  $('#empty-new')?.addEventListener('click',()=>openCompany());$('#empty-login')?.addEventListener('click',signIn);
  $('#shown-count').textContent=`${companies.length} de ${visibleData.companies.length} empresas`;
  $('#demo-banner').hidden=!demo;
  if(demo)$('#demo-banner').innerHTML='Empresas e valores fictícios para conhecer o painel. Ao cadastrar sua primeira empresa real, todos os exemplos desaparecem definitivamente. <button class="quiet" id="begin-real">Cadastrar empresa real →</button>';
  $('#begin-real')?.addEventListener('click',()=>openCompany());
  $('#new-company').disabled=!ready;$('#restore').disabled=!ready;$('#backup').disabled=!ready||demo;
}
function setView(v){view=v;$('#filter').value='all';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));render();}
const field=(label,name,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function showEditor(title,html,kind,id){editing={kind,id,month,base:id?structuredClone(kind==='company'?data.companies.find(c=>c.id===id):data.records[id+':'+month]||null):null};$('#editor-title').textContent=title;$('#form-fields').innerHTML=html;$('#form-error').textContent='';$('#editor').showModal();}
function openCompany(id){
 if(!ready){toast('Entre com sua conta Google e aguarde a sincronização.');return;}
 if(demo&&id){toast('Este cadastro é fictício. Use Nova empresa para cadastrar uma empresa real.');return;}
 const c=data.companies.find(c=>c.id===id)||{name:'',method:'deposito',contacts:[],dueDay:10};
 showEditor(id?'Cadastro da empresa':'Nova empresa',`${field('Nome da empresa','name',c.name,'text','required maxlength="120"')}<div class="form-grid"><label>Forma de pagamento<select name="method"><option value="deposito" ${c.method==='deposito'?'selected':''}>Depósito / transferência / Pix</option><option value="boleto" ${c.method==='boleto'?'selected':''}>Boleto</option></select></label>${field('Dia habitual de vencimento','dueDay',c.dueDay,'number','required min="1" max="31"')}</div><label>Contatos de cobrança<textarea name="contacts" rows="3" placeholder="Maria Financeiro | 5511999999999">${esc(c.contacts.map(x=>x.name+' | '+x.phone).join('\n'))}</textarea></label><p class="hint">Um contato por linha: nome | telefone com DDD (e código do país, se fora do Brasil).</p><p class="hint">O cadastro aparece a partir de ${esc(monthName(c.startMonth||month))}.</p>`, 'company',id);
}
function openRecord(id){
 const c=data.companies.find(c=>c.id===id),r=recordFor(data,id,month);
 const [y,m]=month.split('-').map(Number),day=Math.min(c.dueDay,new Date(y,m,0).getDate());
 const due=r.due||`${month}-${String(day).padStart(2,'0')}`;
 showEditor(c.name,`<p class="hint">Competência: ${esc(monthName(month))}</p><label>Situação das notas<select name="launch" id="launch-status"><option value="pending" ${r.launch==='pending'?'selected':''}>Pendente de lançamento</option><option value="launched" ${r.launch==='launched'?'selected':''}>Nota lançada</option><option value="none" ${r.launch==='none'?'selected':''}>Não teve compras</option></select></label><div id="launched-fields"><div class="form-grid">${field('Valor do mês (R$)','amount',r.amount?(r.amount/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'','text','inputmode="decimal" placeholder="0,00"')}${field('Vencimento','due',due,'date')}</div>${field('Número(s) da nota','invoice',r.invoice,'text','maxlength="200"')}<label class="checkbox-label"><input type="checkbox" name="paid" ${r.paid?'checked':''}>Pagamento confirmado</label>${field('Data do pagamento','paidDate',r.paidDate,'date')}<label>Comprovante<select name="receipt"><option value="pending">Pendente</option><option value="requested">Ficou de enviar / solicitado</option><option value="received">Recebido</option><option value="na">Não necessário</option></select></label>${c.method==='boleto'?`<label class="checkbox-label"><input type="checkbox" name="boleto" ${r.boleto?'checked':''}>Boleto já emitido</label><p class="hint">Este controle registra a emissão; o boleto é gerado no sistema do banco.</p>`:''}</div><label>Observações<textarea name="note" rows="3" maxlength="3000" placeholder="Ex.: falei com o financeiro, enviará amanhã.">${esc(r.note)}</textarea></label>`,'record',id);
 $('#edit-form [name="receipt"]').value=r.receipt;
 function toggle(){const on=$('#launch-status').value==='launched';$('#launched-fields').hidden=!on;$('#edit-form [name="amount"]').required=on;}
 $('#launch-status').addEventListener('change',toggle);toggle();
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
   const c={...existing,id:editing.id||crypto.randomUUID(),name,method:f.get('method'),dueDay:Number(f.get('dueDay')),contacts,startMonth:existing?.startMonth||month};
   if(existing)next.companies[next.companies.indexOf(existing)]=c;else next.companies.push(c);
   validateData(next);await cloud.saveEntity('company',c.id,c,editing.base,{month:editing.month});rememberReal();demo=false;data=retireDemo(data);const i=data.companies.findIndex(x=>x.id===c.id);if(i<0)data.companies.push(c);else data.companies[i]=c;
 }else{
   const launch=f.get('launch'),prior=recordFor(next,editing.id,editing.month);
   if(launch!=='launched'&&prior.launch==='launched'&&!confirm('Isso removerá o valor, pagamento e controles deste mês. Continuar?'))return;
   const r={...blankRecord(),launch,note:f.get('note').trim(),attachments:prior.attachments||[],lastContactAt:prior.lastContactAt||'',lastContactName:prior.lastContactName||''};
   if(launch==='launched'){r.amount=parseMoney(f.get('amount'));r.due=f.get('due');r.invoice=f.get('invoice').trim();r.paid=f.has('paid');r.paidDate=r.paid?(f.get('paidDate')||today()):'';r.receipt=f.get('receipt');r.boleto=f.has('boleto');}
   next.records[`${editing.id}:${editing.month}`]=r;validateData(next);
   if(!demo){await cloud.saveEntity('record',editing.id+':'+editing.month,r,editing.base,{companyId:editing.id,month:editing.month});data={...data,records:{...data.records,[editing.id+':'+editing.month]:r}};}
 }
 if(demo)data=next;render();$('#editor').close();toast(demo?'Exemplo atualizado; nenhum dado fictício é salvo no banco.':'Salvo e sincronizado.');
 }catch(err){$('#form-error').textContent=friendly(err);}finally{e.target.querySelector('[type="submit"]').disabled=false;}
});
$('#rows').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;({record:openRecord,company:openCompany,contact:openContact,details:openDetails})[b.dataset.action](b.dataset.id);});
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
 const rows=[['Empresa','Competência','Valor','Situação da nota','Pagamento','Vencimento','Data do pagamento','Comprovante','Boleto emitido','Número da nota','Observações']];
 for(const c of activeCompanies()){const r=recordFor(data,c.id,month);rows.push([c.name,month,(r.amount/100).toFixed(2).replace('.',','),({pending:'Pendente',launched:'Lançada',none:'Não teve compras'})[r.launch],r.launch==='launched'?(r.paid?'Pago':'Em aberto'):'',r.due,r.paidDate,({pending:'Pendente',requested:'Aguardando envio',received:'Recebido',na:'Não necessário'})[r.receipt],r.boleto?'Sim':'Não',r.invoice,r.note]);}
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
async function signIn(){try{await cloud.login();}catch(e){toast(friendly(e));}}
$('#login').addEventListener('click',signIn);$('#logout').addEventListener('click',async()=>{await cloud.logout();});
cloud.connect({onAuth:u=>{user=u;ready=false;data={version:1,hasRealData:false,companies:[],records:{}};demo=false;$('#login').hidden=!!u;$('#logout').hidden=!u;$('#account-name').textContent=u?.displayName||'';$('#sync-status').textContent=u?'Conectando ao Firebase…':'Entre para sincronizar';render();},onData:acceptData,onError:e=>{ready=false;$('#sync-status').textContent='Não sincronizado';toast(friendly(e));render();}}).catch(e=>toast(friendly(e)));
render();

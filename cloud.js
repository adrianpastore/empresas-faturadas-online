import {firebaseConfig} from './firebase-config.js';
import {validateData,validateRestore,blankRecord,monthKey,withInvoice,withoutInvoice,duplicateInvoice,money} from './domain.js';
export const configured=!!firebaseConfig;
let api,auth,db,user,stop=[];
const root='workspaces/padaria';
export async function connect({onAuth,onData,onError}){
 if(!configured){onError(Error('O banco está sendo configurado.'));return;}
 const [app,a,f]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')]);
 api={...a,...f};const instance=app.initializeApp(firebaseConfig);auth=a.getAuth(instance);db=f.getFirestore(instance);
 await a.setPersistence(auth,a.browserLocalPersistence);
 a.onAuthStateChanged(auth,async u=>{
   stop.forEach(fn=>fn());stop=[];user=u;onAuth(u);
   if(!u)return;
   const state={version:1,hasRealData:false,companies:[],records:{}};const ready=new Set();
   function emit(k){if(user?.uid!==u.uid)return;ready.add(k);if(ready.size===3){try{onData(validateData(structuredClone(state)));}catch(e){onError(e);}}}
   const error=e=>onError(e);
   // Só mostrar dados após confirmação do servidor, inclusive ao trocar de conta.
   // O cache em memória do SDK pode conter registros de uma sessão anterior.
   stop.push(f.onSnapshot(f.doc(db,root),{includeMetadataChanges:true},s=>{if(s.metadata.fromCache)return;state.hasRealData=s.data()?.hasRealData===true;emit('meta');},error));
   stop.push(f.onSnapshot(f.collection(db,root+'/companies'),{includeMetadataChanges:true},s=>{if(s.metadata.fromCache)return;state.companies=s.docs.map(d=>d.data());emit('companies');},error));
   stop.push(f.onSnapshot(f.collection(db,root+'/records'),{includeMetadataChanges:true},s=>{if(s.metadata.fromCache)return;state.records=Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));emit('records');},error));
 });
}
export async function login(){if(!auth)throw Error('Aguarde a conexão com o Firebase.');const p=new api.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});await api.signInWithPopup(auth,p);}
export async function logout(){stop.forEach(fn=>fn());stop=[];await api.signOut(auth);}
const requireUser=()=>{if(!user||!db)throw Error('Entre com sua conta Google para salvar.');};
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function log(tx,kind,companyId,month,detail){tx.set(api.doc(api.collection(db,root+'/activity')),{kind,companyId,month,detail,at:new Date().toISOString(),actor:user.displayName||user.email||'Usuário',uid:user.uid});}
export async function saveEntity(kind,id,value,base,context={}){
 requireUser();const entity=api.doc(db,root+'/'+(kind==='company'?'companies':'records')+'/'+id);
 await api.runTransaction(db,async tx=>{
   const s=await tx.get(entity);
   if(!same(s.exists()?s.data():null,base))throw Error('Este registro foi alterado em outro aparelho. Feche e abra novamente para editar a versão atual.');
   const prior=s.data();tx.set(entity,kind==='record'&&value.notes===undefined&&prior?.notes!==undefined?{...value,notes:prior.notes}:value);tx.set(api.doc(db,root),{hasRealData:true},{merge:true});
   log(tx,kind==='company'?'cadastro':'lancamento',context.companyId||id,context.month||'',kind==='company'?'Cadastro atualizado':`Lançamento atualizado: ${value.launch}; pagamento ${value.paid?'confirmado':'pendente'}`);
 });
}
export async function history(companyId,month){requireUser();const s=await api.getDocs(api.query(api.collection(db,root+'/activity'),api.where('companyId','==',companyId)));return s.docs.map(d=>d.data()).filter(d=>!d.month||d.month===month).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,60);}
export async function recordContact(companyId,month,contact){requireUser();await api.runTransaction(db,async tx=>{const ref=api.doc(db,root+'/records/'+companyId+':'+month),s=await tx.get(ref);tx.set(ref,{...(s.data()||blankRecord()),lastContactAt:new Date().toISOString(),lastContactName:contact});log(tx,'cobranca',companyId,month,`Cobrança registrada para ${contact}`);tx.set(api.doc(db,root),{hasRealData:true},{merge:true});});}
export async function addAttachment(companyId,month,file,kind){
 requireUser();if(file.size>600*1024)throw Error('Use um arquivo de até 600 KB.');if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Envie PDF, JPG, PNG ou WebP.');
 const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
 const id=crypto.randomUUID();const item={id,name:file.name.slice(0,180),mime:file.type,size:file.size,kind,companyId,month,at:new Date().toISOString(),uid:user.uid};
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,root+'/records/'+companyId+':'+month),s=await tx.get(ref);const r=s.data()||blankRecord();if((r.attachments||[]).length>=10)throw Error('Limite de 10 anexos por empresa no mês.');tx.set(api.doc(db,root+'/attachments/'+id),{...item,content});tx.set(ref,{...r,attachments:[...(r.attachments||[]),item]});log(tx,'anexo',companyId,month,`${kind}: ${item.name}`);tx.set(api.doc(db,root),{hasRealData:true},{merge:true});});
}
export async function addInvoices(items){
 requireUser();if(!Array.isArray(items)||!items.length||items.length>10)throw Error('Insira até 10 notas por vez; divida os arquivos.');
 const uid=user.uid,prepared=[];let bytes=0;
 for(const item of items){
   const {company,month,note,file}=item;if(!company||! /^[A-Za-z0-9_-]{1,100}$/.test(company.id)||! /^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Empresa ou competência inválida.');
   let attachment=null;
   if(file&&file.size<=600*1024){
     if(file.type!=='application/pdf'||!Number.isInteger(file.size)||file.size<1)throw Error('Envie um PDF válido.');
     const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
     attachment={id:crypto.randomUUID(),name:file.name.slice(0,180),mime:file.type,size:file.size,kind:'Nota fiscal',companyId:company.id,month,at:new Date().toISOString(),uid,content};
     bytes+=JSON.stringify(attachment).length;if(bytes>9*1024*1024)throw Error('Limite de 9 MB de anexos por vez; divida os arquivos.');
   }
   prepared.push({...item,note:{...note,attachmentId:attachment?.id||''},attachment});
 }
 if(user?.uid!==uid)throw Error('A sessão mudou. Entre novamente para salvar.');
 await api.runTransaction(db,async tx=>{
   if(user?.uid!==uid)throw Error('A sessão mudou. Entre novamente para salvar.');
   const ids=[...new Set(prepared.map(i=>i.company.id))],companies=new Map(),records=new Map();
   for(const id of ids){const s=await tx.get(api.doc(db,root+'/companies/'+id));companies.set(id,s.exists()?s.data():null);}
   // Reconsultar a cada tentativa; gravar a empresa serializa inserções em meses diferentes.
   const listed=await api.getDocs(api.collection(db,root+'/records')),keys=new Set(prepared.map(i=>i.company.id+':'+i.month));
   for(const d of listed.docs)if(ids.includes(d.id.slice(0,d.id.lastIndexOf(':'))))keys.add(d.id);
   for(const key of keys){const s=await tx.get(api.doc(db,root+'/records/'+key));records.set(key,s.data()||blankRecord());}
   const seen=new Map(ids.map(id=>[id,new Set([...records].filter(([key])=>key.startsWith(id+':')).flatMap(([,r])=>(r.notes||[]).map(n=>n.key).filter(Boolean)))])),changed=new Map(),updated=new Map();
   for(const {company,isNew,updateCompany,month,note,attachment}of prepared){
     const prior=companies.get(company.id);if(isNew?!!prior:!prior)throw Error('A empresa mudou desde a conferência. Abra as notas novamente.');
     const keys=seen.get(company.id);if(note.key?keys.has(note.key):(records.get(company.id+':'+month).notes||[]).some(n=>duplicateInvoice(n,note)))throw Error('Esta nota já foi inserida nesta empresa. Abra as notas novamente.');if(note.key)keys.add(note.key);
     let c=updated.get(company.id)||prior||{...company,startMonth:month};
     c={...c,startMonth:[c.startMonth||month,month].sort()[0]};
     for(const field of ['cnpj','legalName'])if((!c[field]||updateCompany)&&company[field])c={...c,[field]:company[field]};updated.set(company.id,c);
     const key=company.id+':'+month,r=withInvoice(records.get(key),note,c,month);
     if(attachment){if((r.attachments||[]).length>=10)throw Error('Limite de 10 anexos por empresa no mês.');const {content,...meta}=attachment;r.attachments=[...(r.attachments||[]),meta];}
     records.set(key,r);changed.set(key,r);
   }
   validateData({version:1,companies:[...updated.values()],records:Object.fromEntries(changed)});
   for(const [id,c]of updated)tx.set(api.doc(db,root+'/companies/'+id),c);
   for(const [key,r]of changed)tx.set(api.doc(db,root+'/records/'+key),r);
   for(const {company,month,note,attachment}of prepared){if(attachment)tx.set(api.doc(db,root+'/attachments/'+attachment.id),attachment);log(tx,'lancamento',company.id,month,`Nota ${note.number} inserida: ${money(note.amount).replace(/\s/g,' ')}`);}
   tx.set(api.doc(db,root),{hasRealData:true},{merge:true});
 });
}
export async function removeInvoice(companyId,month,index,expected){
 requireUser();return api.runTransaction(db,async tx=>{
   const ref=api.doc(db,root+'/records/'+companyId+':'+month),s=await tx.get(ref),r=s.data()||blankRecord(),note=r.notes?.[index];
   if(!note||!expected||!['key','number','issued','amount','attachmentId'].every(k=>note[k]===expected[k]))throw Error('Esta nota foi alterada ou já removida. Feche e abra o mês novamente.');
   const next=withoutInvoice(r,index);tx.set(ref,next);if(expected.attachmentId)tx.delete(api.doc(db,root+'/attachments/'+expected.attachmentId));
   log(tx,'lancamento',companyId,month,`Nota ${note.number} removida`);tx.set(api.doc(db,root),{hasRealData:true},{merge:true});return next;
 });
}
export async function getAttachment(id){requireUser();const s=await api.getDoc(api.doc(db,root+'/attachments/'+id));if(!s.exists())throw Error('Anexo não encontrado.');const d=s.data(),bytes=Uint8Array.from(atob(d.content),c=>c.charCodeAt(0));return {name:d.name,blob:new Blob([bytes],{type:d.mime})};}
export async function backupAll(state){requireUser();const s=await api.getDocs(api.collection(db,root+'/attachments'));return {...state,hasRealData:true,attachmentFiles:s.docs.map(d=>d.data())};}
export async function restoreAll(restored){
 requireUser();validateRestore(restored);
 const [companies,records,files]=await Promise.all(['companies','records','attachments'].map(k=>api.getDocs(api.collection(db,root+'/'+k))));
 const targets=[...restored.companies.map(c=>['companies',c.id,{...c,startMonth:c.startMonth||Object.keys(restored.records).filter(k=>k.startsWith(c.id+':')).map(k=>k.split(':')[1]).sort()[0]||monthKey()}]),...Object.entries(restored.records).map(([id,r])=>['records',id,r]),...(restored.attachmentFiles||[]).map(f=>['attachments',f.id,{...f,uid:user.uid}])];
 const keys=new Set(targets.map(([kind,id])=>kind+'/'+id));const removals=[...companies.docs.map(d=>['companies',d]),...records.docs.map(d=>['records',d]),...files.docs.map(d=>['attachments',d])].filter(([k,d])=>!keys.has(k+'/'+d.id));
 if(targets.length+removals.length>450)throw Error('Este backup exige uma importação assistida por conter mais de 450 registros.');
 const batch=api.writeBatch(db);for(const [kind,id,v]of targets)batch.set(api.doc(db,root+'/'+kind+'/'+id),v);for(const [,d]of removals)batch.delete(d.ref);batch.set(api.doc(db,root),{hasRealData:true},{merge:true});await batch.commit();
}
export async function importAll(plan){
 requireUser();
 const keys=Object.keys(plan.records),ids=[...new Set([...plan.companies.map(c=>c.id),...keys.map(k=>k.slice(0,k.lastIndexOf(':')))])];
 if(plan.companies.length+keys.length+ids.length+1>450)throw Error('Esta planilha exige uma importação assistida por conter mais de 450 registros.');
 await api.runTransaction(db,async tx=>{
   const records=await Promise.all(keys.map(k=>tx.get(api.doc(db,root+'/records/'+k)))),companies=await Promise.all(plan.companies.map(c=>tx.get(api.doc(db,root+'/companies/'+c.id))));
   if(records.some(s=>s.exists()&&s.data().launch!=='pending'))throw Error('Um dos meses foi lançado em outro aparelho durante a conferência. Abra a planilha novamente.');
   plan.companies.forEach((c,i)=>{const cur=companies[i].exists()?companies[i].data():null;tx.set(api.doc(db,root+'/companies/'+c.id),cur?{...cur,startMonth:[cur.startMonth,c.startMonth].filter(Boolean).sort()[0]}:c);});
   keys.forEach((k,i)=>{const prev=records[i].exists()?records[i].data():{},r=plan.records[k];tx.set(api.doc(db,root+'/records/'+k),{...blankRecord(),...prev,launch:'launched',amount:r.amount,paid:r.paid});});
   for(const id of ids){const n=keys.filter(k=>k.startsWith(id+':')).length;log(tx,'cadastro',id,'',`Importado da planilha: ${n} ${n===1?'mês':'meses'}`);}
   tx.set(api.doc(db,root),{hasRealData:true},{merge:true});
 });
}

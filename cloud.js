import {firebaseConfig} from './firebase-config.js';
import {validateData,blankRecord} from './domain.js';
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
   function emit(k){ready.add(k);if(ready.size===3){try{onData(validateData(structuredClone(state)));}catch(e){onError(e);}}}
   const error=e=>onError(e);
   stop.push(f.onSnapshot(f.doc(db,root),s=>{state.hasRealData=s.data()?.hasRealData===true;emit('meta');},error));
   stop.push(f.onSnapshot(f.collection(db,root+'/companies'),s=>{state.companies=s.docs.map(d=>d.data());emit('companies');},error));
   stop.push(f.onSnapshot(f.collection(db,root+'/records'),s=>{state.records=Object.fromEntries(s.docs.map(d=>[d.id,d.data()]));emit('records');},error));
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
   tx.set(entity,value);tx.set(api.doc(db,root),{hasRealData:true},{merge:true});
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
export async function getAttachment(id){requireUser();const s=await api.getDoc(api.doc(db,root+'/attachments/'+id));if(!s.exists())throw Error('Anexo não encontrado.');const d=s.data(),bytes=Uint8Array.from(atob(d.content),c=>c.charCodeAt(0));return {name:d.name,blob:new Blob([bytes],{type:d.mime})};}
export async function backupAll(state){requireUser();const s=await api.getDocs(api.collection(db,root+'/attachments'));return {...state,hasRealData:true,attachmentFiles:s.docs.map(d=>d.data())};}
export async function restoreAll(restored){
 requireUser();validateData(restored);if(restored.companies.some(c=>c.fictional||c.id.startsWith('demo-')))throw Error('Backups de demonstração não podem substituir os dados reais.');
 const [companies,records,files]=await Promise.all(['companies','records','attachments'].map(k=>api.getDocs(api.collection(db,root+'/'+k))));
 const targets=[...restored.companies.map(c=>['companies',c.id,c]),...Object.entries(restored.records).map(([id,r])=>['records',id,r]),...(restored.attachmentFiles||[]).map(f=>['attachments',f.id,f])];
 const keys=new Set(targets.map(([kind,id])=>kind+'/'+id));const removals=[...companies.docs.map(d=>['companies',d]),...records.docs.map(d=>['records',d]),...files.docs.map(d=>['attachments',d])].filter(([k,d])=>!keys.has(k+'/'+d.id));
 if(targets.length+removals.length>450)throw Error('Este backup exige uma importação assistida por conter mais de 450 registros.');
 const batch=api.writeBatch(db);for(const [kind,id,v]of targets)batch.set(api.doc(db,root+'/'+kind+'/'+id),v);for(const [,d]of removals)batch.delete(d.ref);batch.set(api.doc(db,root),{hasRealData:true},{merge:true});await batch.commit();
}

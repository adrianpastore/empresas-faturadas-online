import {blankRecord,monthKey,shiftMonth} from './domain.js';
export function initialDemo(month=monthKey()) {
 const data={version:1,hasRealData:false,companies:[],records:{}};
 const examples=[['Aurora Engenharia','boleto',486050,false,'requested',true],['Clínica Bem Viver','deposito',235000,true,'received',false],['Horizonte Transportes','boleto',312780,false,'pending',false],['Escola Jardim','deposito',168900,true,'requested',false],['Oficina Central','deposito',0,false,'pending',false],['Studio Forma','boleto',0,false,'pending',false]];
 examples.forEach(([name,method,amount,paid,receipt,boleto],i)=>{const id='demo-'+i;data.companies.push({id,name,method,dueDay:10,contacts:[],startMonth:shiftMonth(month,-1),fictional:true});data.records[`${id}:${month}`]={...blankRecord(),launch:amount?'launched':i===4?'none':'pending',amount,paid,receipt,boleto,due:amount?month+'-10':'',paidDate:paid?month+'-08':''};data.records[`${id}:${shiftMonth(month,-1)}`]={...blankRecord(),launch:amount?'launched':'none',amount,paid:!!amount,receipt:amount?'received':'pending',due:amount?shiftMonth(month,-1)+'-10':'',paidDate:amount?shiftMonth(month,-1)+'-08':''};});
 return data;
}
export function retireDemo(data) {
 return {...data,hasRealData:true,companies:data.companies.filter(c=>!c.fictional&&!c.id.startsWith('demo-')),records:Object.fromEntries(Object.entries(data.records).filter(([key])=>!key.startsWith('demo-')))};
}
export function shouldShowDemo(data,retired=false){return !retired&&!data.hasRealData&&!data.companies.some(c=>!c.fictional&&!c.id.startsWith('demo-'));}

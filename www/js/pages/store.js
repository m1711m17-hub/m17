import { h, icon, clear, toast } from '../lib/dom.js';
import { sb, state } from '../api.js';
import { headerBar } from './home.js';

const SERVICES = [['likes','♥','لايكات','زيادة الإعجابات على منشوراتك'],['followers','♟','متابعين','زيادة عدد متابعي حسابك'],['views','▶','مشاهدات','زيادة مشاهدات منشوراتك']];
const STATUS = {pending:'بانتظار المراجعة',approved:'تم قبول الدفع',rejected:'مرفوض',completed:'مكتمل'};
const esc = (v) => String(v ?? '');

export async function storePage(root) {
  const owner = state.me?.role === 'OWNER';
  let service = 'likes';
  const page = h('div', { class:'page store-page' });
  const serviceGrid = h('div', { class:'store-services' });
  const form = h('div', { class:'card-list store-card' });
  const ordersBox = h('div', { class:'card-list store-card' });
  const adminBox = h('div', { class:'card-list store-card' });
  const username = h('input', { class:'input', value:state.me?.username || '', disabled:true, dir:'ltr' });
  const postUrl = h('input', { class:'input', placeholder:'رابط المنشور داخل التطبيق', dir:'ltr' });
  const quantity = h('input', { class:'input', type:'number', min:1, max:1000000, placeholder:'مثال: 100' });
  const reference = h('input', { class:'input', placeholder:'رقم عملية شام كاش بعد التحويل (اختياري)', dir:'ltr' });
  const proof = h('input', { class:'input', type:'file', accept:'image/jpeg,image/png,image/webp' });
  const msg = h('p', { class:'form-err' });
  const submit = h('button', { class:'btn primary block lg', type:'button' }, 'إرسال طلب الشحن');
  const paintServices = () => {
    clear(serviceGrid);
    SERVICES.forEach(([key,ic,title,desc]) => serviceGrid.append(h('button',{class:'store-service'+(service===key?' on':''),onclick:()=>{service=key;paintServices();postUrl.parentElement.style.display=key==='followers'?'none':'';}},h('span',{class:'store-service-ic'},ic),h('b',null,title),h('small',null,desc))));
    postUrl.parentElement.style.display=service==='followers'?'none':'';
  };
  const orderList = h('div',{class:'store-orders'});
  const adminList = h('div',{class:'store-orders'});
  form.append(h('h3',{class:'sec'},'طلب شحن جديد'),
    h('label',{class:'lbl'},'حسابك في التطبيق'),username,
    h('label',{class:'lbl'},'رابط المنشور (للايكات والمشاهدات)'),postUrl,
    h('label',{class:'lbl'},'الكمية المطلوبة'),quantity,
    h('div',{class:'store-pay-placeholder'},h('b',null,'الدفع عبر شام كاش'),h('p',{class:'muted small'},'سيظهر باركود التحويل هنا بعد إضافته. لا تحوّل أي مبلغ حالياً.')),
    h('label',{class:'lbl'},'رقم عملية التحويل'),reference,
    h('label',{class:'lbl'},'صورة إيصال التحويل'),proof,
    h('p',{class:'muted small'},'لن نطلب كلمة مرورك. لا ترسل الإيصال إلا بعد ظهور باركود ومبلغ الباقة المعتمد.'),
    msg,submit);
  ordersBox.append(h('h3',{class:'sec'},'طلباتي'),orderList);
  adminBox.append(h('h3',{class:'sec'},'إدارة طلبات المتجر'),h('p',{class:'muted small'},'تأكيد الدفع هنا لا ينفّذ الشحن تلقائياً؛ ربط الشحن الفعلي يحتاج آلية موثوقة داخل التطبيق.'),adminList);
  page.append(headerBar('متجر NEXORA',{back:true}),
    h('section',{class:'store-hero'},h('div',{class:'store-mark'},'N'),h('h2',null,'NEXORA STORE'),h('p',{class:'muted'},'اشحن التفاعل داخل حسابك بسهولة وأمان'),h('span',{class:'store-owner-tag'},'متجر التطبيق الرسمي')),
    h('h3',{class:'sec'},'اختر نوع الشحن'),serviceGrid,form,ordersBox,owner?adminBox:null);
  root.append(page);paintServices();

  submit.onclick=async()=>{
    const qty=Number(quantity.value), link=postUrl.value.trim(), file=proof.files?.[0];
    msg.textContent='';
    if(!Number.isInteger(qty)||qty<1||qty>1000000){msg.textContent='أدخل كمية صحيحة.';return;}
    if(service!=='followers'&&!link){msg.textContent='أدخل رابط المنشور.';return;}
    if(service!=='followers'){try{const u=new URL(link);if(!['https:','http:'].includes(u.protocol))throw 0;}catch{msg.textContent='رابط المنشور غير صحيح.';return;}}
    if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)){msg.textContent='صورة الإيصال يجب أن تكون JPG أو PNG أو WEBP وأقل من 5 ميغابايت.';return;}
    submit.disabled=true;submit.textContent='جارٍ إرسال الطلب…';
    try{
      let path=null;
      if(file){path=state.me.id+'/'+crypto.randomUUID()+'.'+(file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg');await sb.storage.upload('store-proofs',path,file);}
      await sb.from('store_orders').insert({user_id:state.me.id,service,target_username:state.me.username,post_url:service==='followers'?null:link,quantity:qty,payment_reference:reference.value.trim()||null,proof_path:path});
      toast('تم إرسال الطلب للمراجعة','ok');quantity.value='';postUrl.value='';reference.value='';proof.value='';await loadMine();if(owner)await loadAdmin();
    }catch(e){msg.textContent=e.message||'تعذّر إرسال الطلب.';}finally{submit.disabled=false;submit.textContent='إرسال طلب الشحن';}
  };

  async function loadMine(){
    try{const rows=await sb.from('store_orders').select('id,service,quantity,status,created_at,amount,currency,payment_reference').eq('user_id',state.me.id).order('created_at',{ascending:false}).limit(30);clear(orderList);if(!rows.length){orderList.append(h('p',{class:'muted small'},'لا توجد طلبات حتى الآن.'));return;}rows.forEach(o=>orderList.append(h('article',{class:'store-order'},h('div',{class:'row between'},h('b',null,(SERVICES.find(s=>s[0]===o.service)||[])[2]||o.service),h('span',{class:'store-status '+o.status},STATUS[o.status]||o.status)),h('p',{class:'muted small'},'الكمية: '+o.quantity.toLocaleString('en-US')+(o.amount?' · '+o.amount+' '+o.currency:'')),h('p',{class:'muted small'},new Date(o.created_at).toLocaleString('ar')))));}catch(e){clear(orderList).append(h('p',{class:'muted small'},e.message));}
  }
  async function signedProof(path){
    const r=await fetch(sb.url+'/storage/v1/object/sign/store-proofs/'+path,{method:'POST',headers:{apikey:(await import('../config.js')).SUPABASE_KEY,Authorization:'Bearer '+sb.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});
    if(!r.ok)throw new Error('تعذر فتح الإيصال');const d=await r.json();return sb.url+'/storage/v1'+d.signedURL;
  }
  async function loadAdmin(){
    try{
      const rows=await sb.from('store_orders').select('id,user_id,service,target_username,post_url,quantity,payment_reference,proof_path,status,created_at').order('created_at',{ascending:false}).limit(60);clear(adminList);
      if(!rows.length){adminList.append(h('p',{class:'muted small'},'لا توجد طلبات.'));return;}
      for(const o of rows){
        const card=h('article',{class:'store-order'},h('div',{class:'row between'},h('b',null,(SERVICES.find(s=>s[0]===o.service)||[])[2]+' · '+o.quantity),h('span',{class:'store-status '+o.status},STATUS[o.status]||o.status)),h('p',{class:'muted small'},'الحساب: @'+o.target_username),h('p',{class:'muted small'},new Date(o.created_at).toLocaleString('ar')));
        if(o.payment_reference)card.append(h('p',{class:'muted small'},'رقم العملية: '+o.payment_reference));
        if(o.post_url)card.append(h('a',{class:'store-proof-link',href:o.post_url,target:'_blank',rel:'noopener'},'فتح المنشور'));
        if(o.proof_path){const proofLink=h('button',{class:'btn ghost sm',onclick:async()=>{proofLink.disabled=true;try{const u=await signedProof(o.proof_path);window.open(u,'_blank','noopener');}catch(e){toast(e.message,'err');}finally{proofLink.disabled=false; }},},'عرض إيصال الدفع');card.append(proofLink);}
        if(o.status==='pending'){
          card.append(h('div',{class:'store-actions'},
            h('button',{class:'btn primary sm',onclick:()=>review(o.id,'approved')},'قبول الدفع'),
            h('button',{class:'btn danger sm',onclick:()=>review(o.id,'rejected')},'رفض الطلب')));
        }
        adminList.append(card);
      }
    }catch(e){clear(adminList).append(h('p',{class:'muted small'},e.message));}
  }
  async function review(id,status){
    try{await sb.from('store_orders').update({status,reviewed_at:new Date().toISOString()}).eq('id',id);toast(status==='approved'?'تم قبول الدفع':'تم رفض الطلب','ok');await loadAdmin();await loadMine();}catch(e){toast(e.message,'err');}
  }
  await loadMine();if(owner)await loadAdmin();
  return ()=>{};
}

// Local contract fixture only. No live API calls and no real user data.
const http=require('http');
const memory=new Map();
const state=typeof pm!=='undefined'&&pm.state?pm.state:{get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
const owner='11111111-1111-4111-8111-111111111111';
const list=data=>({object:'list',data,has_more:false,url:'/v1/fixtures'});
const price=(id)=>({id,object:'price',active:true,livemode:false,currency:'eur',unit_amount:id==='price_monthly'?500:id==='price_annual'?2500:10000,type:id==='price_lifetime'?'one_time':'recurring',recurring:id==='price_lifetime'?null:{interval:id==='price_monthly'?'month':'year',interval_count:1}});
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname,mode=(await state.get('stripe.mode'))||'empty';
 const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(path.startsWith('/__fixtures/')&&req.method==='POST'){await state.set('stripe.mode',path.split('/').pop());await state.set('stripe.checkout',null);return send({ok:true});}
 if(mode==='upstream-error')return send({error:{type:'api_error',message:'Fixture upstream failure'}},500);
 if(path.startsWith('/v1/prices/'))return send(price(path.split('/').pop()));
 if(path==='/v1/customers'&&req.method==='POST')return send({id:'cus_fixture',object:'customer',livemode:false,metadata:{vodown_user_id:owner}});
 if(path==='/v1/subscriptions')return send(list(mode==='active'?[{id:'sub_fixture',object:'subscription',customer:'cus_fixture',livemode:false,status:'active',cancel_at_period_end:false,metadata:{vodown_user_id:owner},items:list([{id:'si_fixture',object:'subscription_item',quantity:1,price:price('price_monthly'),current_period_end:Math.floor(Date.now()/1000)+86400}])}]:[]));
 if(path==='/v1/checkout/sessions'&&req.method==='GET')return send(list(['lifetime','refunded','disputed','dispute-won'].includes(mode)?[{id:'cs_lifetime',object:'checkout.session',customer:'cus_fixture',livemode:false,status:'complete',mode:'payment',payment_status:'paid',payment_intent:'pi_fixture',metadata:{vodown_user_id:owner}}]:[]));
 if(path==='/v1/checkout/sessions'&&req.method==='POST'){
  const parameters=new URLSearchParams(typeof req.body==='string'?req.body:undefined);
  // The real SDK sends form encoding, including a server-selected price and customer.
  if(req.headers['content-type']&&!req.headers['content-type'].includes('application/x-www-form-urlencoded'))return send({error:{type:'invalid_request_error'}},400);
  const checkout={id:'cs_fixture',object:'checkout.session',customer:'cus_fixture',livemode:false,status:'open',url:'https://checkout.stripe.com/c/pay/fixture',expires_at:Math.floor(Date.now()/1000)+3600};
  await state.set('stripe.checkout',checkout);return send(checkout);
 }
 if(path==='/v1/checkout/sessions/cs_fixture')return send((await state.get('stripe.checkout'))||{id:'cs_fixture',object:'checkout.session',status:'expired'});
 if(path==='/v1/checkout/sessions/cs_fixture/expire'){await state.set('stripe.checkout',null);return send({id:'cs_fixture',object:'checkout.session',status:'expired'});}
 if(path==='/v1/checkout/sessions/cs_lifetime/line_items')return send(list([{id:'li_fixture',object:'item',price:price('price_lifetime'),quantity:1}]));
 if(path==='/v1/payment_intents/pi_fixture')return send({id:'pi_fixture',object:'payment_intent',customer:'cus_fixture',status:'succeeded',latest_charge:{id:'ch_fixture',object:'charge',paid:true,amount_refunded:mode==='refunded'?10000:0,disputed:['disputed','dispute-won'].includes(mode)}});
 if(path==='/v1/disputes')return send(list([{id:'dp_fixture',object:'dispute',status:mode==='dispute-won'?'won':'needs_response'}]));
 if(path==='/v1/billing_portal/sessions')return send({id:'bps_fixture',object:'billing_portal.session',url:'https://billing.stripe.com/p/session/fixture'});
 return send({error:{type:'api_error',message:'Endpoint outside fixture contract'}},501);
}).listen(process.env.PORT||4900);

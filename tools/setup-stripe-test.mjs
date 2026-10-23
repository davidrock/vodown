import {readFile,writeFile} from 'node:fs/promises';
const path='.local/vodown-server-secrets.json';
const config=JSON.parse(await readFile(path,'utf8'));
const key=config.Stripe.SecretKey;
if(!/^sk_test_[A-Za-z0-9]{40,}$/.test(key))throw new Error('A complete Stripe TEST secret key is required.');
async function stripe(method,path,data,idempotencyKey){
  const response=await fetch(`https://api.stripe.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${key}`,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey}:{})},body:method==='POST'?new URLSearchParams(data):undefined,signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok)throw new Error(`Stripe setup failed: HTTP ${response.status}; ${result.error?.type||'unknown error'}`);
  if(result.livemode)throw new Error('Live Stripe object refused.');
  return result;
}
const products=await stripe('GET','products?limit=100');
let product=products.data.find(p=>p.metadata?.app==='vodown'&&p.active);
if(!product)product=await stripe('POST','products',{'name':'Vodown PRO','description':'Recursos PRO do app Vodown.','metadata[app]':'vodown'},'vodown-product-pro-v1');
const definitions=[['MonthlyPriceId','monthly',500,'month'],['AnnualPriceId','annual',2500,'year'],['LifetimePriceId','lifetime',10000,null]];
const prices=await stripe('GET',`prices?product=${product.id}&active=true&limit=100`);
for(const [setting,plan,amount,period] of definitions){
  const lookup=`vodown_pro_${plan}_eur_v1`;
  let price=prices.data.find(p=>p.lookup_key===lookup);
  if(!price){
    const params={product:product.id,currency:'eur',unit_amount:String(amount),lookup_key:lookup,'metadata[app]':'vodown'};
    if(period)params['recurring[interval]']=period;
    price=await stripe('POST','prices',params,`vodown-price-${plan}-eur-v1`);
  }
  if(price.unit_amount!==amount||price.currency!=='eur'||(price.recurring?.interval??null)!==period)throw new Error('Existing test price differs from the agreed catalog.');
  config.Stripe[setting]=price.id;
}
const portals=await stripe('GET','billing_portal/configurations?limit=100');
let portal=portals.data.find(p=>p.metadata?.app==='vodown'&&p.active);
if(!portal)portal=await stripe('POST','billing_portal/configurations',{
  'business_profile[headline]':'Gerencie sua assinatura Vodown',
  'features[subscription_cancel][enabled]':'true','features[subscription_cancel][mode]':'at_period_end',
  'features[payment_method_update][enabled]':'true','features[invoice_history][enabled]':'true',
  'metadata[app]':'vodown'
},'vodown-portal-v1');
config.Stripe.PortalConfigurationId=portal.id;
await writeFile(path,JSON.stringify(config),{mode:0o600});
console.log(JSON.stringify({testMode:true,product:product.id,monthlyEUR:5,annualEUR:25,lifetimeEUR:100,portalConfigured:true}));

import {readFile,writeFile,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const path='.local/vodown-server-secrets.json';
const config=JSON.parse(await readFile(path,'utf8'));
if(!config.Stripe.SecretKey.startsWith('sk_test_'))throw new Error('Stripe TEST key required.');
const log=await open('.local/stripe-listen.log','w',0o600);
const events=['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','charge.refunded','charge.dispute.created','charge.dispute.closed','payment_intent.succeeded'];
const child=spawn(resolve('.local/stripe'),['listen','--forward-to','http://localhost:5080/v1/billing/webhook','--events',events.join(',')],{env:{...process.env,STRIPE_API_KEY:config.Stripe.SecretKey},stdio:['ignore','pipe','pipe'],shell:false});
let buffer='',configured=false;
async function consume(data){
  const text=data.toString();await log.write(text);buffer=(buffer+text).slice(-12000);
  const match=buffer.match(/whsec_[A-Za-z0-9]+/);
  if(match&&!configured){configured=true;const latest=JSON.parse(await readFile(path,'utf8'));latest.Stripe.WebhookSecret=match[0];await writeFile(path,JSON.stringify(latest),{mode:0o600});console.log('Stripe test forwarding ready. Signing secret stored privately.');}
}
child.stdout.on('data',data=>{void consume(data);});child.stderr.on('data',data=>{void consume(data);});
child.on('exit',async code=>{await log.close();process.exit(code??1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

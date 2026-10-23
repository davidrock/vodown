import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const config=JSON.parse(await readFile('.local/vodown-server-secrets.json','utf8'));
if(!config.Stripe.SecretKey.startsWith('sk_test_'))throw new Error('Only Stripe test mode is allowed.');
const child=spawn(resolve('.local/stripe'),process.argv.slice(2),{env:{...process.env,STRIPE_API_KEY:config.Stripe.SecretKey},stdio:'inherit',shell:false});
child.on('exit',code=>process.exit(code??1));

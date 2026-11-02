import {readPublicConfig} from '../../runtime-config';
export function GET() {
  try {readPublicConfig(process.env);return Response.json({status:'ok', service:'vodown-web'});}
  catch {return Response.json({status:'not_ready',service:'vodown-web'},{status:503});}
}

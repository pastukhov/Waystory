import {observe} from '../request-context.mjs';
export async function tourStage(stage,fields,work,{now=Date.now}={}){
 const started=now();let value,error;
 try{return value=await work()}catch(e){error=e;throw e}finally{
  const statuses=stage==='research'?value?.statuses||[]:[];
  const researchReason=statuses.some(s=>s.reason==='timeout')?'provider_timeout':statuses.some(s=>['budget_exhausted','daily_limit'].includes(s.reason))?'budget_exhausted':statuses.some(s=>s.status==='unavailable')?'source_unavailable':null;
  const reason=error?.code||value?.error?.code||value?.issues?.[0]?.reason||researchReason;
  const outcome=reason==='budget_exhausted'?'budget':reason==='provider_timeout'||error?.name==='TimeoutError'?'timeout':researchReason==='source_unavailable'&&!value?.documents?.some(d=>d.text)||error||value?.status==='failed'||value?.outcome==='error'?'error':value?.outcome==='rejected'?'rejected':value?.status==='insufficient'||stage==='research'&&(!value?.documents?.some(d=>d.text)||statuses.some(s=>['partial','unavailable'].includes(s.status)))||stage==='plan'&&(!value?.length||value?.some(t=>t.status==='limited'))?'limited':'success';
  observe('tour_job',{...fields,stage,outcome,reason,reasons:value?.issues?.map(x=>x.reason),diagnosticId:error?.diagnosticId||value?.error?.diagnosticId,durationMs:now()-started});
 }
}

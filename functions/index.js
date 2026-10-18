import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { applyAction, settle } from './service.mjs';
import { dayKey } from './domain.mjs';
import { randomUUID } from 'node:crypto';
import { onValueWritten } from 'firebase-functions/v2/database';
initializeApp();
const region='asia-southeast1';
export const syncPointLeaderboard=onValueWritten({ref:'/users/{uid}',region},async event=>{
  const profile=event.data.after.val();
  await getDatabase().ref(`pointLeaderboard/${event.params.uid}`).set(profile&&profile.role!=='teacher'?{name:profile.name||'학생',points:Number(profile.points||0)}:null);
});
export const brainAction=onCall({region, maxInstances:10}, async request=>{
  if(!request.auth) throw new HttpsError('unauthenticated','로그인이 필요합니다.');
  const input=request.data||{}, uid=request.auth.uid, now=Date.now(), id=randomUUID();
  if(!['start','finish','purchase'].includes(input.action)) throw new HttpsError('invalid-argument','요청 형식 오류');
  if(input.action==='purchase'&&(!/^[a-zA-Z0-9-]{10,80}$/.test(input.requestId||'')||typeof input.productId!=='string')) throw new HttpsError('invalid-argument','구매 요청 오류');
  let failure;
  const tx=await getDatabase().ref().transaction(state=>{
    if(!state) return state;
    try { failure=null; return applyAction(state,uid,input.action,input,now,id); }
    catch(e){failure=e.message;return;}
  });
  if(!tx.committed||failure) throw new HttpsError('failed-precondition',failure||'잠시 후 다시 시도해주세요.');
  const state=tx.snapshot.val();
  if(input.action==='purchase') return {points:state.users[uid].points};
  const key=input.mode==='daily'?(input.day||dayKey(now)):'practice';
  return {session:state.brain.sessions[uid][key],serverNow:now};
});
// Retries are safe: reward receipt and wallet are updated in the same transaction.
export const settleBrainDay=onSchedule({region,schedule:'0 6 * * *',timeZone:'Asia/Seoul',retryCount:3},async()=>{
  const now=Date.now();
  await getDatabase().ref().transaction(state=>state?settle(state,now):state);
});

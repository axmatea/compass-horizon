// Technical abuse bounds for the single-instance account preview. These are
// process-local windows, not product quotas, balances or financial entitlements.
export const ACCOUNT_RATE_RULES=Object.freeze({
  read:Object.freeze({limit:300,windowMs:60000}),
  mutation:Object.freeze({limit:60,windowMs:60000}),
  connect:Object.freeze({limit:10,windowMs:600000}),
  billing:Object.freeze({limit:10,windowMs:60000}),
});
export function createAccountRateLimiter({now=Date.now,maxOwners=1000}={}) {
  if(typeof now!=='function'||!Number.isSafeInteger(maxOwners)||maxOwners<1||maxOwners>1000)throw new TypeError('Invalid account rate limiter configuration');
  const owners=new Map();
  const rulesFor=(method,path)=>{
    const rules=['GET','HEAD'].includes(method)?['read']:['mutation'];
    if(method==='POST'&&/^\/api\/account\/integrations\/[a-z-]+\/connect$/.test(path))rules.push('connect');
    if(method==='POST'&&/^\/api\/account\/billing\/(checkout|portal|cancel)$/.test(path))rules.push('billing');
    return rules;
  };
  function check(owner,{method='GET',path=''}={}) {
    if(typeof owner!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(owner))throw new TypeError('A verified owner is required');
    const at=now();if(!Number.isSafeInteger(at)||at<0)throw new TypeError('Invalid account rate clock');
    for(const [key,entry]of owners)if(entry.expiresAt<=at)owners.delete(key);
    let entry=owners.get(owner);
    if(!entry){if(owners.size>=maxOwners)owners.delete(owners.keys().next().value);entry={windows:{},expiresAt:at};}
    // Refresh recency without extending any quota window. The map is bounded
    // even if a future identity rollout admits more than the present 50 users.
    owners.delete(owner);owners.set(owner,entry);
    const rules=rulesFor(method,path);
    for(const rule of rules){const window=entry.windows[rule];if(!window||window.resetAt<=at)entry.windows[rule]={count:0,resetAt:at+ACCOUNT_RATE_RULES[rule].windowMs};}
    entry.expiresAt=Math.max(...Object.values(entry.windows).map(window=>window.resetAt));
    const blocked=rules.filter(rule=>entry.windows[rule].count>=ACCOUNT_RATE_RULES[rule].limit);
    if(blocked.length)return {allowed:false,retryAfterSeconds:Math.max(1,...blocked.map(rule=>Math.ceil((entry.windows[rule].resetAt-at)/1000)))};
    // Both the general and stricter category must fit before incrementing any
    // counter. A rejected retry cannot consume or extend another category.
    for(const rule of rules)entry.windows[rule].count++;
    return {allowed:true};
  }
  return {check,get size(){return owners.size}};
}

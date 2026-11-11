import worker from '../src/worker.js';
const env={APP_ORIGIN:'https://demo.example'};
const ok=await worker.fetch(new Request('https://api.example/api/health'),env);
if(ok.status!==200 || !(await ok.json()).ok) throw new Error('health route failed');
const blocked=await worker.fetch(new Request('https://api.example/api/auth/request-code',{method:'POST',headers:{'content-type':'application/json','origin':'https://evil.example'},body:JSON.stringify({phone:'13800000000'})}),env);
if(blocked.status!==403) throw new Error('origin guard failed');
console.log('Worker smoke tests: PASS (health route, Origin rejection).');

export class BackplaneClient {
  constructor() {}
  async hello() { return {protocol:1}; }
  async observe(obs:any){ return {accepted:true}; }
  async observeMany(obs:any[]){ return {accepted: obs.length}; }
  async baseline(){ return {baseline:null}; }
  async advance(to:string, expected:string|null){ return {baseline: to}; }
  async affected(changes:any, options:any){ return {protocol:1, tasks:[], fallback:null, confidence:'medium', skipped:0}; }
  async explain(task:string){ return {}; }
  async forget(task:string){ return {forgotten:true}; }
  async stats(){ return {}; }
  async compact(){ return {before_bytes:0, after_bytes:0}; }
  async close(){}
}
export function connect(opts?:any){ return Promise.resolve(new BackplaneClient()); }

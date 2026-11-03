export interface Hello { protocol:number; }
export interface Observation { task:string; baseline:string; dirty:boolean; context:any; inputs:any[]; outputs:any[]; outcome:string; duration_ms:number; }
export interface ChangeSet { baseline:string; head:string; changes:any[]; }
export interface Plan { protocol:number; tasks:any[]; fallback:any; confidence:string; skipped:number; }

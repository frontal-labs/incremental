export class AffectraError extends Error { code:any; data:any; constructor(c:any,m:string,d:any){super(m);this.code=c;this.data=d;} }

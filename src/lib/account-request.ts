// A response may publish only while both its identity/scope and generation match.
export class AccountRequest {
  private generation=0;
  private controller:AbortController|null=null;
  cancel(){this.generation++;this.controller?.abort();this.controller=null;}
  start(){
    this.cancel();
    const generation=this.generation;
    const controller=new AbortController();this.controller=controller;
    return {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),
      current:()=>generation===this.generation&&!controller.signal.aborted};
  }
}

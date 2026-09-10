import { create } from 'zustand'
import type { AppSettings, BatchRecord, JobDetail, JobRecord, ProductRecord, WorkerEvent } from '../../shared/types'

export interface LogLine { at:string; level:'info'|'warn'|'error'; message:string; jobId?:string }
interface AppState {
  jobs: JobRecord[]; batches: BatchRecord[]; activeDetail: JobDetail|null; settings: AppSettings|null; logs: LogLine[]
  setJobs(jobs:JobRecord[]):void; setBatches(batches:BatchRecord[]):void; setActiveDetail(detail:JobDetail|null):void; setSettings(settings:AppSettings):void; applyEvent(event:WorkerEvent):void
}
export const useAppStore=create<AppState>((set)=>({
  jobs:[],batches:[],activeDetail:null,settings:null,logs:[],
  setJobs:(jobs)=>set({jobs}), setBatches:(batches)=>set({batches}), setActiveDetail:(activeDetail)=>set({activeDetail}), setSettings:(settings)=>set({settings}),
  applyEvent:(event)=>set((state)=>{
    if(event.type==='log') return {logs:[...state.logs.slice(-499),event]}
    if(event.type==='batch') { const exists=state.batches.some((b)=>b.id===event.batch.id); return {batches:exists?state.batches.map((b)=>b.id===event.batch.id?event.batch:b):[event.batch,...state.batches]} }
    if(event.type==='job') {
      const exists=state.jobs.some((j)=>j.id===event.job.id); const jobs=exists?state.jobs.map((j)=>j.id===event.job.id?event.job:j):[event.job,...state.jobs]
      let activeDetail=state.activeDetail?.job.id===event.job.id?{...state.activeDetail,job:event.job}:state.activeDetail
      const activeStatuses=['discovering','scraping','validating','comparing']
      if (state.activeDetail?.job.batchId && event.job.batchId === state.activeDetail.job.batchId && event.job.id !== state.activeDetail.job.id && activeStatuses.includes(event.job.status)) {
        activeDetail={job:event.job,products:[],comparison:null}
      }
      return {jobs,activeDetail}
    }
    if(event.type==='product'&&state.activeDetail?.job.id===event.jobId){const products=upsert(state.activeDetail.products,event.product);return{activeDetail:{...state.activeDetail,products}}}
    if(event.type==='comparison'&&state.activeDetail?.job.id===event.jobId)return{activeDetail:{...state.activeDetail,comparison:event.summary}}
    return state
  })
}))
function upsert(products:ProductRecord[],incoming:ProductRecord){const i=products.findIndex((p)=>p.id===incoming.id);if(i<0)return[...products,incoming];const x=[...products];x[i]=incoming;return x}

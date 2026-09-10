import { useEffect, useState } from 'react'
import type { AppSettings, BatchRecord, JobRecord } from '../../shared/types'
import { Nav, type PageName } from './components/Nav'
import { HistoryPage } from './pages/HistoryPage'
import { ProductsPage } from './pages/ProductsPage'
import { ScrapePage } from './pages/ScrapePage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppStore } from './store'
export default function App(){
  const[page,setPage]=useState<PageName>('scrape');const setJobs=useAppStore((s)=>s.setJobs);const setBatches=useAppStore((s)=>s.setBatches);const setSettings=useAppStore((s)=>s.setSettings);const applyEvent=useAppStore((s)=>s.applyEvent)
  useEffect(()=>{const off=window.aventics.onWorkerEvent(applyEvent);void Promise.all([window.aventics.request<JobRecord[]>({type:'listJobs'}),window.aventics.request<BatchRecord[]>({type:'listBatches'}),window.aventics.getSettings()]).then(([jobs,batches,settings]:[JobRecord[],BatchRecord[],AppSettings])=>{setJobs(jobs);setBatches(batches);setSettings(settings)});return off},[applyEvent,setJobs,setBatches,setSettings])
  return <div className="flex min-h-screen bg-slate-100 text-slate-900"><Nav page={page} onChange={setPage}/><main className="min-w-0 flex-1 overflow-auto"><div className="mx-auto max-w-[1550px] p-6 lg:p-8">{page==='scrape'&&<ScrapePage/>}{page==='products'&&<ProductsPage/>}{page==='history'&&<HistoryPage onOpenJob={()=>setPage('scrape')}/>} {page==='settings'&&<SettingsPage/>}</div></main></div>
}

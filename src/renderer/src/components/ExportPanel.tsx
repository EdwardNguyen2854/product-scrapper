import { useEffect, useMemo, useState } from 'react'
import { Download, Save, X } from 'lucide-react'
import type { ExportFieldSelection, ExportFormat, ExportPreset, ExportSchema, JobRecord } from '../../../shared/types'
import { useAppStore } from '../store'
import { Button, Card, Input } from './ui'

const emptySelection: ExportFieldSelection={core:[],specifications:[],assets:[],comparison:[]}

export function ExportPanel({job,onClose}:{job:JobRecord;onClose:()=>void}){
  const settings=useAppStore((s)=>s.settings)
  const[format,setFormat]=useState<ExportFormat>('xlsx')
  const[schema,setSchema]=useState<ExportSchema|null>(null)
  const[presets,setPresets]=useState<ExportPreset[]>([])
  const[presetId,setPresetId]=useState('builtin-full')
  const[selection,setSelection]=useState<ExportFieldSelection>(emptySelection)
  const[presetName,setPresetName]=useState('')
  const[busy,setBusy]=useState(false)
  const[message,setMessage]=useState('')

  useEffect(()=>{void Promise.all([window.aventics.request<ExportSchema>({type:'getExportSchema',jobId:job.id}),window.aventics.request<ExportPreset[]>({type:'listPresets'})]).then(([s,p])=>{setSchema(s);setPresets(p);setSelection({core:[...s.core],specifications:[...s.specifications],assets:[...s.assets],comparison:[...s.comparison]})}).catch((e)=>setMessage(e instanceof Error?e.message:String(e)))},[job.id])

  const selectedPreset=useMemo(()=>presets.find((p)=>p.id===presetId),[presets,presetId])
  useEffect(()=>{if(!selectedPreset||!schema)return;setFormat(selectedPreset.format);setSelection({core:[...selectedPreset.selection.core],specifications:selectedPreset.selection.specifications.includes('*')?[...schema.specifications]:[...selectedPreset.selection.specifications],assets:[...selectedPreset.selection.assets],comparison:[...selectedPreset.selection.comparison]})},[selectedPreset?.id,schema])

  function toggle(group:keyof ExportFieldSelection,field:string){setPresetId('');setSelection((s)=>({...s,[group]:s[group].includes(field)?s[group].filter((x)=>x!==field):[...s[group],field]}))}
  function all(on:boolean){if(!schema)return;setPresetId('');setSelection(on?{core:[...schema.core],specifications:[...schema.specifications],assets:[...schema.assets],comparison:[...schema.comparison]}:emptySelection)}
  async function savePreset(){if(!presetName.trim())return;try{const id=crypto.randomUUID();const p=await window.aventics.request<ExportPreset>({type:'savePreset',preset:{id,name:presetName.trim(),format,selection}});setPresets((x)=>[...x,p]);setPresetId(p.id);setPresetName('');setMessage('Preset saved.')}catch(e){setMessage(e instanceof Error?e.message:String(e))}}
  async function runExport(){if(!settings)return;setBusy(true);setMessage('');try{const path=await window.aventics.request<string>({type:'export',request:{jobId:job.id,outputDirectory:settings.outputDirectory,format,selection}});setMessage(`Exported: ${path}`);await window.aventics.openPath(path)}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}

  return <Card className="p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-slate-900">Export {job.seriesName}</h3><p className="mt-1 text-xs text-slate-500">Choose columns and format. Selection applies to the Excel Products sheet and products.csv; normalized JSON always contains full data.</p></div><Button variant="ghost" onClick={onClose}><X size={16}/></Button></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[220px_160px_1fr]"><div><label className="mb-1 block text-xs text-slate-500">Preset</label><select className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={presetId} onChange={(e)=>setPresetId(e.target.value)}><option value="">Custom selection</option>{presets.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div><label className="mb-1 block text-xs text-slate-500">Format</label><select className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={format} onChange={(e)=>{setPresetId('');setFormat(e.target.value as ExportFormat)}}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV folder</option><option value="json">JSON</option></select></div><div className="flex items-end justify-end gap-2"><Button variant="secondary" onClick={()=>all(true)}>Select all</Button><Button variant="secondary" onClick={()=>all(false)}>Clear</Button></div></div>
    {schema&&<div className="mt-4 grid gap-4 lg:grid-cols-4"><FieldGroup title="Core" fields={schema.core} selected={selection.core} onToggle={(f)=>toggle('core',f)}/><FieldGroup title={`Specifications (${schema.specifications.length})`} fields={schema.specifications} selected={selection.specifications} onToggle={(f)=>toggle('specifications',f)} scroll/><FieldGroup title="Assets" fields={schema.assets} selected={selection.assets} onToggle={(f)=>toggle('assets',f)}/><FieldGroup title="Comparison" fields={schema.comparison} selected={selection.comparison} onToggle={(f)=>toggle('comparison',f)}/></div>}
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4"><div className="min-w-56"><label className="mb-1 block text-xs text-slate-500">Save current selection as preset</label><Input value={presetName} onChange={(e)=>setPresetName(e.target.value)} placeholder="My QC Export"/></div><Button variant="secondary" disabled={!presetName.trim()} onClick={savePreset}><Save size={15}/>Save preset</Button><div className="flex-1"/><Button onClick={runExport} disabled={busy}><Download size={15}/>{busy?'Exporting…':'Export'}</Button></div>{message&&<div className="mt-3 text-xs text-slate-500 break-all">{message}</div>}
  </Card>
}
function FieldGroup({title,fields,selected,onToggle,scroll=false}:{title:string;fields:string[];selected:string[];onToggle:(field:string)=>void;scroll?:boolean}){return <div><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div><div className={`rounded-lg border border-slate-200 bg-slate-50 p-2 ${scroll?'max-h-56 overflow-auto':''}`}>{fields.length===0&&<div className="p-2 text-xs text-slate-400">No fields</div>}{fields.map((f)=><label key={f} className="flex items-start gap-2 rounded px-2 py-1.5 text-xs text-slate-700 hover:bg-white"><input type="checkbox" checked={selected.includes(f)} onChange={()=>onToggle(f)} className="mt-0.5"/><span>{f}</span></label>)}</div></div>}

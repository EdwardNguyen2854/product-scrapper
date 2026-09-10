import { existsSync } from 'node:fs'
import { join } from 'node:path'
console.log('AVENTICS Product Scraper v0.2.5 - environment check')
console.log(`Platform: ${process.platform} ${process.arch}`)
console.log(`Node: ${process.version}`)
if (process.platform !== 'win32') console.log('WARN: v0.2.5 distribution target is Windows x64.')
const roots=[process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA].filter(Boolean)
const candidates=roots.flatMap((root)=>[join(root,'Microsoft','Edge','Application','msedge.exe'),join(root,'Microsoft','Edge Beta','Application','msedge.exe'),join(root,'Microsoft','Edge Dev','Application','msedge.exe')])
const edge=candidates.find(existsSync)
if(process.platform==='win32') console.log(edge?`Edge: ${edge}`:'WARN: Microsoft Edge executable was not found in common locations.')
const[major,minor]=process.versions.node.split('.').map(Number)
const supported=(major===22&&minor>=12)||major>22
if(!supported){console.error('ERROR: Development requires Node.js 22.12+ or a newer supported release.');process.exitCode=1}else console.log('Node version: OK')

const electronPackage=join(process.cwd(),'node_modules','electron','install.js')
const electronPath=join(process.cwd(),'node_modules','electron','path.txt')
if(existsSync(electronPackage)&&!existsSync(electronPath)){
  console.log('WARN: Electron npm package exists but its runtime binary is missing. Run: npm run ensure:electron')
  if(process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy){
    console.log('Proxy variables detected; ensure:electron will enable ELECTRON_GET_USE_PROXY for the repair.')
  }
}else if(existsSync(electronPath)) console.log('Electron runtime: installed')

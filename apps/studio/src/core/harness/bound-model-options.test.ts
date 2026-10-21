import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareBoundModelOptions } from './bound-model-options';
import type { ModelControl } from '../generation-providers/model-controls';
const controls: ModelControl[] = [
 {key:'seconds',label:'Seconds',type:'number',min:.1,max:10,default:1},
 {key:'enabled',label:'Enabled',type:'boolean',default:true},
 {key:'caption',label:'Caption',type:'string',maxLength:20,default:''},
 {key:'style',label:'Style',type:'select',choices:[{value:'one',label:'One'},{value:'two',label:'Two'}],default:'one'},
];
const binding=(target:string)=>({node:'source',pointer:'/value',target});
test('bound numbers, booleans, strings and choices use inert defaults while fixed inputs retain validation',()=>{
 const raw={seconds:0,enabled:null,caption:[],style:false}; const original=JSON.stringify(raw);
 assert.deepEqual(prepareBoundModelOptions(controls,raw,Object.keys(raw).map(key=>binding('/parameters/provider_options/'+key))),{seconds:1,enabled:true,caption:'',style:'one'});
 assert.equal(JSON.stringify(raw),original);
 assert.throws(()=>prepareBoundModelOptions(controls,{seconds:0,style:'invalid'},[binding('/parameters/provider_options/seconds')]),/Style/);
 assert.throws(()=>prepareBoundModelOptions(controls,{seconds:0},[binding('/prompt')]),/Seconds/);
});
test('a whole options map is deferred; unknown individual keys, nested members and absent slots are rejected',()=>{
 assert.deepEqual(prepareBoundModelOptions(controls,null,[binding('/parameters/provider_options')]),{seconds:1,enabled:true,caption:'',style:'one'});
 assert.throws(()=>prepareBoundModelOptions(controls,undefined,[binding('/parameters/provider_options')]),/existing placeholder/);
 assert.throws(()=>prepareBoundModelOptions(controls,{},[binding('/parameters/provider_options'),binding('/parameters/provider_options/seconds')]),/overlap/);
 assert.throws(()=>prepareBoundModelOptions(controls,{unknown:0},[binding('/parameters/provider_options/unknown')]),/Unknown bound/);
 assert.throws(()=>prepareBoundModelOptions(controls,{seconds:{}},[binding('/parameters/provider_options/seconds/value')]),/nested/);
 assert.throws(()=>prepareBoundModelOptions(controls,{},[binding('/parameters/provider_options/seconds')]),/existing placeholder/);
 assert.throws(()=>prepareBoundModelOptions(controls,{seconds:0,unknown:true},[binding('/parameters/provider_options/seconds')]),/Unknown model option/);
 assert.throws(()=>prepareBoundModelOptions(controls,{},[binding('/parameters/provider_options/__proto__')]),/Unsafe/);
});

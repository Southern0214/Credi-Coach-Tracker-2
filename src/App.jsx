import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabase.js";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TODAY      = new Date();
const THIS_MONTH = TODAY.getMonth();
const THIS_YEAR  = TODAY.getFullYear();
const TODAY_DAY  = TODAY.getDate();

const STATUS_CONFIG = {
  paid:    { label:"Paid",    color:"#22c55e", bg:"#052e16" },
  due:     { label:"Due",     color:"#facc15", bg:"#1a1600" },
  missed:  { label:"Missed",  color:"#ef4444", bg:"#200000" },
  pending: { label:"Pending", color:"#94a3b8", bg:"#0f172a" },
};

const CREDIT_MONITORING_OPTIONS = ["Credit Hero Score","Grow Funders","Other"];
const SERVICE_OPTIONS = ["Repair","Funding","Tradelines","Inquiry Removal","Buildout"];
const FOLLOWUP_STATUS_OPTIONS = ["Hot","Warm","Cold","No Answer","Lost"];

function genId() { return Math.random().toString(36).slice(2,10); }
function getPKey(cid,m,y) { return `pay_${cid}_${y}_${m}`; }
function getQKey(m,y)     { return `quotes_${y}_${m}`; }
function fmt(n) { const v=parseFloat(n); return isNaN(v)?"—":`$${v.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`; }

function effectiveStatus(client, rawStatus, viewMonth, viewYear) {
  if (rawStatus==="paid")   return "paid";
  if (rawStatus==="missed") return "missed";
  const dueDay = parseInt(client.dueDay);
  if (!dueDay) return rawStatus;
  const isCurrentMonth = viewMonth===THIS_MONTH && viewYear===THIS_YEAR;
  const isPastMonth    = viewYear<THIS_YEAR || (viewYear===THIS_YEAR && viewMonth<THIS_MONTH);
  if (isPastMonth)                                                  return rawStatus==="paid"?"paid":"missed";
  if (isCurrentMonth && TODAY_DAY>dueDay)                           return "missed";
  if (isCurrentMonth && TODAY_DAY<=dueDay && rawStatus==="pending") return "due";
  return rawStatus;
}

function isClientActiveInMonth(client, month, year) {
  if (!client.createdAt) return true;
  const start   = new Date(client.createdAt);
  const startM  = start.getMonth();
  const startY  = start.getFullYear();
  const monthly = parseFloat(client.monthlyAmount);
  const total   = parseFloat(client.quotedTotal);
  if (!monthly || !total) return true;
  const numMonths = Math.round(total / monthly);
  let endM = startM + numMonths - 1;
  let endY = startY + Math.floor(endM / 12);
  endM = endM % 12;
  return new Date(year,month,1) >= new Date(startY,startM,1) && new Date(year,month,1) <= new Date(endY,endM,1);
}

function getDaysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000*60*60*24));
}

function getDisputeStatus(daysSince) {
  if (daysSince === null) return "none";
  if (daysSince > 35) return "alarm";
  if (daysSince > 30) return "overdue";
  if (daysSince > 25) return "warning";
  return "ok";
}

function getFUColor(d) { if(d===null) return "#64748b"; if(d<=7) return "#22c55e"; if(d<=14) return "#facc15"; return "#ef4444"; }
function getFUBg(d)    { if(d===null) return "#0f172a"; if(d<=7) return "#052e16"; if(d<=14) return "#1a1600"; return "#200000"; }
function getFULabel(d) { if(d===null) return "NEW"; if(d<=7) return "ON TRACK"; if(d<=14) return "FOLLOW UP"; return "COLD"; }

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g,"").toLowerCase());
  return lines.slice(1).map(line => {
    const vals = []; let cur = "", inQ = false;
    for (let i=0;i<line.length;i++) {
      if (line[i]==='"') { inQ=!inQ; }
      else if (line[i]==="," && !inQ) { vals.push(cur.trim()); cur=""; }
      else { cur+=line[i]; }
    }
    vals.push(cur.trim());
    const row = {};
    headers.forEach((h,i) => { row[h] = (vals[i]||"").replace(/^"|"$/g,""); });
    return row;
  }).filter(r => Object.values(r).some(v=>v));
}

function mapCRCRow(row) {
  const firstName = row["first name"] || row["firstname"] || row["first"] || "";
  const lastName  = row["last name"]  || row["lastname"]  || row["last"]  || "";
  const find = (...keys) => { for (const k of keys) { const m=Object.keys(row).find(h=>h.includes(k)); if (m&&row[m]) return row[m]; } return ""; };
  return { id:genId(), firstName, lastName, processingDate:row["processing date"]||row["processingdate"]||find("process","date")||"", creditMonitoring:row["credit monitoring service"]||row["creditmonitoring"]||find("monitor")||"", service:row["service"]||find("service","type","program")||"", notes:row["notes"]||find("note","comment")||"", partnerId:"", createdAt:new Date().toISOString() };
}

async function dbGet(key) {
  const { data, error } = await supabase.from("tracker_data").select("value").eq("key", key).maybeSingle();
  if (error) { console.error("dbGet error", key, error); return null; }
  return data?.value ?? null;
}
async function dbSet(key, value) {
  const { error } = await supabase.from("tracker_data").upsert({ key, value }, { onConflict:"key" });
  if (error) console.error("dbSet error", key, error);
}

export default function ClientTracker() {
  const [clients,setClients]=useState([]);
  const [pifClients,setPifClients]=useState([]);
  const [completedClients,setCompletedClients]=useState([]);
  const [disputeClients,setDisputeClients]=useState([]);
  const [partners,setPartners]=useState([]);
  const [followUps,setFollowUps]=useState([]);
  const [payments,setPayments]=useState({});
  const [quotes,setQuotes]=useState({});
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState("payments");
  const [viewMonth,setViewMonth]=useState(THIS_MONTH);
  const [viewYear,setViewYear]=useState(THIS_YEAR);
  const [showAddClient,setShowAddClient]=useState(false);
  const [showAddPIF,setShowAddPIF]=useState(false);
  const [showAddQuote,setShowAddQuote]=useState(false);
  const [showAddDispute,setShowAddDispute]=useState(false);
  const [showAddPartner,setShowAddPartner]=useState(false);
  const [showAddFollowUp,setShowAddFollowUp]=useState(false);
  const [convertLead,setConvertLead]=useState(null);
  const [expandedFuId,setExpandedFuId]=useState(null);
  const [fuFilter,setFuFilter]=useState("all");
  const [fuSearch,setFuSearch]=useState("");
  const [selectedPartner,setSelectedPartner]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  const [expandedDispId,setExpandedDispId]=useState(null);
  const [filterStatus,setFilterStatus]=useState("all");
  const [disputeFilter,setDisputeFilter]=useState("all");
  const [searchQuery,setSearchQuery]=useState("");
  const [disputeSearch,setDisputeSearch]=useState("");
  const [payInput,setPayInput]=useState({});
  const [alarmDismissed,setAlarmDismissed]=useState(false);
  const [csvDragging,setCsvDragging]=useState(false);
  const [csvImportMsg,setCsvImportMsg]=useState("");
  const [newPartnerName,setNewPartnerName]=useState("");
  const csvFileRef=useRef();

  const blankClient={name:"",company:"",monthlyAmount:"",quotedTotal:"",dueDay:"",notes:"",partnerId:""};
  const blankPIF={name:"",company:"",amount:"",paidDate:"",notes:""};
  const blankQuote={name:"",company:"",amount:"",notes:""};
  const blankFollowUp={name:"",service:"",quotedAmount:"",lastContact:"",notes:"",status:"Hot"};
  const blankDispute={firstName:"",lastName:"",processingDate:"",creditMonitoring:"",service:"",notes:"",partnerId:""};

  const [newClient,setNewClient]=useState(blankClient);
  const [newPIF,setNewPIF]=useState(blankPIF);
  const [newQuote,setNewQuote]=useState(blankQuote);
  const [newDispute,setNewDispute]=useState(blankDispute);
  const [newFollowUp,setNewFollowUp]=useState(blankFollowUp);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      try {
        const [c,p,q,pif,comp,disp,part,fu]=await Promise.all([dbGet("clients"),dbGet("payments"),dbGet("quotes"),dbGet("pifClients"),dbGet("completedClients"),dbGet("disputeClients"),dbGet("partners"),dbGet("followUps")]);
        if(c)setClients(c);if(p)setPayments(p);if(q)setQuotes(q);if(pif)setPifClients(pif);if(comp)setCompletedClients(comp);if(disp)setDisputeClients(disp);if(part)setPartners(part);if(fu)setFollowUps(fu);
      }catch(e){console.error("Load error",e);}
      setLoading(false);
    }
    load();
  },[]);

  const saveClients=useCallback(async d=>{setClients(d);await dbSet("clients",d);},[]);
  const savePifClients=useCallback(async d=>{setPifClients(d);await dbSet("pifClients",d);},[]);
  const saveCompletedClients=useCallback(async d=>{setCompletedClients(d);await dbSet("completedClients",d);},[]);
  const saveDisputeClients=useCallback(async d=>{setDisputeClients(d);await dbSet("disputeClients",d);},[]);
  const savePartners=useCallback(async d=>{setPartners(d);await dbSet("partners",d);},[]);
  const saveFollowUps=useCallback(async d=>{setFollowUps(d);await dbSet("followUps",d);},[]);
  const savePayments=useCallback(async d=>{setPayments(d);await dbSet("payments",d);},[]);
  const saveQuotes=useCallback(async d=>{setQuotes(d);await dbSet("quotes",d);},[]);

  function getPayData(cid){return payments[getPKey(cid,viewMonth,viewYear)]||{status:"pending",amountPaid:0};}

  function setStatus(cid,status){
    const key=getPKey(cid,viewMonth,viewYear);const ex=payments[key]||{status:"pending",amountPaid:0};const client=clients.find(c=>c.id===cid);
    if(status==="paid"&&client&&parseFloat(client.monthlyAmount)>0&&(parseFloat(ex.amountPaid)||0)===0){
      const monthly=parseFloat(client.monthlyAmount);const updated={...payments,[key]:{status:"paid",amountPaid:monthly}};
      savePayments(updated);
      const total=parseFloat(client.quotedTotal)||0;
      const allPaid=Object.entries(updated).filter(([k])=>k.startsWith(`pay_${cid}_`)).reduce((s,[,v])=>s+(parseFloat(v.amountPaid)||0),0);
      if(total>0&&allPaid>=total){saveCompletedClients([...completedClients,{...client,completedAt:new Date().toISOString(),totalCollected:allPaid}]);saveClients(clients.filter(c=>c.id!==cid));}
    }else{savePayments({...payments,[key]:{...ex,status}});}
  }

  function logPayment(cid,amount){
    const key=getPKey(cid,viewMonth,viewYear);const ex=payments[key]||{status:"pending",amountPaid:0};
    const newPaid=(parseFloat(ex.amountPaid)||0)+(parseFloat(amount)||0);
    const updated={...payments,[key]:{status:"paid",amountPaid:newPaid}};
    savePayments(updated);setPayInput(p=>({...p,[cid]:""}));
    const client=clients.find(c=>c.id===cid);
    if(client){
      const total=parseFloat(client.quotedTotal)||0;
      const allPaid=Object.entries(updated).filter(([k])=>k.startsWith(`pay_${cid}_`)).reduce((s,[,v])=>s+(parseFloat(v.amountPaid)||0),0);
      if(total>0&&allPaid>=total){saveCompletedClients([...completedClients,{...client,completedAt:new Date().toISOString(),totalCollected:allPaid}]);saveClients(clients.filter(c=>c.id!==cid));}
    }
  }

  function resetPay(cid){savePayments({...payments,[getPKey(cid,viewMonth,viewYear)]:{status:"pending",amountPaid:0}});}
  function totalPaidAllTime(cid){return Object.entries(payments).filter(([k])=>k.startsWith(`pay_${cid}_`)).reduce((s,[,v])=>s+(parseFloat(v.amountPaid)||0),0);}
  function getRemaining(c){const q=parseFloat(c.quotedTotal);if(!q)return null;return Math.max(0,q-totalPaidAllTime(c.id));}
  function moveToCompleted(cid){const client=clients.find(c=>c.id===cid);if(!client)return;saveCompletedClients([...completedClients,{...client,completedAt:new Date().toISOString(),totalCollected:totalPaidAllTime(cid)}]);saveClients(clients.filter(c=>c.id!==cid));}
  function addClient(){if(!newClient.name.trim())return;saveClients([...clients,{id:genId(),...newClient,createdAt:new Date().toISOString()}]);setNewClient(blankClient);setShowAddClient(false);}
  function addPIF(){if(!newPIF.name.trim())return;savePifClients([...pifClients,{id:genId(),...newPIF,createdAt:new Date().toISOString()}]);setNewPIF(blankPIF);setShowAddPIF(false);}
  function updateField(id,field,value){saveClients(clients.map(c=>c.id===id?{...c,[field]:value}:c));}
  function removeClient(id){saveClients(clients.filter(c=>c.id!==id));}
  function removePIF(id){savePifClients(pifClients.filter(c=>c.id!==id));}
  function removeCompleted(id){saveCompletedClients(completedClients.filter(c=>c.id!==id));}
  function restoreCompleted(id){const c=completedClients.find(c=>c.id===id);if(!c)return;const{completedAt,totalCollected,...rest}=c;saveClients([...clients,rest]);saveCompletedClients(completedClients.filter(c=>c.id!==id));}
  function addQuote(){if(!newQuote.name.trim())return;const key=getQKey(viewMonth,viewYear);saveQuotes({...quotes,[key]:[...(quotes[key]||[]),{id:genId(),...newQuote,date:new Date().toISOString()}]});setNewQuote(blankQuote);setShowAddQuote(false);}
  function removeQuote(id){const key=getQKey(viewMonth,viewYear);saveQuotes({...quotes,[key]:(quotes[key]||[]).filter(q=>q.id!==id)});}
  function addDisputeClient(){if(!newDispute.firstName.trim())return;saveDisputeClients([...disputeClients,{id:genId(),...newDispute,createdAt:new Date().toISOString()}]);setNewDispute(blankDispute);setShowAddDispute(false);}
  function removeDisputeClient(id){saveDisputeClients(disputeClients.filter(c=>c.id!==id));}
  function updateDisputeField(id,field,value){saveDisputeClients(disputeClients.map(c=>c.id===id?{...c,[field]:value}:c));}
  function markProcessed(id){saveDisputeClients(disputeClients.map(c=>c.id===id?{...c,processingDate:new Date().toISOString().split("T")[0]}:c));setAlarmDismissed(false);}
  function addPartner(){if(!newPartnerName.trim())return;savePartners([...partners,{id:genId(),name:newPartnerName.trim(),createdAt:new Date().toISOString()}]);setNewPartnerName("");setShowAddPartner(false);}
  function removePartner(id){savePartners(partners.filter(p=>p.id!==id));saveClients(clients.map(c=>c.partnerId===id?{...c,partnerId:""}:c));saveDisputeClients(disputeClients.map(c=>c.partnerId===id?{...c,partnerId:""}:c));}
  function addFollowUp(){if(!newFollowUp.name.trim())return;saveFollowUps([...followUps,{id:genId(),...newFollowUp,createdAt:new Date().toISOString()}]);setNewFollowUp(blankFollowUp);setShowAddFollowUp(false);}
  function removeFollowUp(id){saveFollowUps(followUps.filter(f=>f.id!==id));}
  function updateFollowUpField(id,field,value){saveFollowUps(followUps.map(f=>f.id===id?{...f,[field]:value}:f));}
  function touchFollowUp(id){saveFollowUps(followUps.map(f=>f.id===id?{...f,lastContact:new Date().toISOString().split("T")[0]}:f));}
  function convertFollowUp(lead,dest){
    if(dest==="payments")saveClients([...clients,{id:genId(),name:lead.name,company:"",monthlyAmount:"",quotedTotal:lead.quotedAmount||"",dueDay:"",notes:lead.notes||"",partnerId:"",createdAt:new Date().toISOString()}]);
    else if(dest==="pif")savePifClients([...pifClients,{id:genId(),name:lead.name,company:"",amount:lead.quotedAmount||"",paidDate:new Date().toISOString().split("T")[0],notes:lead.notes||"",createdAt:new Date().toISOString()}]);
    else if(dest==="disputes"){const parts=lead.name.trim().split(" ");saveDisputeClients([...disputeClients,{id:genId(),firstName:parts[0]||"",lastName:parts.slice(1).join(" ")||"",processingDate:"",creditMonitoring:"",service:lead.service||"",notes:lead.notes||"",partnerId:"",createdAt:new Date().toISOString()}]);}
    saveFollowUps(followUps.filter(f=>f.id!==lead.id));setConvertLead(null);
    setTab(dest==="pif"?"pif":dest==="disputes"?"disputes":"payments");
  }

  function handleCSVImport(file){
    if(!file||!file.name.endsWith(".csv")){setCsvImportMsg("Please drop a .csv file");return;}
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{const rows=parseCSV(e.target.result);const mapped=rows.map(mapCRCRow).filter(r=>r.firstName);if(mapped.length===0){setCsvImportMsg("No valid rows found.");return;}const existing=new Set(disputeClients.map(c=>`${c.firstName}${c.lastName}`.toLowerCase()));const newOnes=mapped.filter(r=>!existing.has(`${r.firstName}${r.lastName}`.toLowerCase()));saveDisputeClients([...disputeClients,...newOnes]);setCsvImportMsg(`Imported ${newOnes.length} new client${newOnes.length!==1?"s":""} (${mapped.length-newOnes.length} duplicates skipped)`);setTimeout(()=>setCsvImportMsg(""),5000);}catch(err){setCsvImportMsg("Error: "+err.message);}
    };reader.readAsText(file);
  }

  function shiftMonth(dir){let m=viewMonth+dir,y=viewYear;if(m<0){m=11;y--;}if(m>11){m=0;y++;}setViewMonth(m);setViewYear(y);}

  function downloadCSV(filename,rows,headers){const escape=v=>{const s=v===null||v===undefined?"":String(v);return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s.replace(/"/g,'""')}"`:`${s}`;};const csv=[headers.join(","),...rows.map(r=>headers.map(h=>escape(r[h])).join(","))].join("\n");const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}
  function exportPayments(){const h=["Name","Company","Partner","Monthly Amount","Total Quoted","Due Day","Notes","Status","Amount Paid This Month","Total Paid All Time","Remaining Balance"];const r=allRows.map(c=>{const rem=getRemaining(c);const pn=partners.find(p=>p.id===c.partnerId)?.name||"";return{"Name":c.name,"Company":c.company||"","Partner":pn,"Monthly Amount":c.monthlyAmount||"","Total Quoted":c.quotedTotal||"","Due Day":c.dueDay||"","Notes":c.notes||"","Status":c.status,"Amount Paid This Month":c.amountPaid||0,"Total Paid All Time":totalPaidAllTime(c.id),"Remaining Balance":rem!==null?rem:""};});downloadCSV(`payments_${MONTHS[viewMonth]}_${viewYear}.csv`,r,h);}
  function exportPIF(){downloadCSV("pay_in_full.csv",sortedPIF.map(c=>({"Name":c.name,"Company":c.company||"","Amount":c.amount||"","Date Paid":c.paidDate||"","Notes":c.notes||""})),["Name","Company","Amount","Date Paid","Notes"]);}
  function exportQuotes(){const h=["Month","Year","Name","Company","Amount","Notes"];const r=[];Object.entries(quotes).forEach(([key,qs])=>{const parts=key.replace("quotes_","").split("_");(qs||[]).forEach(q=>r.push({"Month":MONTHS[parseInt(parts[1])]||parts[1],"Year":parts[0],"Name":q.name,"Company":q.company||"","Amount":q.amount||"","Notes":q.notes||""}));});r.sort((a,b)=>`${b.Year}${b.Month}`.localeCompare(`${a.Year}${a.Month}`));downloadCSV("quotes_all_time.csv",r,h);}
  function exportDisputes(){const h=["First Name","Last Name","Partner","Processing Date","Days Since","Status","Credit Monitoring","Service","Notes"];const r=disputeClients.map(c=>{const d=getDaysSince(c.processingDate);const pn=partners.find(p=>p.id===c.partnerId)?.name||"";return{"First Name":c.firstName,"Last Name":c.lastName,"Partner":pn,"Processing Date":c.processingDate||"","Days Since":d!==null?d:"","Status":getDisputeStatus(d),"Credit Monitoring":c.creditMonitoring||"","Service":c.service||"","Notes":c.notes||""};});downloadCSV("dispute_tracker.csv",r,h);}
  function exportFollowUps(){const h=["Name","Service","Quoted Amount","Last Contact","Days Since","Status","Notes"];const r=followUps.map(f=>{const d=getDaysSince(f.lastContact);return{"Name":f.name,"Service":f.service||"","Quoted Amount":f.quotedAmount||"","Last Contact":f.lastContact||"","Days Since":d!==null?d:"","Status":f.status||"","Notes":f.notes||""};});downloadCSV("follow_ups.csv",r,h);}

  const allRows=useMemo(()=>clients.filter(c=>isClientActiveInMonth(c,viewMonth,viewYear)).map(c=>{const raw=getPayData(c.id);return{...c,status:effectiveStatus(c,raw.status,viewMonth,viewYear),amountPaid:raw.amountPaid};}).sort((a,b)=>(parseInt(a.dueDay)||99)-(parseInt(b.dueDay)||99)),[clients,payments,viewMonth,viewYear]);
  const filtered=useMemo(()=>{let r=filterStatus==="all"?allRows:allRows.filter(c=>c.status===filterStatus);if(searchQuery)r=r.filter(c=>c.name.toLowerCase().includes(searchQuery.toLowerCase()));return r;},[allRows,filterStatus,searchQuery]);
  const counts={paid:0,due:0,missed:0,pending:0};allRows.forEach(c=>{counts[c.status]=(counts[c.status]||0)+1;});
  const monthQuotes=quotes[getQKey(viewMonth,viewYear)]||[];
  const totalQuoted=monthQuotes.reduce((s,q)=>s+(parseFloat(q.amount)||0),0);
  const isCurrentMonth=viewMonth===THIS_MONTH&&viewYear===THIS_YEAR;
  const projectedMonthlyRevenue=allRows.reduce((s,c)=>s+(parseFloat(c.monthlyAmount)||0),0);
  const projectedTotalRemaining=allRows.reduce((s,c)=>{const r=getRemaining(c);return s+(r!==null?r:0);},0);
  const collectedThisMonth=allRows.reduce((s,c)=>{const d=getPayData(c.id);return s+(parseFloat(d.amountPaid)||0);},0);
  const collectionPct=projectedMonthlyRevenue>0?Math.min(100,(collectedThisMonth/projectedMonthlyRevenue)*100):0;
  const sortedPIF=[...pifClients].filter(c=>{const d=new Date(c.paidDate||c.createdAt);return d.getMonth()===viewMonth&&d.getFullYear()===viewYear;}).sort((a,b)=>new Date(b.paidDate||0)-new Date(a.paidDate||0));
  const pifTotal=sortedPIF.reduce((s,c)=>s+(parseFloat(c.amount)||0),0);
  const sortedCompleted=[...completedClients].sort((a,b)=>new Date(b.completedAt||0)-new Date(a.completedAt||0));
  const completedTotal=completedClients.reduce((s,c)=>s+(parseFloat(c.totalCollected)||0),0);
  const disputeWithStatus=useMemo(()=>disputeClients.map(c=>{const days=getDaysSince(c.processingDate);return{...c,daysSince:days,disputeStatus:getDisputeStatus(days)};}).sort((a,b)=>{const o={alarm:0,overdue:1,warning:2,ok:3,none:4};if(o[a.disputeStatus]!==o[b.disputeStatus])return(o[a.disputeStatus]||4)-(o[b.disputeStatus]||4);return(a.daysSince||0)-(b.daysSince||0);}),[disputeClients]);
  const filteredDisputes=useMemo(()=>{let r=disputeFilter==="all"?disputeWithStatus:disputeWithStatus.filter(c=>c.disputeStatus===disputeFilter);if(disputeSearch)r=r.filter(c=>`${c.firstName} ${c.lastName}`.toLowerCase().includes(disputeSearch.toLowerCase()));return r;},[disputeWithStatus,disputeFilter,disputeSearch]);
  const alarmClients=disputeWithStatus.filter(c=>c.disputeStatus==="alarm");
  const hasAlarm=alarmClients.length>0&&!alarmDismissed;
  const dispCounts={alarm:0,overdue:0,warning:0,ok:0,none:0};
  disputeWithStatus.forEach(c=>{dispCounts[c.disputeStatus]=(dispCounts[c.disputeStatus]||0)+1;});
  const partnerStats=useMemo(()=>partners.map(p=>{const pc=clients.filter(c=>c.partnerId===p.id);const dc=disputeClients.filter(c=>c.partnerId===p.id);return{...p,payClients:pc,dispClients:dc,totalClients:pc.length+dc.length,totalRevenue:pc.reduce((s,c)=>s+(parseFloat(c.quotedTotal)||0),0)};}), [partners,clients,disputeClients]);
  const followUpsWithStatus=useMemo(()=>followUps.map(f=>{const d=getDaysSince(f.lastContact);return{...f,daysSince:d,fc:getFUColor(d),fb:getFUBg(d),fl:getFULabel(d)};}).sort((a,b)=>{const aS=a.daysSince===null?-1:a.daysSince>14?0:a.daysSince>7?1:2;const bS=b.daysSince===null?-1:b.daysSince>14?0:b.daysSince>7?1:2;return aS-bS;}),[followUps]);
  const filteredFollowUps=useMemo(()=>{let r=fuFilter==="all"?followUpsWithStatus:followUpsWithStatus.filter(f=>f.status===fuFilter);if(fuSearch)r=r.filter(f=>f.name.toLowerCase().includes(fuSearch.toLowerCase()));return r;},[followUpsWithStatus,fuFilter,fuSearch]);
  const fuColdCount=followUpsWithStatus.filter(f=>f.daysSince!==null&&f.daysSince>14).length;
  const pipelineTotal=followUps.reduce((s,f)=>s+(parseFloat(f.quotedAmount)||0),0);

  if(loading)return(<div style={{fontFamily:"'DM Mono',monospace",background:"#080c10",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#334155"}}><div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:"0.15em",color:"#1e3a5f",marginBottom:8}}>CREDITRACK</div><div style={{fontSize:11,letterSpacing:"0.2em",animation:"pulse 1.5s infinite"}}>LOADING...</div><style>{`@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}`}</style></div></div>);

  return(<div style={{fontFamily:"'DM Mono','Courier New',monospace",background:"#080c10",minHeight:"100vh",color:"#e2e8f0"}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
      *{box-sizing:border-box}
      ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0f172a}::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
      .btn{cursor:pointer;border:none;font-family:inherit;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:500;transition:all 0.15s}
      .btn:hover{filter:brightness(1.2);transform:translateY(-1px)}.btn:active{transform:translateY(0)}
      input,select{font-family:inherit;background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;border-radius:4px;padding:8px 10px;font-size:12px;outline:none;width:100%}
      textarea{font-family:inherit;background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;border-radius:4px;padding:10px 12px;font-size:12px;outline:none;width:100%;resize:vertical;min-height:70px;line-height:1.7}
      input:focus,textarea:focus,select:focus{border-color:#3b82f6}
      select option{background:#0f172a}
      .sbtn{padding:3px 9px;border-radius:3px;font-size:10px;letter-spacing:0.05em;text-transform:uppercase;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all 0.12s;font-family:inherit}
      .sbtn:hover{filter:brightness(1.3)}
      .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;z-index:100;backdrop-filter:blur(4px)}
      .modal{background:#0d1117;border:1px solid #1e293b;border-radius:8px;padding:24px;width:440px;max-height:90vh;overflow-y:auto}
      .pbar{height:4px;background:#1e293b;border-radius:2px;overflow:hidden;margin-top:4px}
      .pfill{height:100%;border-radius:2px;transition:width 0.5s ease}
      .notes-box{background:#080c10;border:1px solid #1e293b;border-left:2px solid #475569;border-radius:4px;padding:12px 14px;font-size:13px;color:#94a3b8;line-height:1.8;white-space:pre-wrap;word-break:break-word;min-height:40px}
      @keyframes flashRed{0%,100%{background:#1a0000}50%{background:#3a0000}}
      @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
      .alarm-banner{animation:flashRed 1s infinite}
      .csv-drop{border:2px dashed #334155;border-radius:8px;padding:20px;text-align:center;transition:all 0.2s;cursor:pointer}
      .csv-drop.dragging{border-color:#7c3aed;background:#1a0a2e}
      .csv-drop:hover{border-color:#475569}
      .search-bar{background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;border-radius:4px;padding:8px 12px;font-size:12px;outline:none;width:280px;font-family:inherit}
      .search-bar:focus{border-color:#3b82f6}
      .partner-card{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px 20px;cursor:pointer;transition:all 0.15s}
      .partner-card:hover{border-color:#fbbf24;background:#0f1200}
    `}</style>

    {hasAlarm&&(<div className="alarm-banner" style={{position:"fixed",top:0,left:0,right:0,zIndex:200,padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"2px solid #ef4444"}}><div style={{display:"flex",alignItems:"center",gap:12}}><div style={{fontSize:20,animation:"shake 0.5s infinite"}}>🚨</div><div><div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#ef4444",letterSpacing:"0.1em"}}>OVERDUE — {alarmClients.length} CLIENT{alarmClients.length>1?"S":""} PAST 35 DAYS</div><div style={{fontSize:11,color:"#f87171"}}>{alarmClients.map(c=>`${c.firstName} ${c.lastName} (${c.daysSince}d)`).join(" · ")}</div></div></div><div style={{display:"flex",gap:8}}><button className="btn" onClick={()=>{setTab("disputes");setAlarmDismissed(false);}} style={{background:"#ef4444",color:"#fff",padding:"6px 14px",borderRadius:4}}>GO TO DISPUTES</button><button className="btn" onClick={()=>setAlarmDismissed(true)} style={{background:"#1e293b",color:"#64748b",padding:"6px 14px",borderRadius:4}}>DISMISS</button></div></div>)}

    <div style={{background:"#0a0e14",borderBottom:"1px solid #1e293b",padding:`${hasAlarm?"60px":"16px"} 24px 16px`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div><div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:"0.12em"}}>CREDITRACK</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.15em",marginTop:-2}}>PAYMENTS · DISPUTES · PARTNERS · PIPELINE</div></div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button className="btn" onClick={()=>shiftMonth(-1)} style={{background:"#1e293b",color:"#94a3b8",padding:"6px 12px",borderRadius:4}}>◀</button>
        <div style={{textAlign:"center",minWidth:110}}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.1em",color:isCurrentMonth?"#3b82f6":"#e2e8f0"}}>{MONTHS[viewMonth]} {viewYear}</div>{isCurrentMonth&&<div style={{fontSize:9,color:"#3b82f6",letterSpacing:"0.1em"}}>CURRENT</div>}</div>
        <button className="btn" onClick={()=>shiftMonth(1)} style={{background:"#1e293b",color:"#94a3b8",padding:"6px 12px",borderRadius:4}}>▶</button>
      </div>
    </div>

    <div style={{display:"flex",borderBottom:"1px solid #1e293b",background:"#0a0e14",overflowX:"auto"}}>
      {[["payments","PAYMENTS"],["disputes","DISPUTES"+(dispCounts.alarm>0?" 🚨":"")],["followup","FOLLOW-UP"+(fuColdCount>0?" 🔴":"")],["partners","PARTNERS"],["completed","COMPLETED"],["pif","PAY IN FULL"],["quotes","QUOTES"]].map(([k,label])=>(
        <button key={k} className="btn" onClick={()=>{setTab(k);setSelectedPartner(null);}} style={{background:"none",color:tab===k?"#3b82f6":"#64748b",padding:"12px 16px",borderBottom:tab===k?"2px solid #3b82f6":"2px solid transparent",fontSize:11,letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{label}</button>
      ))}
      <div style={{flex:1}}/>
      {tab==="payments"&&<><button className="btn" onClick={exportPayments} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddClient(true)} style={{background:"#1d4ed8",color:"#fff",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD CLIENT</button></>}
      {tab==="disputes"&&<><button className="btn" onClick={exportDisputes} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddDispute(true)} style={{background:"#7c3aed",color:"#fff",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD CLIENT</button></>}
      {tab==="followup"&&<><button className="btn" onClick={exportFollowUps} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddFollowUp(true)} style={{background:"#0e7490",color:"#22d3ee",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD LEAD</button></>}
      {tab==="partners"&&<button className="btn" onClick={()=>setShowAddPartner(true)} style={{background:"#b45309",color:"#fbbf24",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD PARTNER</button>}
      {tab==="pif"&&<><button className="btn" onClick={exportPIF} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddPIF(true)} style={{background:"#065f46",color:"#34d399",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD PIF</button></>}
      {tab==="quotes"&&<><button className="btn" onClick={exportQuotes} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddQuote(true)} style={{background:"#1d4ed8",color:"#fff",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD QUOTE</button></>}
    </div>

    {tab==="payments"&&(<div style={{padding:"20px 24px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>{Object.entries(STATUS_CONFIG).map(([k,v])=>(<button key={k} className="btn" onClick={()=>setFilterStatus(filterStatus===k?"all":k)} style={{background:filterStatus===k?v.bg:"#0f172a",border:`1px solid ${filterStatus===k?v.color:"#1e293b"}`,borderRadius:6,padding:"12px 16px",textAlign:"left"}}><div style={{fontSize:24,fontFamily:"'Bebas Neue'",color:v.color}}>{counts[k]||0}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em",marginTop:2}}>{v.label.toUpperCase()}</div></button>))}</div>
      {clients.length>0&&(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
        <div style={{background:"#0a0f1a",border:"1px solid #1e3a5f",borderRadius:6,padding:"14px 18px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:4}}>Projected Monthly Revenue</div><div style={{fontFamily:"'Bebas Neue'",fontSize:30,color:"#60a5fa",lineHeight:1}}>{fmt(projectedMonthlyRevenue)}</div><div style={{fontSize:10,color:"#334155",marginTop:3}}>{allRows.length} active client{allRows.length!==1?"s":""} this month</div></div><div style={{textAlign:"right"}}><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Collected {MONTHS[viewMonth]}</div><div style={{fontSize:18,fontFamily:"'Bebas Neue'",color:collectionPct===100?"#22c55e":"#facc15"}}>{fmt(collectedThisMonth)}</div></div></div><div style={{height:5,background:"#1e293b",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,transition:"width 0.5s ease",width:`${collectionPct}%`,background:collectionPct===100?"#22c55e":collectionPct>60?"#3b82f6":"#facc15"}}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><div style={{fontSize:9,color:"#334155"}}>{collectionPct.toFixed(0)}% collected</div><div style={{fontSize:9,color:"#334155"}}>{fmt(Math.max(0,projectedMonthlyRevenue-collectedThisMonth))} outstanding</div></div></div>
        <div style={{background:"#0a0f0a",border:"1px solid #1a3a1a",borderRadius:6,padding:"14px 18px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:4}}>Total Remaining to Collect</div><div style={{fontFamily:"'Bebas Neue'",fontSize:30,color:"#34d399",lineHeight:1}}>{fmt(projectedTotalRemaining)}</div><div style={{fontSize:10,color:"#334155",marginTop:3}}>across active payment plans</div></div><div style={{textAlign:"right"}}><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Total Quoted</div><div style={{fontSize:18,fontFamily:"'Bebas Neue'",color:"#64748b"}}>{fmt(allRows.reduce((s,c)=>s+(parseFloat(c.quotedTotal)||0),0))}</div></div></div>{(()=>{const tq=allRows.reduce((s,c)=>s+(parseFloat(c.quotedTotal)||0),0);const tp=allRows.reduce((s,c)=>s+totalPaidAllTime(c.id),0);const pp=tq>0?Math.min(100,(tp/tq)*100):0;return(<><div style={{height:5,background:"#1e293b",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,transition:"width 0.5s ease",width:`${pp}%`,background:"#22c55e"}}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><div style={{fontSize:9,color:"#334155"}}>{pp.toFixed(0)}% paid down</div><div style={{fontSize:9,color:"#334155"}}>{fmt(tp)} collected total</div></div></>);})()} </div>
      </div>)}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}><input className="search-bar" placeholder="🔍  Search by name..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>{searchQuery&&<button className="btn" onClick={()=>setSearchQuery("")} style={{background:"none",color:"#64748b",padding:"0 4px"}}>✕ clear</button>}{filterStatus!=="all"&&<><span style={{fontSize:11,color:"#64748b"}}>Status:</span><span style={{padding:"1px 8px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",background:STATUS_CONFIG[filterStatus].bg,color:STATUS_CONFIG[filterStatus].color,border:`1px solid ${STATUS_CONFIG[filterStatus].color}40`}}>{filterStatus}</span><button className="btn" onClick={()=>setFilterStatus("all")} style={{background:"none",color:"#64748b",padding:"0 4px"}}>✕</button></>}</div>
      {clients.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO CLIENTS YET — ADD YOUR FIRST ONE</div></div>):(<div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"20px 1.2fr 1fr 80px 80px 90px 80px 195px 28px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8,alignItems:"center"}}><div/><div>Client</div><div>Company</div><div>Monthly</div><div>Quoted</div><div>Remaining</div><div>Due Day</div><div>Status</div><div/></div>
        {filtered.map((c,i)=>{
          const atp=totalPaidAllTime(c.id);const rem=getRemaining(c);const q=parseFloat(c.quotedTotal)||0;const pct=q>0?Math.min(100,(atp/q)*100):0;
          const isExp=expandedId===c.id;const pd=getPayData(c.id);const im=c.status==="missed";
          const dd=parseInt(c.dueDay)||null;const it=isCurrentMonth&&dd&&TODAY_DAY===dd;const ip=isCurrentMonth&&dd&&TODAY_DAY>dd;
          const db=dd?(<div style={{fontSize:11,color:im?"#ef4444":it?"#facc15":ip?"#f87171":"#64748b",fontWeight:it?600:400}}>{it?"TODAY":`${MONTHS[viewMonth]} ${dd}`}</div>):null;
          const nm=(parseFloat(c.quotedTotal)&&parseFloat(c.monthlyAmount))?Math.round(parseFloat(c.quotedTotal)/parseFloat(c.monthlyAmount)):null;
          const pn=partners.find(p=>p.id===c.partnerId)?.name||"";
          return(<div key={c.id} style={{borderTop:i===0?"none":"1px solid #1e293b20"}}>
            <div style={{display:"grid",gridTemplateColumns:"20px 1.2fr 1fr 80px 80px 90px 80px 195px 28px",padding:"11px 14px",alignItems:"center",background:im?(i%2===0?"#130808":"#150909"):(i%2===0?"#080c10":"#090d13"),gap:8,cursor:"pointer",borderLeft:im?"3px solid #ef444460":"3px solid transparent"}} onClick={()=>setExpandedId(isExp?null:c.id)}>
              <div style={{color:"#334155",fontSize:11,userSelect:"none"}}>{isExp?"▾":"▸"}</div>
              <div><div style={{fontSize:13,fontWeight:500,color:im?"#fca5a5":"#e2e8f0"}}>{c.name}</div><div style={{display:"flex",gap:6,marginTop:2,flexWrap:"wrap"}}>{nm&&<div style={{fontSize:9,color:"#334155"}}>{nm}mo</div>}{pn&&<div style={{fontSize:9,color:"#fbbf24",background:"#1a1200",padding:"1px 6px",borderRadius:10,border:"1px solid #fbbf2430"}}>↗ {pn}</div>}</div></div>
              <div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div>
              <div style={{fontSize:12,color:"#94a3b8"}}>{c.monthlyAmount?fmt(c.monthlyAmount):"—"}</div>
              <div style={{fontSize:12,color:"#e2e8f0"}}>{c.quotedTotal?fmt(c.quotedTotal):"—"}</div>
              <div>{rem!==null?(<><div style={{fontSize:12,fontWeight:500,color:rem===0?"#22c55e":rem<q*0.2?"#facc15":"#f87171"}}>{rem===0?"CLEAR":fmt(rem)}</div>{q>0&&<div className="pbar" style={{width:80}}><div className="pfill" style={{width:`${pct}%`,background:pct===100?"#22c55e":pct>75?"#facc15":"#3b82f6"}}/></div>}</>):<span style={{fontSize:12,color:"#334155"}}>—</span>}</div>
              <div>{db||<span style={{fontSize:12,color:"#334155"}}>—</span>}</div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>{Object.entries(STATUS_CONFIG).map(([k,v])=>(<button key={k} className="sbtn" onClick={()=>setStatus(c.id,k)} style={{background:c.status===k?v.bg:"transparent",color:c.status===k?v.color:"#334155",border:c.status===k?`1px solid ${v.color}60`:"1px solid #1e293b"}}>{v.label}</button>))}</div>
              <button className="btn" onClick={e=>{e.stopPropagation();removeClient(c.id);}} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button>
            </div>
            {isExp&&(<div style={{background:"#0b1018",borderTop:"1px solid #1e293b30",padding:"16px 20px 16px 50px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:6}}>LOG PAYMENT — {MONTHS[viewMonth].toUpperCase()}</div>
                <div style={{fontSize:10,color:"#334155",marginBottom:8}}>Clicking Paid auto-logs monthly amount.</div>
                <div style={{display:"flex",gap:6}}><input type="number" placeholder={c.monthlyAmount?`e.g. ${fmt(c.monthlyAmount)}`:"Amount"} value={payInput[c.id]||""} onChange={e=>setPayInput(p=>({...p,[c.id]:e.target.value}))} onClick={e=>e.stopPropagation()} style={{flex:1}}/><button className="btn" onClick={e=>{e.stopPropagation();logPayment(c.id,payInput[c.id]);}} style={{background:"#166534",color:"#22c55e",padding:"6px 12px",borderRadius:4,whiteSpace:"nowrap"}}>+ LOG</button></div>
                {pd.amountPaid>0&&(<div style={{marginTop:8,fontSize:11,color:"#64748b",display:"flex",alignItems:"center",gap:8}}><span>This month: <span style={{color:"#22c55e"}}>{fmt(pd.amountPaid)}</span></span><button className="btn" onClick={()=>resetPay(c.id)} style={{background:"#1e293b",color:"#94a3b8",padding:"2px 8px",borderRadius:3,fontSize:9}}>reset</button></div>)}
                <button className="btn" onClick={()=>moveToCompleted(c.id)} style={{background:"#1e293b",color:"#34d399",padding:"4px 10px",borderRadius:3,fontSize:9,marginTop:10}}>✓ Mark Complete</button>
              </div>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>BALANCE</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Total quoted</span><span>{c.quotedTotal?fmt(c.quotedTotal):"—"}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Paid to date</span><span style={{color:"#22c55e"}}>{fmt(atp)}</span></div>
                  <div style={{height:1,background:"#1e293b",margin:"3px 0"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:500}}><span style={{color:"#64748b"}}>Remaining</span><span style={{color:rem===0?"#22c55e":"#f87171"}}>{rem!==null?(rem===0?"PAID OFF":fmt(rem)):"—"}</span></div>
                  {q>0&&<div className="pbar"><div className="pfill" style={{width:`${pct}%`,background:pct===100?"#22c55e":pct>75?"#facc15":"#3b82f6"}}/></div>}
                </div>
                {c.notes&&<div style={{marginTop:14}}><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:6}}>NOTES</div><div className="notes-box">{c.notes}</div></div>}
              </div>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>EDIT CLIENT</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>QUOTED TOTAL</div><input type="number" placeholder="e.g. 6000" defaultValue={c.quotedTotal} onBlur={e=>updateField(c.id,"quotedTotal",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>MONTHLY AMT</div><input type="number" placeholder="e.g. 1500" defaultValue={c.monthlyAmount} onBlur={e=>updateField(c.id,"monthlyAmount",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>DUE DAY</div><input type="number" min="1" max="31" placeholder="e.g. 15" defaultValue={c.dueDay} onBlur={e=>updateField(c.id,"dueDay",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>PARTNER</div><select defaultValue={c.partnerId||""} onBlur={e=>updateField(c.id,"partnerId",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}><option value="">No partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>NOTES</div><textarea defaultValue={c.notes} onBlur={e=>updateField(c.id,"notes",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                </div>
              </div>
            </div>)}
          </div>);})}
      </div>)}
    </div>)}

    {tab==="disputes"&&(<div style={{padding:"20px 24px"}}>
      <div className={`csv-drop${csvDragging?" dragging":""}`} style={{marginBottom:20}} onDragOver={e=>{e.preventDefault();setCsvDragging(true);}} onDragLeave={()=>setCsvDragging(false)} onDrop={e=>{e.preventDefault();setCsvDragging(false);handleCSVImport(e.dataTransfer.files[0]);}} onClick={()=>csvFileRef.current?.click()}>
        <input ref={csvFileRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>handleCSVImport(e.target.files[0])}/>
        <div style={{fontSize:24,marginBottom:6}}>📂</div><div style={{fontSize:12,color:"#64748b",letterSpacing:"0.08em"}}>DROP YOUR CREDIT REPAIR CLOUD CSV HERE</div><div style={{fontSize:10,color:"#334155",marginTop:4}}>or click to browse — duplicates auto-skipped</div>
        {csvImportMsg&&<div style={{marginTop:10,fontSize:11,color:csvImportMsg.includes("Import")?"#22c55e":"#f87171",fontWeight:500}}>{csvImportMsg}</div>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>{[{key:"all",label:"Total",color:"#94a3b8",count:disputeClients.length},{key:"alarm",label:"OVERDUE",color:"#ef4444",count:dispCounts.alarm||0},{key:"overdue",label:"Due Soon",color:"#f97316",count:dispCounts.overdue||0},{key:"warning",label:"Warning",color:"#facc15",count:dispCounts.warning||0},{key:"ok",label:"On Track",color:"#22c55e",count:dispCounts.ok||0}].map(item=>(<button key={item.key} className="btn" onClick={()=>setDisputeFilter(disputeFilter===item.key&&item.key!=="all"?"all":item.key)} style={{background:disputeFilter===item.key?"#1e293b":"#0f172a",border:`1px solid ${disputeFilter===item.key?item.color:"#1e293b"}`,borderRadius:6,padding:"10px 14px",textAlign:"left"}}><div style={{fontSize:22,fontFamily:"'Bebas Neue'",color:item.color}}>{item.count}</div><div style={{fontSize:9,color:"#64748b",letterSpacing:"0.1em",marginTop:2}}>{item.label.toUpperCase()}</div></button>))}</div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><input className="search-bar" placeholder="🔍  Search by name..." value={disputeSearch} onChange={e=>setDisputeSearch(e.target.value)}/>{disputeSearch&&<button className="btn" onClick={()=>setDisputeSearch("")} style={{background:"none",color:"#64748b",padding:"0 4px"}}>✕ clear</button>}</div>
      {disputeClients.length===0?(<div style={{textAlign:"center",padding:"40px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO DISPUTE CLIENTS YET</div></div>):(<div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"20px 1.4fr 100px 80px 120px 120px 140px 28px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8,alignItems:"center"}}><div/><div>Client</div><div>Last Processed</div><div>Days</div><div>Status</div><div>Monitoring</div><div>Service</div><div/></div>
        {filteredDisputes.map((c,i)=>{
          const isExp=expandedDispId===c.id;const ia=c.disputeStatus==="alarm";const io=c.disputeStatus==="overdue";const iw=c.disputeStatus==="warning";
          const sc=ia?"#ef4444":io?"#f97316":iw?"#facc15":"#22c55e";const sl=ia?"OVERDUE":io?"DUE SOON":iw?"WARNING":"ON TRACK";
          const rb=ia?(i%2===0?"#1a0000":"#1e0000"):io?(i%2===0?"#1a0800":"#1e0a00"):(i%2===0?"#080c10":"#090d13");
          const pn=partners.find(p=>p.id===c.partnerId)?.name||"";
          return(<div key={c.id} style={{borderTop:i===0?"none":"1px solid #1e293b20"}}>
            <div style={{display:"grid",gridTemplateColumns:"20px 1.4fr 100px 80px 120px 120px 140px 28px",padding:"11px 14px",alignItems:"center",background:rb,gap:8,cursor:"pointer",borderLeft:`3px solid ${sc}60`,animation:ia?"flashRed 0.8s infinite":""}} onClick={()=>setExpandedDispId(isExp?null:c.id)}>
              <div style={{color:"#334155",fontSize:11,userSelect:"none"}}>{isExp?"▾":"▸"}</div>
              <div><div style={{fontSize:13,fontWeight:500,color:ia?"#fca5a5":"#e2e8f0"}}>{c.firstName} {c.lastName}</div>{pn&&<div style={{fontSize:9,color:"#fbbf24",background:"#1a1200",padding:"1px 6px",borderRadius:10,border:"1px solid #fbbf2430",display:"inline-block",marginTop:2}}>↗ {pn}</div>}</div>
              <div style={{fontSize:12,color:"#64748b"}}>{c.processingDate||"—"}</div>
              <div style={{fontSize:14,fontWeight:600,color:sc}}>{c.daysSince!==null?c.daysSince:"—"}</div>
              <div><span style={{padding:"2px 8px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",background:ia?"#200000":io?"#1a0800":iw?"#1a1600":"#052e16",color:sc,border:`1px solid ${sc}40`}}>{sl}</span></div>
              <div style={{fontSize:11,color:"#64748b"}}>{c.creditMonitoring||"—"}</div>
              <div style={{fontSize:11,color:"#94a3b8"}}>{c.service||"—"}</div>
              <button className="btn" onClick={e=>{e.stopPropagation();removeDisputeClient(c.id);}} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button>
            </div>
            {isExp&&(<div style={{background:"#0b1018",borderTop:"1px solid #1e293b30",padding:"16px 20px 16px 50px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>PROCESSING</div>
                <div style={{marginBottom:10}}><div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Next due: <span style={{color:sc,fontWeight:600}}>{c.processingDate?new Date(new Date(c.processingDate).getTime()+35*24*60*60*1000).toLocaleDateString():"—"}</span></div><div style={{fontSize:11,color:"#64748b"}}>Days on clock: <span style={{color:sc,fontWeight:600}}>{c.daysSince!==null?c.daysSince:"—"}</span></div></div>
                <button className="btn" onClick={()=>markProcessed(c.id)} style={{background:"#166534",color:"#22c55e",padding:"8px 16px",borderRadius:4,fontSize:11,letterSpacing:"0.1em"}}>✓ MARK PROCESSED TODAY</button>
                {c.notes&&<div style={{marginTop:14}}><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:6}}>NOTES</div><div className="notes-box">{c.notes}</div></div>}
              </div>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>CLIENT INFO</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Monitoring</span><span>{c.creditMonitoring||"—"}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Service</span><span>{c.service||"—"}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Partner</span><span style={{color:"#fbbf24"}}>{pn||"—"}</span></div>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>EDIT</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>FIRST NAME</div><input defaultValue={c.firstName} onBlur={e=>updateDisputeField(c.id,"firstName",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>LAST NAME</div><input defaultValue={c.lastName} onBlur={e=>updateDisputeField(c.id,"lastName",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>PROCESSING DATE</div><input type="date" defaultValue={c.processingDate} onBlur={e=>updateDisputeField(c.id,"processingDate",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>MONITORING</div><select defaultValue={c.creditMonitoring} onBlur={e=>updateDisputeField(c.id,"creditMonitoring",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}><option value="">Select...</option>{CREDIT_MONITORING_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>SERVICE</div><select defaultValue={c.service} onBlur={e=>updateDisputeField(c.id,"service",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}><option value="">Select...</option>{SERVICE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>PARTNER</div><select defaultValue={c.partnerId||""} onBlur={e=>updateDisputeField(c.id,"partnerId",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}><option value="">No partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>NOTES</div><textarea defaultValue={c.notes} onBlur={e=>updateDisputeField(c.id,"notes",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                </div>
              </div>
            </div>)}
          </div>);})}
      </div>)}
    </div>)}

    {tab==="followup"&&(<div style={{padding:"20px 24px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
        <div style={{background:"#0a1218",border:"1px solid #0e4a5a",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22d3ee"}}>{followUps.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>OPEN LEADS</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{fmt(pipelineTotal)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>PIPELINE VALUE</div></div>
        <div style={{background:"#200000",border:"1px solid #ef444440",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#ef4444"}}>{fuColdCount}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>GONE COLD (15d+)</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#facc15"}}>{followUpsWithStatus.filter(f=>f.daysSince!==null&&f.daysSince>7&&f.daysSince<=14).length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>NEED FOLLOW-UP</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <input className="search-bar" placeholder="🔍  Search by name..." value={fuSearch} onChange={e=>setFuSearch(e.target.value)}/>{fuSearch&&<button className="btn" onClick={()=>setFuSearch("")} style={{background:"none",color:"#64748b",padding:"0 4px"}}>✕ clear</button>}
        <div style={{display:"flex",gap:6,marginLeft:8}}>{["all",...FOLLOWUP_STATUS_OPTIONS].map(s=>(<button key={s} className="btn" onClick={()=>setFuFilter(fuFilter===s&&s!=="all"?"all":s)} style={{background:fuFilter===s?"#1e293b":"transparent",color:fuFilter===s?"#e2e8f0":"#64748b",padding:"4px 10px",borderRadius:4,border:`1px solid ${fuFilter===s?"#475569":"#1e293b"}`,fontSize:10}}>{s.toUpperCase()}</button>))}</div>
      </div>
      {followUps.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO LEADS YET — ADD YOUR FIRST ONE</div><div style={{fontSize:11,color:"#334155",marginTop:8}}>Every quote you don't follow up on is money walking out the door.</div></div>):(<div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"20px 1.4fr 1fr 100px 110px 90px 120px 100px 28px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8,alignItems:"center"}}><div/><div>Name</div><div>Service</div><div>Quoted</div><div>Last Contact</div><div>Days</div><div>Status</div><div>Actions</div><div/></div>
        {filteredFollowUps.map((f,i)=>{
          const isExp=expandedFuId===f.id;
          const rb=f.daysSince!==null&&f.daysSince>14?(i%2===0?"#130808":"#150909"):f.daysSince!==null&&f.daysSince>7?(i%2===0?"#131100":"#151300"):(i%2===0?"#080c10":"#090d13");
          return(<div key={f.id} style={{borderTop:i===0?"none":"1px solid #1e293b20"}}>
            <div style={{display:"grid",gridTemplateColumns:"20px 1.4fr 1fr 100px 110px 90px 120px 100px 28px",padding:"11px 14px",alignItems:"center",background:rb,gap:8,cursor:"pointer",borderLeft:`3px solid ${f.fc}60`}} onClick={()=>setExpandedFuId(isExp?null:f.id)}>
              <div style={{color:"#334155",fontSize:11,userSelect:"none"}}>{isExp?"▾":"▸"}</div>
              <div><div style={{fontSize:13,fontWeight:500,color:"#e2e8f0"}}>{f.name}</div>{f.status&&<div style={{fontSize:9,color:"#64748b",marginTop:2}}>{f.status}</div>}</div>
              <div style={{fontSize:12,color:"#94a3b8"}}>{f.service||"—"}</div>
              <div style={{fontSize:12,color:"#22c55e",fontWeight:500}}>{f.quotedAmount?fmt(f.quotedAmount):"—"}</div>
              <div style={{fontSize:11,color:"#64748b"}}>{f.lastContact||"Never"}</div>
              <div style={{fontSize:14,fontWeight:600,color:f.fc}}>{f.daysSince!==null?`${f.daysSince}d`:"New"}</div>
              <div><span style={{padding:"2px 8px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",background:f.fb,color:f.fc,border:`1px solid ${f.fc}40`}}>{f.fl}</span></div>
              <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                <button className="btn" onClick={()=>touchFollowUp(f.id)} style={{background:"#166534",color:"#22c55e",padding:"3px 8px",borderRadius:3,fontSize:9,whiteSpace:"nowrap"}}>✓ TODAY</button>
                <button className="btn" onClick={()=>setConvertLead(f)} style={{background:"#1e3a5f",color:"#60a5fa",padding:"3px 8px",borderRadius:3,fontSize:9}}>→</button>
              </div>
              <button className="btn" onClick={e=>{e.stopPropagation();removeFollowUp(f.id);}} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button>
            </div>
            {isExp&&(<div style={{background:"#0b1018",borderTop:"1px solid #1e293b30",padding:"16px 20px 16px 50px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>NOTES</div>
                <div className="notes-box" style={{marginBottom:14}}>{f.notes||"No notes yet — add what was discussed, objections, or next steps."}</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button className="btn" onClick={()=>touchFollowUp(f.id)} style={{background:"#166534",color:"#22c55e",padding:"8px 16px",borderRadius:4,fontSize:11}}>✓ MARK CONTACTED TODAY</button>
                  <button className="btn" onClick={()=>setConvertLead(f)} style={{background:"#1e3a5f",color:"#60a5fa",padding:"8px 16px",borderRadius:4,fontSize:11,marginTop:8}}>→ CONVERT TO CLIENT</button>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>EDIT LEAD</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>NAME</div><input defaultValue={f.name} onBlur={e=>updateFollowUpField(f.id,"name",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>SERVICE</div><select defaultValue={f.service||""} onBlur={e=>updateFollowUpField(f.id,"service",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}><option value="">Select...</option>{SERVICE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>QUOTED AMOUNT</div><input type="number" defaultValue={f.quotedAmount||""} onBlur={e=>updateFollowUpField(f.id,"quotedAmount",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>LAST CONTACT</div><input type="date" defaultValue={f.lastContact||""} onBlur={e=>updateFollowUpField(f.id,"lastContact",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>STATUS</div><select defaultValue={f.status||"Hot"} onBlur={e=>updateFollowUpField(f.id,"status",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}>{FOLLOWUP_STATUS_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                  <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>NOTES</div><textarea defaultValue={f.notes||""} onBlur={e=>updateFollowUpField(f.id,"notes",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                </div>
              </div>
            </div>)}
          </div>);})}
      </div>)}
    </div>)}

    {tab==="partners"&&!selectedPartner&&(<div style={{padding:"20px 24px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:24}}>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#fbbf24"}}>{partners.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL PARTNERS</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#60a5fa"}}>{clients.filter(c=>c.partnerId).length+disputeClients.filter(c=>c.partnerId).length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>REFERRED CLIENTS</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px",display:"flex",alignItems:"center"}}><div style={{fontSize:10,color:"#64748b",lineHeight:1.6}}>Click any partner card to see all their referred clients.</div></div>
      </div>
      {partners.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO PARTNERS YET</div></div>):(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
        {partnerStats.map(p=>(<div key={p.id} className="partner-card" onClick={()=>setSelectedPartner(p.id)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}><div><div style={{fontFamily:"'Bebas Neue'",fontSize:20,letterSpacing:"0.08em",color:"#fbbf24"}}>{p.name}</div><div style={{fontSize:10,color:"#475569",marginTop:2}}>Added {new Date(p.createdAt).toLocaleDateString()}</div></div><button className="btn" onClick={e=>{e.stopPropagation();removePartner(p.id);}} style={{background:"none",color:"#334155",padding:"4px",fontSize:12}}>✕</button></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><div style={{background:"#080c10",borderRadius:4,padding:"8px 10px"}}><div style={{fontSize:18,fontFamily:"'Bebas Neue'",color:"#60a5fa"}}>{p.payClients.length}</div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.08em"}}>PAYMENT</div></div><div style={{background:"#080c10",borderRadius:4,padding:"8px 10px"}}><div style={{fontSize:18,fontFamily:"'Bebas Neue'",color:"#a78bfa"}}>{p.dispClients.length}</div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.08em"}}>DISPUTE</div></div></div>
          {p.totalRevenue>0&&<div style={{marginTop:8,fontSize:11,color:"#64748b"}}>Total quoted: <span style={{color:"#22c55e"}}>{fmt(p.totalRevenue)}</span></div>}
          <div style={{marginTop:10,fontSize:10,color:"#fbbf24",letterSpacing:"0.05em"}}>VIEW ALL CLIENTS →</div>
        </div>))}
      </div>)}
    </div>)}

    {tab==="partners"&&selectedPartner&&(()=>{
      const partner=partnerStats.find(p=>p.id===selectedPartner);if(!partner)return null;
      return(<div style={{padding:"20px 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}><button className="btn" onClick={()=>setSelectedPartner(null)} style={{background:"#1e293b",color:"#94a3b8",padding:"6px 14px",borderRadius:4}}>← BACK</button><div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:"0.1em",color:"#fbbf24"}}>{partner.name}</div><div style={{fontSize:11,color:"#64748b"}}>{partner.totalClients} client{partner.totalClients!==1?"s":""} referred</div></div>
        {partner.payClients.length>0&&(<div style={{marginBottom:24}}><div style={{fontSize:11,color:"#475569",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Payment Plan Clients ({partner.payClients.length})</div><div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 100px 120px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8}}><div>Name</div><div>Company</div><div>Monthly</div><div>Quoted</div><div>Remaining</div></div>{partner.payClients.map((c,i)=>{const rem=getRemaining(c);return(<div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 100px 120px",padding:"11px 14px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#090d13",gap:8}}><div style={{fontSize:13,fontWeight:500}}>{c.name}</div><div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div><div style={{fontSize:12,color:"#94a3b8"}}>{c.monthlyAmount?fmt(c.monthlyAmount):"—"}</div><div style={{fontSize:12,color:"#e2e8f0"}}>{c.quotedTotal?fmt(c.quotedTotal):"—"}</div><div style={{fontSize:12,color:rem===0?"#22c55e":rem!==null?"#f87171":"#334155"}}>{rem===0?"✓ CLEAR":rem!==null?fmt(rem):"—"}</div></div>);})}</div></div>)}
        {partner.dispClients.length>0&&(<div><div style={{fontSize:11,color:"#475569",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Dispute Clients ({partner.dispClients.length})</div><div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}><div style={{display:"grid",gridTemplateColumns:"1fr 110px 80px 120px 140px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8}}><div>Name</div><div>Last Processed</div><div>Days</div><div>Status</div><div>Service</div></div>{partner.dispClients.map((c,i)=>{const days=getDaysSince(c.processingDate);const st=getDisputeStatus(days);const sc=st==="alarm"?"#ef4444":st==="overdue"?"#f97316":st==="warning"?"#facc15":"#22c55e";const sl=st==="alarm"?"OVERDUE":st==="overdue"?"DUE SOON":st==="warning"?"WARNING":"ON TRACK";return(<div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr 110px 80px 120px 140px",padding:"11px 14px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#090d13",gap:8}}><div style={{fontSize:13,fontWeight:500}}>{c.firstName} {c.lastName}</div><div style={{fontSize:12,color:"#64748b"}}>{c.processingDate||"—"}</div><div style={{fontSize:13,fontWeight:600,color:sc}}>{days!==null?days:"—"}</div><div><span style={{padding:"2px 8px",borderRadius:20,fontSize:9,background:st==="alarm"?"#200000":st==="overdue"?"#1a0800":st==="warning"?"#1a1600":"#052e16",color:sc,border:`1px solid ${sc}40`}}>{sl}</span></div><div style={{fontSize:11,color:"#94a3b8"}}>{c.service||"—"}</div></div>);})}</div></div>)}
        {partner.totalClients===0&&<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO CLIENTS ASSIGNED TO {partner.name.toUpperCase()} YET</div></div>}
      </div>);
    })()}

    {tab==="completed"&&(<div style={{padding:"20px 24px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{completedClients.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>COMPLETED PLANS</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#34d399"}}>{fmt(completedTotal)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL COLLECTED</div></div>
        <div style={{background:"#051a10",border:"1px solid #134d32",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:11,color:"#34d399",lineHeight:1.6,marginTop:4}}>Clients move here automatically when fully paid off.</div></div>
      </div>
      {completedClients.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO COMPLETED PLANS YET</div></div>):(<div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 100px 110px 36px 36px",padding:"8px 16px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8}}><div>Client</div><div>Company</div><div>Quoted</div><div>Collected</div><div>Completed</div><div/><div/></div>
        {sortedCompleted.map((c,i)=>(<div key={c.id} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 100px 110px 36px 36px",padding:"12px 16px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#0a0e14",gap:8}}><div><div style={{fontSize:13,fontWeight:500}}>{c.name}</div><div style={{display:"inline-block",marginTop:3,padding:"1px 7px",borderRadius:20,fontSize:9,background:"#052e16",color:"#22c55e",border:"1px solid #22c55e40"}}>COMPLETED</div></div><div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div><div style={{fontSize:12,color:"#94a3b8"}}>{c.quotedTotal?fmt(c.quotedTotal):"—"}</div><div style={{fontSize:12,color:"#22c55e",fontWeight:500}}>{fmt(c.totalCollected)}</div><div style={{fontSize:11,color:"#64748b"}}>{c.completedAt?new Date(c.completedAt).toLocaleDateString():"—"}</div><button className="btn" title="Restore" onClick={()=>restoreCompleted(c.id)} style={{background:"none",color:"#3b82f6",padding:"4px",fontSize:12}}>↩</button><button className="btn" onClick={()=>removeCompleted(c.id)} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button></div>))}
      </div>)}
    </div>)}

    {tab==="pif"&&(<div style={{padding:"20px 24px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#34d399"}}>{sortedPIF.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>PAY IN FULL — {MONTHS[viewMonth].toUpperCase()}</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{fmt(pifTotal)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL THIS MONTH</div></div>
        <div style={{background:"#051a10",border:"1px solid #134d32",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:11,color:"#34d399",lineHeight:1.6,marginTop:4}}>PIF clients show only in the month they paid.</div></div>
      </div>
      {sortedPIF.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO PAY-IN-FULL FOR {MONTHS[viewMonth].toUpperCase()} {viewYear}</div></div>):(<div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 110px 1fr 36px",padding:"8px 16px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8}}><div>Client</div><div>Company</div><div>Amount</div><div>Paid Date</div><div>Notes</div><div/></div>
        {sortedPIF.map((c,i)=>(<div key={c.id} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 110px 1fr 36px",padding:"12px 16px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#0a0e14",gap:8}}><div><div style={{fontSize:13,fontWeight:500}}>{c.name}</div><div style={{display:"inline-block",marginTop:3,padding:"1px 7px",borderRadius:20,fontSize:9,background:"#052e16",color:"#22c55e",border:"1px solid #22c55e40"}}>PAID IN FULL</div></div><div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div><div style={{fontSize:12,color:"#22c55e",fontWeight:500}}>{c.amount?fmt(c.amount):"—"}</div><div style={{fontSize:12,color:"#64748b"}}>{c.paidDate||"—"}</div><div style={{fontSize:12,color:"#94a3b8"}}>{c.notes||"—"}</div><button className="btn" onClick={()=>removePIF(c.id)} style={{background:"none",color:"#334155",padding:"4px",fontSize:14}}>✕</button></div>))}
      </div>)}
    </div>)}

    {tab==="quotes"&&(<div style={{padding:"20px 24px"}}>
      <div style={{display:"flex",gap:12,marginBottom:20}}>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px",flex:1}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#3b82f6"}}>{monthQuotes.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>QUOTES THIS MONTH</div></div>
        <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px",flex:1}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{fmt(totalQuoted)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL VALUE QUOTED</div></div>
      </div>
      {monthQuotes.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO QUOTES FOR {MONTHS[viewMonth].toUpperCase()} {viewYear}</div></div>):(<div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 1fr 36px",padding:"8px 16px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.12em",textTransform:"uppercase"}}><div>Contact</div><div>Company</div><div>Amount</div><div>Notes</div><div/></div>
        {monthQuotes.map((q,i)=>(<div key={q.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 1fr 36px",padding:"12px 16px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#0a0e14"}}><div style={{fontSize:13,fontWeight:500}}>{q.name}</div><div style={{fontSize:12,color:"#64748b"}}>{q.company||"—"}</div><div style={{fontSize:12,color:"#22c55e"}}>{q.amount?fmt(q.amount):"—"}</div><div style={{fontSize:12,color:"#94a3b8"}}>{q.notes||"—"}</div><button className="btn" onClick={()=>removeQuote(q.id)} style={{background:"none",color:"#334155",padding:"4px",fontSize:14}}>✕</button></div>))}
      </div>)}
    </div>)}

    {convertLead&&(<div className="modal-overlay" onClick={()=>setConvertLead(null)}><div className="modal" onClick={e=>e.stopPropagation()} style={{width:380}}>
      <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#22d3ee"}}>CONVERT LEAD</div>
      <div style={{fontSize:11,color:"#64748b",marginBottom:20}}>Where are you moving <strong style={{color:"#e2e8f0"}}>{convertLead.name}</strong>?</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <button className="btn" onClick={()=>convertFollowUp(convertLead,"payments")} style={{background:"#1d4ed8",color:"#fff",padding:"14px 20px",borderRadius:6,fontSize:13,textAlign:"left"}}><div style={{fontWeight:700,letterSpacing:"0.08em"}}>PAYMENT PLAN</div><div style={{fontSize:10,color:"#93c5fd",marginTop:3,textTransform:"none",letterSpacing:"normal"}}>Monthly payment client with contract</div></button>
        <button className="btn" onClick={()=>convertFollowUp(convertLead,"pif")} style={{background:"#065f46",color:"#34d399",padding:"14px 20px",borderRadius:6,fontSize:13,textAlign:"left"}}><div style={{fontWeight:700,letterSpacing:"0.08em"}}>PAY IN FULL</div><div style={{fontSize:10,color:"#6ee7b7",marginTop:3,textTransform:"none",letterSpacing:"normal"}}>One-time full payment</div></button>
        <button className="btn" onClick={()=>convertFollowUp(convertLead,"disputes")} style={{background:"#4c1d95",color:"#a78bfa",padding:"14px 20px",borderRadius:6,fontSize:13,textAlign:"left"}}><div style={{fontWeight:700,letterSpacing:"0.08em"}}>DISPUTE CLIENT</div><div style={{fontSize:10,color:"#c4b5fd",marginTop:3,textTransform:"none",letterSpacing:"normal"}}>Add to credit repair dispute tracker</div></button>
      </div>
      <button className="btn" onClick={()=>setConvertLead(null)} style={{background:"#1e293b",color:"#64748b",padding:"10px 20px",borderRadius:4,width:"100%",marginTop:12}}>CANCEL</button>
    </div></div>)}

    {showAddClient&&(<div className="modal-overlay" onClick={()=>setShowAddClient(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:20}}>ADD PAYMENT CLIENT</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Full name *" value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})}/><input placeholder="Company" value={newClient.company} onChange={e=>setNewClient({...newClient,company:e.target.value})}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>MONTHLY PMT</div><input placeholder="e.g. 1500" type="number" value={newClient.monthlyAmount} onChange={e=>setNewClient({...newClient,monthlyAmount:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>TOTAL QUOTED</div><input placeholder="e.g. 6000" type="number" value={newClient.quotedTotal} onChange={e=>setNewClient({...newClient,quotedTotal:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>DUE DAY</div><input placeholder="e.g. 15" type="number" min="1" max="31" value={newClient.dueDay} onChange={e=>setNewClient({...newClient,dueDay:e.target.value})}/></div></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>PARTNER (optional)</div><select value={newClient.partnerId||""} onChange={e=>setNewClient({...newClient,partnerId:e.target.value})}><option value="">No partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><textarea placeholder="Notes" value={newClient.notes} onChange={e=>setNewClient({...newClient,notes:e.target.value})}/></div><div style={{fontSize:10,color:"#475569",marginTop:10,lineHeight:1.6}}>Contract length auto-calculated from Total Quoted / Monthly Payment.</div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addClient} style={{background:"#1d4ed8",color:"#fff",padding:"10px 20px",borderRadius:4,flex:1}}>ADD CLIENT</button><button className="btn" onClick={()=>setShowAddClient(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
    {showAddDispute&&(<div className="modal-overlay" onClick={()=>setShowAddDispute(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#a78bfa"}}>ADD DISPUTE CLIENT</div><div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:20}}>35-DAY PROCESSING CYCLE</div><div style={{display:"flex",flexDirection:"column",gap:10}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>FIRST NAME *</div><input placeholder="First" value={newDispute.firstName} onChange={e=>setNewDispute({...newDispute,firstName:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>LAST NAME</div><input placeholder="Last" value={newDispute.lastName} onChange={e=>setNewDispute({...newDispute,lastName:e.target.value})}/></div></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>PROCESSING DATE</div><input type="date" value={newDispute.processingDate} onChange={e=>setNewDispute({...newDispute,processingDate:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>CREDIT MONITORING</div><select value={newDispute.creditMonitoring} onChange={e=>setNewDispute({...newDispute,creditMonitoring:e.target.value})}><option value="">Select...</option>{CREDIT_MONITORING_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>SERVICE</div><select value={newDispute.service} onChange={e=>setNewDispute({...newDispute,service:e.target.value})}><option value="">Select...</option>{SERVICE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>PARTNER (optional)</div><select value={newDispute.partnerId||""} onChange={e=>setNewDispute({...newDispute,partnerId:e.target.value})}><option value="">No partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><textarea placeholder="Notes" value={newDispute.notes} onChange={e=>setNewDispute({...newDispute,notes:e.target.value})}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addDisputeClient} style={{background:"#7c3aed",color:"#fff",padding:"10px 20px",borderRadius:4,flex:1}}>ADD CLIENT</button><button className="btn" onClick={()=>setShowAddDispute(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
    {showAddFollowUp&&(<div className="modal-overlay" onClick={()=>setShowAddFollowUp(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#22d3ee"}}>ADD LEAD</div><div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:20}}>FOLLOW-UP PIPELINE</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Full name *" value={newFollowUp.name} onChange={e=>setNewFollowUp({...newFollowUp,name:e.target.value})}/><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>SERVICE</div><select value={newFollowUp.service||""} onChange={e=>setNewFollowUp({...newFollowUp,service:e.target.value})}><option value="">Select...</option>{SERVICE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>QUOTED AMOUNT</div><input placeholder="e.g. 2500" type="number" value={newFollowUp.quotedAmount} onChange={e=>setNewFollowUp({...newFollowUp,quotedAmount:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>LAST CONTACT DATE</div><input type="date" value={newFollowUp.lastContact} onChange={e=>setNewFollowUp({...newFollowUp,lastContact:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>STATUS</div><select value={newFollowUp.status} onChange={e=>setNewFollowUp({...newFollowUp,status:e.target.value})}>{FOLLOWUP_STATUS_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div><textarea placeholder="What was discussed, objections, next steps..." value={newFollowUp.notes} onChange={e=>setNewFollowUp({...newFollowUp,notes:e.target.value})}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addFollowUp} style={{background:"#0e7490",color:"#22d3ee",padding:"10px 20px",borderRadius:4,flex:1}}>ADD LEAD</button><button className="btn" onClick={()=>setShowAddFollowUp(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
    {showAddPartner&&(<div className="modal-overlay" onClick={()=>setShowAddPartner(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#fbbf24"}}>ADD PARTNER</div><div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:20}}>REFERRAL PARTNER</div><input placeholder="Partner name *" value={newPartnerName} onChange={e=>setNewPartnerName(e.target.value)} style={{marginBottom:16}}/><div style={{display:"flex",gap:8}}><button className="btn" onClick={addPartner} style={{background:"#b45309",color:"#fbbf24",padding:"10px 20px",borderRadius:4,flex:1}}>ADD PARTNER</button><button className="btn" onClick={()=>setShowAddPartner(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
    {showAddPIF&&(<div className="modal-overlay" onClick={()=>setShowAddPIF(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#34d399"}}>ADD PAY IN FULL</div><div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:20}}>ONE-TIME PAYMENT — DOES NOT RECUR</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Full name *" value={newPIF.name} onChange={e=>setNewPIF({...newPIF,name:e.target.value})}/><input placeholder="Company" value={newPIF.company} onChange={e=>setNewPIF({...newPIF,company:e.target.value})}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>AMOUNT PAID</div><input placeholder="e.g. 5000" type="number" value={newPIF.amount} onChange={e=>setNewPIF({...newPIF,amount:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>DATE PAID</div><input type="date" value={newPIF.paidDate} onChange={e=>setNewPIF({...newPIF,paidDate:e.target.value})}/></div></div><textarea placeholder="Notes / scope" value={newPIF.notes} onChange={e=>setNewPIF({...newPIF,notes:e.target.value})}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addPIF} style={{background:"#065f46",color:"#34d399",padding:"10px 20px",borderRadius:4,flex:1}}>SAVE PIF CLIENT</button><button className="btn" onClick={()=>setShowAddPIF(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
    {showAddQuote&&(<div className="modal-overlay" onClick={()=>setShowAddQuote(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4}}>NEW QUOTE</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em",marginBottom:16}}>{MONTHS[viewMonth].toUpperCase()} {viewYear}</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Contact name *" value={newQuote.name} onChange={e=>setNewQuote({...newQuote,name:e.target.value})}/><input placeholder="Company" value={newQuote.company} onChange={e=>setNewQuote({...newQuote,company:e.target.value})}/><input placeholder="Quote amount (e.g. 2500)" type="number" value={newQuote.amount} onChange={e=>setNewQuote({...newQuote,amount:e.target.value})}/><textarea placeholder="What was quoted / scope notes" value={newQuote.notes} onChange={e=>setNewQuote({...newQuote,notes:e.target.value})}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addQuote} style={{background:"#1d4ed8",color:"#fff",padding:"10px 20px",borderRadius:4,flex:1}}>SAVE QUOTE</button><button className="btn" onClick={()=>setShowAddQuote(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
  </div>);
}

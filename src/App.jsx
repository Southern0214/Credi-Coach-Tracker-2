import { useState, useEffect, useCallback, useMemo } from "react";
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
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000*60*60*24));
}

function getDisputeStatus(daysSince) {
  if (daysSince === null) return "none";
  if (daysSince > 35)  return "alarm";
  if (daysSince > 30)  return "overdue";
  if (daysSince > 25)  return "warning";
  return "ok";
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
  const [clients,          setClients]          = useState([]);
  const [pifClients,       setPifClients]        = useState([]);
  const [completedClients, setCompletedClients]  = useState([]);
  const [disputeClients,   setDisputeClients]    = useState([]);
  const [payments,         setPayments]          = useState({});
  const [quotes,           setQuotes]            = useState({});
  const [loading,          setLoading]           = useState(true);
  const [tab,              setTab]               = useState("payments");
  const [viewMonth,        setViewMonth]         = useState(THIS_MONTH);
  const [viewYear,         setViewYear]          = useState(THIS_YEAR);
  const [showAddClient,    setShowAddClient]      = useState(false);
  const [showAddPIF,       setShowAddPIF]         = useState(false);
  const [showAddQuote,     setShowAddQuote]       = useState(false);
  const [showAddDispute,   setShowAddDispute]     = useState(false);
  const [expandedId,       setExpandedId]        = useState(null);
  const [expandedDispId,   setExpandedDispId]    = useState(null);
  const [filterStatus,     setFilterStatus]      = useState("all");
  const [disputeFilter,    setDisputeFilter]     = useState("all");
  const [payInput,         setPayInput]          = useState({});
  const [alarmDismissed,   setAlarmDismissed]    = useState(false);

  const blankClient  = { name:"", company:"", monthlyAmount:"", quotedTotal:"", dueDay:"", notes:"" };
  const blankPIF     = { name:"", company:"", amount:"", paidDate:"", notes:"" };
  const blankQuote   = { name:"", company:"", amount:"", notes:"" };
  const blankDispute = { firstName:"", lastName:"", processingDate:"", creditMonitoring:"", service:"", notes:"" };

  const [newClient,  setNewClient]  = useState(blankClient);
  const [newPIF,     setNewPIF]     = useState(blankPIF);
  const [newQuote,   setNewQuote]   = useState(blankQuote);
  const [newDispute, setNewDispute] = useState(blankDispute);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [c,p,q,pif,comp,disp] = await Promise.all([
          dbGet("clients"),dbGet("payments"),dbGet("quotes"),dbGet("pifClients"),dbGet("completedClients"),dbGet("disputeClients"),
        ]);
        if (c)    setClients(c);
        if (p)    setPayments(p);
        if (q)    setQuotes(q);
        if (pif)  setPifClients(pif);
        if (comp) setCompletedClients(comp);
        if (disp) setDisputeClients(disp);
      } catch(e) { console.error("Load error",e); }
      setLoading(false);
    }
    load();
  }, []);

  const saveClients          = useCallback(async d => { setClients(d);          await dbSet("clients",          d); },[]);
  const savePifClients       = useCallback(async d => { setPifClients(d);       await dbSet("pifClients",       d); },[]);
  const saveCompletedClients = useCallback(async d => { setCompletedClients(d); await dbSet("completedClients", d); },[]);
  const saveDisputeClients   = useCallback(async d => { setDisputeClients(d);   await dbSet("disputeClients",   d); },[]);
  const savePayments         = useCallback(async d => { setPayments(d);         await dbSet("payments",         d); },[]);
  const saveQuotes           = useCallback(async d => { setQuotes(d);           await dbSet("quotes",           d); },[]);

  function getPayData(cid) { return payments[getPKey(cid,viewMonth,viewYear)] || { status:"pending", amountPaid:0 }; }
  function setStatus(cid, status) {
    const key    = getPKey(cid, viewMonth, viewYear);
    const ex     = payments[key] || { status:"pending", amountPaid:0 };
    const client = clients.find(c => c.id === cid);
    if (status === "paid" && client && parseFloat(client.monthlyAmount) > 0 && (parseFloat(ex.amountPaid)||0) === 0) {
      const monthly = parseFloat(client.monthlyAmount);
      const updated = { ...payments, [key]: { status:"paid", amountPaid: monthly } };
      savePayments(updated);
      const total   = parseFloat(client.quotedTotal)||0;
      const allPaid = Object.entries(updated).filter(([k])=>k.startsWith(`pay_${cid}_`)).reduce((s,[,v])=>s+(parseFloat(v.amountPaid)||0),0);
      if (total > 0 && allPaid >= total) {
        saveCompletedClients([...completedClients,{...client,completedAt:new Date().toISOString(),totalCollected:allPaid}]);
        saveClients(clients.filter(c=>c.id!==cid));
      }
    } else {
      savePayments({ ...payments, [key]: { ...ex, status } });
    }
  }
  }
  function logPayment(cid,amount) {
    const key=getPKey(cid,viewMonth,viewYear); const ex=payments[key]||{status:"pending",amountPaid:0};
    const newPaid=(parseFloat(ex.amountPaid)||0)+(parseFloat(amount)||0);
    const updated={...payments,[key]:{status:"paid",amountPaid:newPaid}};
    savePayments(updated); setPayInput(p=>({...p,[cid]:""}));
    const client=clients.find(c=>c.id===cid);
    if (client) {
      const total=parseFloat(client.quotedTotal)||0;
      const allPaid=Object.entries(updated).filter(([k])=>k.startsWith(`pay_${cid}_`)).reduce((s,[,v])=>s+(parseFloat(v.amountPaid)||0),0);
      if (total>0 && allPaid>=total) {
        saveCompletedClients([...completedClients,{...client,completedAt:new Date().toISOString(),totalCollected:allPaid}]);
        saveClients(clients.filter(c=>c.id!==cid));
      }
    }
  }
  function resetPay(cid) { const key=getPKey(cid,viewMonth,viewYear); savePayments({...payments,[key]:{status:"pending",amountPaid:0}}); }
  function totalPaidAllTime(cid) { return Object.entries(payments).filter(([k])=>k.startsWith(`pay_${cid}_`)).reduce((s,[,v])=>s+(parseFloat(v.amountPaid)||0),0); }
  function getRemaining(c) { const q=parseFloat(c.quotedTotal); if (!q) return null; return Math.max(0,q-totalPaidAllTime(c.id)); }
  function moveToCompleted(cid) {
    const client=clients.find(c=>c.id===cid); if (!client) return;
    saveCompletedClients([...completedClients,{...client,completedAt:new Date().toISOString(),totalCollected:totalPaidAllTime(cid)}]);
    saveClients(clients.filter(c=>c.id!==cid));
  }

  function addClient() { if (!newClient.name.trim()) return; saveClients([...clients,{id:genId(),...newClient,createdAt:new Date().toISOString()}]); setNewClient(blankClient); setShowAddClient(false); }
  function addPIF()    { if (!newPIF.name.trim())    return; savePifClients([...pifClients,{id:genId(),...newPIF,createdAt:new Date().toISOString()}]); setNewPIF(blankPIF); setShowAddPIF(false); }
  function updateField(id,field,value) { saveClients(clients.map(c=>c.id===id?{...c,[field]:value}:c)); }
  function removeClient(id)    { saveClients(clients.filter(c=>c.id!==id)); }
  function removePIF(id)       { savePifClients(pifClients.filter(c=>c.id!==id)); }
  function removeCompleted(id) { saveCompletedClients(completedClients.filter(c=>c.id!==id)); }
  function restoreCompleted(id) {
    const c=completedClients.find(c=>c.id===id); if (!c) return;
    const {completedAt,totalCollected,...rest}=c;
    saveClients([...clients,rest]); saveCompletedClients(completedClients.filter(c=>c.id!==id));
  }

  function addQuote() {
    if (!newQuote.name.trim()) return;
    const key=getQKey(viewMonth,viewYear);
    saveQuotes({...quotes,[key]:[...(quotes[key]||[]),{id:genId(),...newQuote,date:new Date().toISOString()}]});
    setNewQuote(blankQuote); setShowAddQuote(false);
  }
  function removeQuote(id) { const key=getQKey(viewMonth,viewYear); saveQuotes({...quotes,[key]:(quotes[key]||[]).filter(q=>q.id!==id)}); }

  function addDisputeClient() {
    if (!newDispute.firstName.trim()) return;
    saveDisputeClients([...disputeClients,{id:genId(),...newDispute,createdAt:new Date().toISOString()}]);
    setNewDispute(blankDispute); setShowAddDispute(false);
  }
  function removeDisputeClient(id) { saveDisputeClients(disputeClients.filter(c=>c.id!==id)); }
  function updateDisputeField(id,field,value) { saveDisputeClients(disputeClients.map(c=>c.id===id?{...c,[field]:value}:c)); }
  function markProcessed(id) {
    saveDisputeClients(disputeClients.map(c=>c.id===id?{...c,processingDate:new Date().toISOString().split("T")[0]}:c));
    setAlarmDismissed(false);
  }

  function shiftMonth(dir) {
    let m=viewMonth+dir,y=viewYear;
    if (m<0){m=11;y--;} if (m>11){m=0;y++;}
    setViewMonth(m); setViewYear(y);
  }

  function downloadCSV(filename,rows,headers) {
    const escape=v=>{const s=v===null||v===undefined?"":String(v); return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s.replace(/"/g,'""')}"`:`${s}`;};
    const csv=[headers.join(","),...rows.map(r=>headers.map(h=>escape(r[h])).join(","))].join("\n");
    const blob=new Blob([csv],{type:"text/csv"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
  }
  function exportPayments() {
    const headers=["Name","Company","Monthly Amount","Total Quoted","Due Day","Notes","Status","Amount Paid This Month","Total Paid All Time","Remaining Balance"];
    const rows=allRows.map(c=>{const rem=getRemaining(c); return{"Name":c.name,"Company":c.company||"","Monthly Amount":c.monthlyAmount||"","Total Quoted":c.quotedTotal||"","Due Day":c.dueDay||"","Notes":c.notes||"","Status":c.status,"Amount Paid This Month":c.amountPaid||0,"Total Paid All Time":totalPaidAllTime(c.id),"Remaining Balance":rem!==null?rem:""};});
    downloadCSV(`payments_${MONTHS[viewMonth]}_${viewYear}.csv`,rows,headers);
  }
  function exportPIF() {
    downloadCSV(`pay_in_full_clients.csv`,sortedPIF.map(c=>({"Name":c.name,"Company":c.company||"","Amount":c.amount||"","Date Paid":c.paidDate||"","Notes":c.notes||""})),["Name","Company","Amount","Date Paid","Notes"]);
  }
  function exportQuotes() {
    const headers=["Month","Year","Name","Company","Amount","Notes"]; const rows=[];
    Object.entries(quotes).forEach(([key,qs])=>{const parts=key.replace("quotes_","").split("_"); (qs||[]).forEach(q=>rows.push({"Month":MONTHS[parseInt(parts[1])]||parts[1],"Year":parts[0],"Name":q.name,"Company":q.company||"","Amount":q.amount||"","Notes":q.notes||""}));});
    rows.sort((a,b)=>`${b.Year}${b.Month}`.localeCompare(`${a.Year}${a.Month}`));
    downloadCSV(`quotes_all_time.csv`,rows,headers);
  }
  function exportDisputes() {
    const headers=["First Name","Last Name","Processing Date","Days Since","Status","Credit Monitoring","Service","Notes"];
    const rows=disputeClients.map(c=>{const d=getDaysSince(c.processingDate); return{"First Name":c.firstName,"Last Name":c.lastName,"Processing Date":c.processingDate||"","Days Since":d!==null?d:"","Status":getDisputeStatus(d),"Credit Monitoring":c.creditMonitoring||"","Service":c.service||"","Notes":c.notes||""};});
    downloadCSV(`dispute_tracker.csv`,rows,headers);
  }

  const allRows = useMemo(()=>{
    return clients.filter(c=>isClientActiveInMonth(c,viewMonth,viewYear)).map(c=>{
      const raw=getPayData(c.id); const status=effectiveStatus(c,raw.status,viewMonth,viewYear);
      return {...c,status,amountPaid:raw.amountPaid};
    }).sort((a,b)=>(parseInt(a.dueDay)||99)-(parseInt(b.dueDay)||99));
  },[clients,payments,viewMonth,viewYear]);

  const filtered=filterStatus==="all"?allRows:allRows.filter(c=>c.status===filterStatus);
  const counts={paid:0,due:0,missed:0,pending:0};
  allRows.forEach(c=>{counts[c.status]=(counts[c.status]||0)+1;});

  const monthQuotes    = quotes[getQKey(viewMonth,viewYear)]||[];
  const totalQuoted    = monthQuotes.reduce((s,q)=>s+(parseFloat(q.amount)||0),0);
  const isCurrentMonth = viewMonth===THIS_MONTH && viewYear===THIS_YEAR;

  const projectedMonthlyRevenue = allRows.reduce((s,c)=>s+(parseFloat(c.monthlyAmount)||0),0);
  const projectedTotalRemaining = allRows.reduce((s,c)=>{const r=getRemaining(c); return s+(r!==null?r:0);},0);
  const collectedThisMonth      = allRows.reduce((s,c)=>{const d=getPayData(c.id); return s+(parseFloat(d.amountPaid)||0);},0);
  const collectionPct           = projectedMonthlyRevenue>0?Math.min(100,(collectedThisMonth/projectedMonthlyRevenue)*100):0;

  const sortedPIF       = [...pifClients].sort((a,b)=>new Date(b.paidDate||0)-new Date(a.paidDate||0));
  const pifTotal        = pifClients.reduce((s,c)=>s+(parseFloat(c.amount)||0),0);
  const sortedCompleted = [...completedClients].sort((a,b)=>new Date(b.completedAt||0)-new Date(a.completedAt||0));
  const completedTotal  = completedClients.reduce((s,c)=>s+(parseFloat(c.totalCollected)||0),0);

  const disputeWithStatus = useMemo(()=>{
    return disputeClients.map(c=>{
      const days=getDaysSince(c.processingDate);
      const status=getDisputeStatus(days);
      return {...c,daysSince:days,disputeStatus:status};
    }).sort((a,b)=>{
      const order={alarm:0,overdue:1,warning:2,ok:3,none:4};
      return (order[a.disputeStatus]||4)-(order[b.disputeStatus]||4);
    });
  },[disputeClients]);

  const filteredDisputes = disputeFilter==="all"?disputeWithStatus:disputeWithStatus.filter(c=>c.disputeStatus===disputeFilter);
  const alarmClients     = disputeWithStatus.filter(c=>c.disputeStatus==="alarm");
  const hasAlarm         = alarmClients.length>0 && !alarmDismissed;

  const dispCounts = {alarm:0,overdue:0,warning:0,ok:0,none:0};
  disputeWithStatus.forEach(c=>{dispCounts[c.disputeStatus]=(dispCounts[c.disputeStatus]||0)+1;});

  if (loading) return (
    <div style={{fontFamily:"'DM Mono',monospace",background:"#080c10",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#334155"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:"0.15em",color:"#1e3a5f",marginBottom:8}}>CREDITRACK</div>
        <div style={{fontSize:11,letterSpacing:"0.2em",animation:"pulse 1.5s infinite"}}>LOADING...</div>
        <style>{`@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}`}</style>
      </div>
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:"#080c10",minHeight:"100vh",color:"#e2e8f0"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0f172a}::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
        .btn{cursor:pointer;border:none;font-family:inherit;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:500;transition:all 0.15s}
        .btn:hover{filter:brightness(1.2);transform:translateY(-1px)}.btn:active{transform:translateY(0)}
        input,textarea,select{font-family:inherit;background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;border-radius:4px;padding:8px 10px;font-size:12px;outline:none;width:100%}
        input:focus,textarea:focus,select:focus{border-color:#3b82f6}
        select option{background:#0f172a}
        .sbtn{padding:3px 9px;border-radius:3px;font-size:10px;letter-spacing:0.05em;text-transform:uppercase;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all 0.12s;font-family:inherit}
        .sbtn:hover{filter:brightness(1.3)}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;z-index:100;backdrop-filter:blur(4px)}
        .modal{background:#0d1117;border:1px solid #1e293b;border-radius:8px;padding:24px;width:440px;max-height:90vh;overflow-y:auto}
        .pbar{height:4px;background:#1e293b;border-radius:2px;overflow:hidden;margin-top:4px}
        .pfill{height:100%;border-radius:2px;transition:width 0.5s ease}
        @keyframes flashRed{0%,100%{background:#1a0000}50%{background:#3a0000}}
        @keyframes flashBorder{0%,100%{border-color:#ef444460}50%{border-color:#ef4444}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
        .alarm-row{animation:flashRed 0.8s infinite}
        .alarm-banner{animation:flashRed 1s infinite}
      `}</style>

      {hasAlarm && (
        <div className="alarm-banner" style={{position:"fixed",top:0,left:0,right:0,zIndex:200,padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"2px solid #ef4444"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:20,animation:"shake 0.5s infinite"}}>🚨</div>
            <div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"#ef4444",letterSpacing:"0.1em"}}>OVERDUE — {alarmClients.length} CLIENT{alarmClients.length>1?"S":""} PAST 35 DAYS</div>
              <div style={{fontSize:11,color:"#f87171"}}>{alarmClients.map(c=>`${c.firstName} ${c.lastName} (${c.daysSince}d)`).join(" · ")}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>{setTab("disputes");setAlarmDismissed(false);}} style={{background:"#ef4444",color:"#fff",padding:"6px 14px",borderRadius:4}}>GO TO DISPUTES</button>
            <button className="btn" onClick={()=>setAlarmDismissed(true)} style={{background:"#1e293b",color:"#64748b",padding:"6px 14px",borderRadius:4}}>DISMISS</button>
          </div>
        </div>
      )}

      <div style={{background:"#0a0e14",borderBottom:"1px solid #1e293b",padding:`${hasAlarm?"60px":"16px"} 24px 16px`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:"0.12em"}}>CREDITRACK</div>
          <div style={{fontSize:10,color:"#64748b",letterSpacing:"0.15em",marginTop:-2}}>PAYMENTS · DISPUTES · QUOTES</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button className="btn" onClick={()=>shiftMonth(-1)} style={{background:"#1e293b",color:"#94a3b8",padding:"6px 12px",borderRadius:4}}>◀</button>
          <div style={{textAlign:"center",minWidth:110}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.1em",color:isCurrentMonth?"#3b82f6":"#e2e8f0"}}>{MONTHS[viewMonth]} {viewYear}</div>
            {isCurrentMonth&&<div style={{fontSize:9,color:"#3b82f6",letterSpacing:"0.1em"}}>CURRENT</div>}
          </div>
          <button className="btn" onClick={()=>shiftMonth(1)} style={{background:"#1e293b",color:"#94a3b8",padding:"6px 12px",borderRadius:4}}>▶</button>
        </div>
      </div>

      <div style={{display:"flex",borderBottom:"1px solid #1e293b",background:"#0a0e14",overflowX:"auto"}}>
        {[["payments","PAYMENTS"],["disputes","DISPUTES"+(dispCounts.alarm>0?" 🚨":"")],["completed","COMPLETED"],["pif","PAY IN FULL"],["quotes","QUOTES"]].map(([k,label])=>(
          <button key={k} className="btn" onClick={()=>setTab(k)} style={{background:"none",color:tab===k?"#3b82f6":"#64748b",padding:"12px 16px",borderBottom:tab===k?"2px solid #3b82f6":"2px solid transparent",fontSize:11,letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{label}</button>
        ))}
        <div style={{flex:1}}/>
        {tab==="payments"  && <><button className="btn" onClick={exportPayments} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddClient(true)} style={{background:"#1d4ed8",color:"#fff",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD CLIENT</button></>}
        {tab==="disputes"  && <><button className="btn" onClick={exportDisputes} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddDispute(true)} style={{background:"#7c3aed",color:"#fff",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD CLIENT</button></>}
        {tab==="pif"       && <><button className="btn" onClick={exportPIF}      style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddPIF(true)}   style={{background:"#065f46",color:"#34d399",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD PIF</button></>}
        {tab==="quotes"    && <><button className="btn" onClick={exportQuotes}   style={{background:"#1e293b",color:"#94a3b8",padding:"10px 14px",margin:"6px 0 6px 12px",borderRadius:4}}>↓ CSV</button><button className="btn" onClick={()=>setShowAddQuote(true)}  style={{background:"#1d4ed8",color:"#fff",padding:"10px 18px",margin:"6px 12px",borderRadius:4}}>+ ADD QUOTE</button></>}
      </div>

      {tab==="payments" && (
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
            {Object.entries(STATUS_CONFIG).map(([k,v])=>(
              <button key={k} className="btn" onClick={()=>setFilterStatus(filterStatus===k?"all":k)} style={{background:filterStatus===k?v.bg:"#0f172a",border:`1px solid ${filterStatus===k?v.color:"#1e293b"}`,borderRadius:6,padding:"12px 16px",textAlign:"left"}}>
                <div style={{fontSize:24,fontFamily:"'Bebas Neue'",color:v.color}}>{counts[k]||0}</div>
                <div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em",marginTop:2}}>{v.label.toUpperCase()}</div>
              </button>
            ))}
          </div>
          {clients.length>0 && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
              <div style={{background:"#0a0f1a",border:"1px solid #1e3a5f",borderRadius:6,padding:"14px 18px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:4}}>Projected Monthly Revenue</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:30,color:"#60a5fa",lineHeight:1}}>{fmt(projectedMonthlyRevenue)}</div>
                    <div style={{fontSize:10,color:"#334155",marginTop:3}}>{allRows.length} active client{allRows.length!==1?"s":""} this month</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Collected {MONTHS[viewMonth]}</div>
                    <div style={{fontSize:18,fontFamily:"'Bebas Neue'",color:collectionPct===100?"#22c55e":"#facc15"}}>{fmt(collectedThisMonth)}</div>
                  </div>
                </div>
                <div style={{height:5,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,transition:"width 0.5s ease",width:`${collectionPct}%`,background:collectionPct===100?"#22c55e":collectionPct>60?"#3b82f6":"#facc15"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                  <div style={{fontSize:9,color:"#334155"}}>{collectionPct.toFixed(0)}% collected</div>
                  <div style={{fontSize:9,color:"#334155"}}>{fmt(Math.max(0,projectedMonthlyRevenue-collectedThisMonth))} outstanding</div>
                </div>
              </div>
              <div style={{background:"#0a0f0a",border:"1px solid #1a3a1a",borderRadius:6,padding:"14px 18px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:4}}>Total Remaining to Collect</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:30,color:"#34d399",lineHeight:1}}>{fmt(projectedTotalRemaining)}</div>
                    <div style={{fontSize:10,color:"#334155",marginTop:3}}>across active payment plans</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Total Quoted</div>
                    <div style={{fontSize:18,fontFamily:"'Bebas Neue'",color:"#64748b"}}>{fmt(allRows.reduce((s,c)=>s+(parseFloat(c.quotedTotal)||0),0))}</div>
                  </div>
                </div>
                {(()=>{const tq=allRows.reduce((s,c)=>s+(parseFloat(c.quotedTotal)||0),0);const tp=allRows.reduce((s,c)=>s+totalPaidAllTime(c.id),0);const pp=tq>0?Math.min(100,(tp/tq)*100):0;return(<><div style={{height:5,background:"#1e293b",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,transition:"width 0.5s ease",width:`${pp}%`,background:"#22c55e"}}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><div style={{fontSize:9,color:"#334155"}}>{pp.toFixed(0)}% paid down</div><div style={{fontSize:9,color:"#334155"}}>{fmt(tp)} collected total</div></div></>);})()} 
              </div>
            </div>
          )}
          {filterStatus!=="all" && (
            <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:"#64748b"}}>Showing:</span>
              <span style={{padding:"1px 8px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",background:STATUS_CONFIG[filterStatus].bg,color:STATUS_CONFIG[filterStatus].color,border:`1px solid ${STATUS_CONFIG[filterStatus].color}40`}}>{filterStatus}</span>
              <button className="btn" onClick={()=>setFilterStatus("all")} style={{background:"none",color:"#64748b",padding:"0 4px"}}>clear</button>
            </div>
          )}
          {clients.length===0?(
            <div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO CLIENTS YET — ADD YOUR FIRST ONE</div></div>
          ):(
            <div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"20px 1.2fr 1fr 80px 80px 90px 80px 195px 28px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8,alignItems:"center"}}>
                <div/><div>Client</div><div>Company</div><div>Monthly</div><div>Quoted</div><div>Remaining</div><div>Due Day</div><div>Status</div><div/>
              </div>
              {filtered.map((c,i)=>{
                const allTimePaid=totalPaidAllTime(c.id); const remaining=getRemaining(c);
                const quoted=parseFloat(c.quotedTotal)||0; const pct=quoted>0?Math.min(100,(allTimePaid/quoted)*100):0;
                const isExp=expandedId===c.id; const pData=getPayData(c.id); const isMissed=c.status==="missed";
                const dueDay=parseInt(c.dueDay)||null; const isPast=isCurrentMonth&&dueDay&&TODAY_DAY>dueDay; const isToday=isCurrentMonth&&dueDay&&TODAY_DAY===dueDay;
                const dueBadge=dueDay?(<div style={{fontSize:11,color:isMissed?"#ef4444":isToday?"#facc15":isPast?"#f87171":"#64748b",fontWeight:isToday?600:400}}>{isToday?"TODAY":`${MONTHS[viewMonth]} ${dueDay}`}</div>):null;
                const numMonths=(parseFloat(c.quotedTotal)&&parseFloat(c.monthlyAmount))?Math.round(parseFloat(c.quotedTotal)/parseFloat(c.monthlyAmount)):null;
                return (
                  <div key={c.id} style={{borderTop:i===0?"none":"1px solid #1e293b20"}}>
                    <div style={{display:"grid",gridTemplateColumns:"20px 1.2fr 1fr 80px 80px 90px 80px 195px 28px",padding:"11px 14px",alignItems:"center",background:isMissed?(i%2===0?"#130808":"#150909"):(i%2===0?"#080c10":"#090d13"),gap:8,cursor:"pointer",borderLeft:isMissed?"3px solid #ef444460":"3px solid transparent"}} onClick={()=>setExpandedId(isExp?null:c.id)}>
                      <div style={{color:"#334155",fontSize:11,userSelect:"none"}}>{isExp?"▾":"▸"}</div>
                      <div><div style={{fontSize:13,fontWeight:500,color:isMissed?"#fca5a5":"#e2e8f0"}}>{c.name}</div>{numMonths&&<div style={{fontSize:9,color:"#334155",marginTop:1}}>{numMonths} month plan</div>}</div>
                      <div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div>
                      <div style={{fontSize:12,color:"#94a3b8"}}>{c.monthlyAmount?fmt(c.monthlyAmount):"—"}</div>
                      <div style={{fontSize:12,color:"#e2e8f0"}}>{c.quotedTotal?fmt(c.quotedTotal):"—"}</div>
                      <div>{remaining!==null?(<><div style={{fontSize:12,fontWeight:500,color:remaining===0?"#22c55e":remaining<quoted*0.2?"#facc15":"#f87171"}}>{remaining===0?"CLEAR":fmt(remaining)}</div>{quoted>0&&<div className="pbar" style={{width:80}}><div className="pfill" style={{width:`${pct}%`,background:pct===100?"#22c55e":pct>75?"#facc15":"#3b82f6"}}/></div>}</>):<span style={{fontSize:12,color:"#334155"}}>—</span>}</div>
                      <div>{dueBadge||<span style={{fontSize:12,color:"#334155"}}>—</span>}</div>
                      <div style={{display:"flex",gap:3,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
                        {Object.entries(STATUS_CONFIG).map(([k,v])=>(<button key={k} className="sbtn" onClick={()=>setStatus(c.id,k)} style={{background:c.status===k?v.bg:"transparent",color:c.status===k?v.color:"#334155",border:c.status===k?`1px solid ${v.color}60`:"1px solid #1e293b"}}>{v.label}</button>))}
                      </div>
                      <button className="btn" onClick={e=>{e.stopPropagation();removeClient(c.id);}} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button>
                    </div>
                    {isExp&&(
                      <div style={{background:"#0b1018",borderTop:"1px solid #1e293b30",padding:"16px 20px 16px 50px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
                        <div>
                          <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>LOG PAYMENT — {MONTHS[viewMonth].toUpperCase()}</div>
                          <div style={{display:"flex",gap:6}}>
                            <input type="number" placeholder={c.monthlyAmount?`e.g. ${fmt(c.monthlyAmount)}`:"Amount"} value={payInput[c.id]||""} onChange={e=>setPayInput(p=>({...p,[c.id]:e.target.value}))} onClick={e=>e.stopPropagation()} style={{flex:1}}/>
                            <button className="btn" onClick={e=>{e.stopPropagation();logPayment(c.id,payInput[c.id]);}} style={{background:"#166534",color:"#22c55e",padding:"6px 12px",borderRadius:4,whiteSpace:"nowrap"}}>+ LOG</button>
                          </div>
                          {pData.amountPaid>0&&(<div style={{marginTop:8,fontSize:11,color:"#64748b",display:"flex",alignItems:"center",gap:8}}><span>This month: <span style={{color:"#22c55e"}}>{fmt(pData.amountPaid)}</span></span><button className="btn" onClick={()=>resetPay(c.id)} style={{background:"#1e293b",color:"#94a3b8",padding:"2px 8px",borderRadius:3,fontSize:9}}>reset</button></div>)}
                          <button className="btn" onClick={()=>moveToCompleted(c.id)} style={{background:"#1e293b",color:"#34d399",padding:"4px 10px",borderRadius:3,fontSize:9,marginTop:10}}>✓ Mark Complete</button>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>BALANCE</div>
                          <div style={{display:"flex",flexDirection:"column",gap:5}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Total quoted</span><span>{c.quotedTotal?fmt(c.quotedTotal):"—"}</span></div>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Paid to date</span><span style={{color:"#22c55e"}}>{fmt(allTimePaid)}</span></div>
                            <div style={{height:1,background:"#1e293b",margin:"3px 0"}}/>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:500}}><span style={{color:"#64748b"}}>Remaining</span><span style={{color:remaining===0?"#22c55e":"#f87171"}}>{remaining!==null?(remaining===0?"PAID OFF":fmt(remaining)):"—"}</span></div>
                            {quoted>0&&<div className="pbar"><div className="pfill" style={{width:`${pct}%`,background:pct===100?"#22c55e":pct>75?"#facc15":"#3b82f6"}}/></div>}
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>EDIT CLIENT</div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>QUOTED TOTAL</div><input type="number" placeholder="e.g. 6000" defaultValue={c.quotedTotal} onBlur={e=>updateField(c.id,"quotedTotal",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                            <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>MONTHLY AMT</div><input type="number" placeholder="e.g. 1500" defaultValue={c.monthlyAmount} onBlur={e=>updateField(c.id,"monthlyAmount",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                            <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>DUE DAY</div><input type="number" min="1" max="31" placeholder="e.g. 15" defaultValue={c.dueDay} onBlur={e=>updateField(c.id,"dueDay",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                            <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>NOTES</div><input placeholder="Notes" defaultValue={c.notes} onBlur={e=>updateField(c.id,"notes",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab==="disputes" && (
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
            {[
              {key:"all",   label:"Total",    color:"#94a3b8", count:disputeClients.length},
              {key:"alarm", label:"OVERDUE",  color:"#ef4444", count:dispCounts.alarm||0},
              {key:"overdue",label:"Due Soon", color:"#f97316", count:dispCounts.overdue||0},
              {key:"warning",label:"Warning",  color:"#facc15", count:dispCounts.warning||0},
              {key:"ok",    label:"On Track", color:"#22c55e", count:dispCounts.ok||0},
            ].map(item=>(
              <button key={item.key} className="btn" onClick={()=>setDisputeFilter(disputeFilter===item.key&&item.key!=="all"?"all":item.key)} style={{background:disputeFilter===item.key?"#1e293b":"#0f172a",border:`1px solid ${disputeFilter===item.key?item.color:"#1e293b"}`,borderRadius:6,padding:"10px 14px",textAlign:"left"}}>
                <div style={{fontSize:22,fontFamily:"'Bebas Neue'",color:item.color}}>{item.count}</div>
                <div style={{fontSize:9,color:"#64748b",letterSpacing:"0.1em",marginTop:2}}>{item.label.toUpperCase()}</div>
              </button>
            ))}
          </div>
          {disputeClients.length===0?(
            <div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO DISPUTE CLIENTS YET — ADD YOUR FIRST ONE</div></div>
          ):(
            <div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"20px 1.4fr 100px 80px 120px 120px 140px 28px",padding:"8px 14px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8,alignItems:"center"}}>
                <div/><div>Client</div><div>Last Processed</div><div>Days</div><div>Status</div><div>Monitoring</div><div>Service</div><div/>
              </div>
              {filteredDisputes.map((c,i)=>{
                const isExp=expandedDispId===c.id;
                const isAlarm=c.disputeStatus==="alarm";
                const isOver=c.disputeStatus==="overdue";
                const isWarn=c.disputeStatus==="warning";
                const statusColor=isAlarm?"#ef4444":isOver?"#f97316":isWarn?"#facc15":"#22c55e";
                const statusLabel=isAlarm?"OVERDUE":isOver?"DUE SOON":isWarn?"WARNING":"ON TRACK";
                const rowBg=isAlarm?(i%2===0?"#1a0000":"#1e0000"):isOver?(i%2===0?"#1a0800":"#1e0a00"):(i%2===0?"#080c10":"#090d13");
                return (
                  <div key={c.id} style={{borderTop:i===0?"none":"1px solid #1e293b20"}}>
                    <div style={{display:"grid",gridTemplateColumns:"20px 1.4fr 100px 80px 120px 120px 140px 28px",padding:"11px 14px",alignItems:"center",background:rowBg,gap:8,cursor:"pointer",borderLeft:`3px solid ${statusColor}60`,animation:isAlarm?"flashRed 0.8s infinite":""}} onClick={()=>setExpandedDispId(isExp?null:c.id)}>
                      <div style={{color:"#334155",fontSize:11,userSelect:"none"}}>{isExp?"▾":"▸"}</div>
                      <div>
                        <div style={{fontSize:13,fontWeight:500,color:isAlarm?"#fca5a5":"#e2e8f0"}}>{c.firstName} {c.lastName}</div>
                        {c.notes&&<div style={{fontSize:9,color:"#475569",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160}}>{c.notes}</div>}
                      </div>
                      <div style={{fontSize:12,color:"#64748b"}}>{c.processingDate||"—"}</div>
                      <div style={{fontSize:14,fontWeight:600,color:statusColor}}>{c.daysSince!==null?c.daysSince:"—"}</div>
                      <div><span style={{padding:"2px 8px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",background:isAlarm?"#200000":isOver?"#1a0800":isWarn?"#1a1600":"#052e16",color:statusColor,border:`1px solid ${statusColor}40`}}>{statusLabel}</span></div>
                      <div style={{fontSize:11,color:"#64748b"}}>{c.creditMonitoring||"—"}</div>
                      <div style={{fontSize:11,color:"#94a3b8"}}>{c.service||"—"}</div>
                      <button className="btn" onClick={e=>{e.stopPropagation();removeDisputeClient(c.id);}} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button>
                    </div>
                    {isExp&&(
                      <div style={{background:"#0b1018",borderTop:"1px solid #1e293b30",padding:"16px 20px 16px 50px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
                        <div>
                          <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>PROCESSING</div>
                          <div style={{marginBottom:10}}>
                            <div style={{fontSize:11,color:"#64748b",marginBottom:4}}>Next due: <span style={{color:statusColor,fontWeight:600}}>{c.processingDate?new Date(new Date(c.processingDate).getTime()+35*24*60*60*1000).toLocaleDateString():"—"}</span></div>
                            <div style={{fontSize:11,color:"#64748b"}}>Days on clock: <span style={{color:statusColor,fontWeight:600}}>{c.daysSince!==null?c.daysSince:"—"}</span></div>
                          </div>
                          <button className="btn" onClick={()=>markProcessed(c.id)} style={{background:"#166534",color:"#22c55e",padding:"8px 16px",borderRadius:4,fontSize:11,letterSpacing:"0.1em"}}>✓ MARK PROCESSED TODAY</button>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:8}}>CLIENT INFO</div>
                          <div style={{display:"flex",flexDirection:"column",gap:5}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Monitoring</span><span>{c.creditMonitoring||"—"}</span></div>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Service</span><span>{c.service||"—"}</span></div>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#64748b"}}>Added</span><span>{c.createdAt?new Date(c.createdAt).toLocaleDateString():"—"}</span></div>
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
                            <div><div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",marginBottom:3}}>NOTES</div><input defaultValue={c.notes} onBlur={e=>updateDisputeField(c.id,"notes",e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:11}}/></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab==="completed" && (
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
            <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{completedClients.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>COMPLETED PLANS</div></div>
            <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#34d399"}}>{fmt(completedTotal)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL COLLECTED</div></div>
            <div style={{background:"#051a10",border:"1px solid #134d32",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:11,color:"#34d399",lineHeight:1.6,marginTop:4}}>Clients move here automatically when fully paid off. No longer in monthly projections.</div></div>
          </div>
          {completedClients.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO COMPLETED PLANS YET</div></div>):(
            <div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 100px 110px 36px 36px",padding:"8px 16px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8}}>
                <div>Client</div><div>Company</div><div>Quoted</div><div>Collected</div><div>Completed</div><div/><div/>
              </div>
              {sortedCompleted.map((c,i)=>(
                <div key={c.id} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 100px 110px 36px 36px",padding:"12px 16px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#0a0e14",gap:8}}>
                  <div><div style={{fontSize:13,fontWeight:500}}>{c.name}</div><div style={{display:"inline-block",marginTop:3,padding:"1px 7px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",background:"#052e16",color:"#22c55e",border:"1px solid #22c55e40"}}>COMPLETED</div></div>
                  <div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div>
                  <div style={{fontSize:12,color:"#94a3b8"}}>{c.quotedTotal?fmt(c.quotedTotal):"—"}</div>
                  <div style={{fontSize:12,color:"#22c55e",fontWeight:500}}>{fmt(c.totalCollected)}</div>
                  <div style={{fontSize:11,color:"#64748b"}}>{c.completedAt?new Date(c.completedAt).toLocaleDateString():"—"}</div>
                  <button className="btn" title="Restore" onClick={()=>restoreCompleted(c.id)} style={{background:"none",color:"#3b82f6",padding:"4px",fontSize:12}}>↩</button>
                  <button className="btn" onClick={()=>removeCompleted(c.id)} style={{background:"none",color:"#334155",padding:"4px",fontSize:13}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="pif" && (
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
            <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#34d399"}}>{pifClients.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>PAY IN FULL CLIENTS</div></div>
            <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{fmt(pifTotal)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL COLLECTED</div></div>
            <div style={{background:"#051a10",border:"1px solid #134d32",borderRadius:6,padding:"12px 20px"}}><div style={{fontSize:11,color:"#34d399",lineHeight:1.6,marginTop:4}}>PIF clients are one-time records and do not carry over month to month.</div></div>
          </div>
          {pifClients.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO PAY-IN-FULL CLIENTS YET</div></div>):(
            <div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 110px 1fr 36px",padding:"8px 16px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",gap:8}}><div>Client</div><div>Company</div><div>Amount</div><div>Paid Date</div><div>Notes</div><div/></div>
              {sortedPIF.map((c,i)=>(<div key={c.id} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 100px 110px 1fr 36px",padding:"12px 16px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#0a0e14",gap:8}}><div><div style={{fontSize:13,fontWeight:500}}>{c.name}</div><div style={{display:"inline-block",marginTop:3,padding:"1px 7px",borderRadius:20,fontSize:9,letterSpacing:"0.08em",background:"#052e16",color:"#22c55e",border:"1px solid #22c55e40"}}>PAID IN FULL</div></div><div style={{fontSize:12,color:"#64748b"}}>{c.company||"—"}</div><div style={{fontSize:12,color:"#22c55e",fontWeight:500}}>{c.amount?fmt(c.amount):"—"}</div><div style={{fontSize:12,color:"#64748b"}}>{c.paidDate||"—"}</div><div style={{fontSize:12,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.notes||"—"}</div><button className="btn" onClick={()=>removePIF(c.id)} style={{background:"none",color:"#334155",padding:"4px",fontSize:14}}>✕</button></div>))}
            </div>
          )}
        </div>
      )}

      {tab==="quotes" && (
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"flex",gap:12,marginBottom:20}}>
            <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px",flex:1}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#3b82f6"}}>{monthQuotes.length}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>QUOTES THIS MONTH</div></div>
            <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"12px 20px",flex:1}}><div style={{fontSize:28,fontFamily:"'Bebas Neue'",color:"#22c55e"}}>{fmt(totalQuoted)}</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em"}}>TOTAL VALUE QUOTED</div></div>
          </div>
          {monthQuotes.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#334155"}}><div style={{fontSize:40,marginBottom:8}}>◎</div><div style={{fontSize:12,letterSpacing:"0.1em"}}>NO QUOTES FOR {MONTHS[viewMonth].toUpperCase()} {viewYear}</div></div>):(
            <div style={{border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 1fr 36px",padding:"8px 16px",background:"#0f172a",fontSize:10,color:"#475569",letterSpacing:"0.12em",textTransform:"uppercase"}}><div>Contact</div><div>Company</div><div>Amount</div><div>Notes</div><div/></div>
              {monthQuotes.map((q,i)=>(<div key={q.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 1fr 36px",padding:"12px 16px",borderTop:i===0?"none":"1px solid #1e293b12",alignItems:"center",background:i%2===0?"#080c10":"#0a0e14"}}><div style={{fontSize:13,fontWeight:500}}>{q.name}</div><div style={{fontSize:12,color:"#64748b"}}>{q.company||"—"}</div><div style={{fontSize:12,color:"#22c55e"}}>{q.amount?fmt(q.amount):"—"}</div><div style={{fontSize:12,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.notes||"—"}</div><button className="btn" onClick={()=>removeQuote(q.id)} style={{background:"none",color:"#334155",padding:"4px",fontSize:14}}>✕</button></div>))}
            </div>
          )}
        </div>
      )}

      {showAddClient&&(<div className="modal-overlay" onClick={()=>setShowAddClient(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:20}}>ADD PAYMENT CLIENT</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Full name *" value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})}/><input placeholder="Company" value={newClient.company} onChange={e=>setNewClient({...newClient,company:e.target.value})}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>MONTHLY PMT</div><input placeholder="e.g. 1500" type="number" value={newClient.monthlyAmount} onChange={e=>setNewClient({...newClient,monthlyAmount:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>TOTAL QUOTED</div><input placeholder="e.g. 6000" type="number" value={newClient.quotedTotal} onChange={e=>setNewClient({...newClient,quotedTotal:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>DUE DAY</div><input placeholder="e.g. 15" type="number" min="1" max="31" value={newClient.dueDay} onChange={e=>setNewClient({...newClient,dueDay:e.target.value})}/></div></div><textarea placeholder="Notes" rows={2} value={newClient.notes} onChange={e=>setNewClient({...newClient,notes:e.target.value})} style={{resize:"none"}}/></div><div style={{fontSize:10,color:"#475569",marginTop:10,lineHeight:1.6}}>Contract length auto-calculated from Total Quoted / Monthly Payment.</div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addClient} style={{background:"#1d4ed8",color:"#fff",padding:"10px 20px",borderRadius:4,flex:1}}>ADD CLIENT</button><button className="btn" onClick={()=>setShowAddClient(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}

      {showAddDispute&&(<div className="modal-overlay" onClick={()=>setShowAddDispute(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#a78bfa"}}>ADD DISPUTE CLIENT</div><div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:20}}>35-DAY PROCESSING CYCLE</div><div style={{display:"flex",flexDirection:"column",gap:10}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>FIRST NAME *</div><input placeholder="First" value={newDispute.firstName} onChange={e=>setNewDispute({...newDispute,firstName:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>LAST NAME</div><input placeholder="Last" value={newDispute.lastName} onChange={e=>setNewDispute({...newDispute,lastName:e.target.value})}/></div></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>PROCESSING DATE (last processed)</div><input type="date" value={newDispute.processingDate} onChange={e=>setNewDispute({...newDispute,processingDate:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>CREDIT MONITORING SERVICE</div><select value={newDispute.creditMonitoring} onChange={e=>setNewDispute({...newDispute,creditMonitoring:e.target.value})}><option value="">Select...</option>{CREDIT_MONITORING_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>SERVICE</div><select value={newDispute.service} onChange={e=>setNewDispute({...newDispute,service:e.target.value})}><option value="">Select...</option>{SERVICE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div><textarea placeholder="Notes" rows={2} value={newDispute.notes} onChange={e=>setNewDispute({...newDispute,notes:e.target.value})} style={{resize:"none"}}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addDisputeClient} style={{background:"#7c3aed",color:"#fff",padding:"10px 20px",borderRadius:4,flex:1}}>ADD CLIENT</button><button className="btn" onClick={()=>setShowAddDispute(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}

      {showAddPIF&&(<div className="modal-overlay" onClick={()=>setShowAddPIF(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4,color:"#34d399"}}>ADD PAY IN FULL</div><div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em",marginBottom:20}}>ONE-TIME PAYMENT — DOES NOT RECUR</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Full name *" value={newPIF.name} onChange={e=>setNewPIF({...newPIF,name:e.target.value})}/><input placeholder="Company" value={newPIF.company} onChange={e=>setNewPIF({...newPIF,company:e.target.value})}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>AMOUNT PAID</div><input placeholder="e.g. 5000" type="number" value={newPIF.amount} onChange={e=>setNewPIF({...newPIF,amount:e.target.value})}/></div><div><div style={{fontSize:9,color:"#475569",letterSpacing:"0.1em",marginBottom:4}}>DATE PAID</div><input type="date" value={newPIF.paidDate} onChange={e=>setNewPIF({...newPIF,paidDate:e.target.value})}/></div></div><textarea placeholder="Notes / scope" rows={2} value={newPIF.notes} onChange={e=>setNewPIF({...newPIF,notes:e.target.value})} style={{resize:"none"}}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addPIF} style={{background:"#065f46",color:"#34d399",padding:"10px 20px",borderRadius:4,flex:1}}>SAVE PIF CLIENT</button><button className="btn" onClick={()=>setShowAddPIF(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}

      {showAddQuote&&(<div className="modal-overlay" onClick={()=>setShowAddQuote(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:"0.12em",marginBottom:4}}>NEW QUOTE</div><div style={{fontSize:10,color:"#64748b",letterSpacing:"0.1em",marginBottom:16}}>{MONTHS[viewMonth].toUpperCase()} {viewYear}</div><div style={{display:"flex",flexDirection:"column",gap:10}}><input placeholder="Contact name *" value={newQuote.name} onChange={e=>setNewQuote({...newQuote,name:e.target.value})}/><input placeholder="Company" value={newQuote.company} onChange={e=>setNewQuote({...newQuote,company:e.target.value})}/><input placeholder="Quote amount (e.g. 2500)" type="number" value={newQuote.amount} onChange={e=>setNewQuote({...newQuote,amount:e.target.value})}/><textarea placeholder="What was quoted / scope notes" rows={3} value={newQuote.notes} onChange={e=>setNewQuote({...newQuote,notes:e.target.value})} style={{resize:"none"}}/></div><div style={{display:"flex",gap:8,marginTop:16}}><button className="btn" onClick={addQuote} style={{background:"#1d4ed8",color:"#fff",padding:"10px 20px",borderRadius:4,flex:1}}>SAVE QUOTE</button><button className="btn" onClick={()=>setShowAddQuote(false)} style={{background:"#1e293b",color:"#94a3b8",padding:"10px 20px",borderRadius:4}}>CANCEL</button></div></div></div>)}
    </div>
  );
}

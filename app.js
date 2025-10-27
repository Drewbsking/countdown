/* ====== Config ====== */
const VERSION_STRING = "RCOC Toolkit v2025.8.2";
const LOGO_FILENAME = "logo.png"; // place this next to index.html

/* ====== Helpers ====== */
const fmtDate = (d, withYear=true) => d
  ? d.toLocaleDateString(undefined, {year: withYear?'numeric':undefined, month:'short', day:'2-digit'})
  : "—";
const fmtDateLong = (d) => d.toLocaleDateString(undefined, {weekday:'long', year:'numeric', month:'long', day:'2-digit'});
const $  = (sel)=>document.querySelector(sel);
const $$ = (sel)=>Array.from(document.querySelectorAll(sel));
const money  = (v)=> new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const money2 = (v)=> new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);

function addYears(date, n){ const d=new Date(date); d.setFullYear(d.getFullYear()+n); return d; }
function maxDate(a,b){ return (a>b)?a:b; }
function minDate(a,b){ return (a<b)?a:b; }

function diffYMDHMSMs(start, end){
  let sign = 1;
  let s = new Date(start), e = new Date(end);
  if (e < s){ sign = -1; [s,e] = [e,s]; }

  let years = e.getFullYear() - s.getFullYear();
  let t = new Date(s); t.setFullYear(s.getFullYear()+years);
  if (t > e){ years--; t.setFullYear(s.getFullYear()+years); }

  let months = e.getMonth() - t.getMonth();
  t.setMonth(t.getMonth()+months);
  if (t > e){ months--; t.setMonth(t.getMonth()+months); }

  let days = Math.floor((e - t) / 86400000);
  t.setDate(t.getDate()+days);

  let rem = e - t;
  let hours = Math.floor(rem/3600000); rem -= hours*3600000;
  let minutes = Math.floor(rem/60000); rem -= minutes*60000;
  let seconds = Math.floor(rem/1000); rem -= seconds*1000;
  let ms = Math.floor(rem);

  return {sign, years, months, days, hours, minutes, seconds, ms};
}
const fmtYMD = (d)=>`${d.years}y ${d.months}m ${d.days}d`;
const pad2 = (n)=>String(n).padStart(2,'0');
const pad3 = (n)=>String(n).padStart(3,'0');

/* ====== Domain logic (ported 1:1) ====== */
function firstDateAgeReached(birth, targetYears){ return addYears(birth, targetYears); }
function firstDateServiceReached(hire, yrs){ return addYears(hire, yrs); }

function retirementDateTierI(birth, hire){
  const pathA = maxDate(firstDateAgeReached(birth,55), firstDateServiceReached(hire,25));
  const pathB = maxDate(firstDateAgeReached(birth,60), firstDateServiceReached(hire,8));
  return minDate(pathA, pathB);
}
function retirementDateTierII(birth, hire){
  return maxDate(firstDateAgeReached(birth,62), firstDateServiceReached(hire,10));
}

function nonrepLeave(yos){
  if (yos <= 4)  return {hours:200, days:25};
  if (yos <= 10) return {hours:240, days:30};
  if (yos <= 15) return {hours:248, days:31};
  if (yos <= 17) return {hours:256, days:32};
  if (yos === 18) return {hours:264, days:33};
  if (yos === 19) return {hours:272, days:34};
  return {hours:280, days:35};
}
function repLeave(yos){
  if (yos <= 4)  return {hours:160, days:20};
  if (yos <= 10) return {hours:240, days:30};
  if (yos <= 15) return {hours:248, days:31};
  if (yos <= 17) return {hours:256, days:32};
  if (yos === 18) return {hours:264, days:33};
  if (yos === 19) return {hours:272, days:34};
  return {hours:280, days:35};
}
const milestones = [5,11,16,18,19,20];
function nextNonrepMilestone(yos){ for (const m of milestones){ if (yos < m) return m; } return null; }
function nextRepMilestone(yos){ for (const m of milestones){ if (yos < m) return m; } return null; }

function retentionAward(yos){
  if (yos < 2) return 300;
  if (yos === 2) return 500;
  if (3 <= yos && yos <= 6) return 600;
  if (yos === 7) return 700;
  if (yos === 8) return 800;
  if (yos === 9) return 900;
  if (yos === 10) return 1000;
  if (yos === 11) return 1100;
  return 1400;
}
function currentPeriodEndSept30(now){
  const end = new Date(now.getFullYear(), 8, 30, 0,0,0,0); // Sept=8
  return (now <= end) ? end : new Date(now.getFullYear()+1, 8, 30, 0,0,0,0);
}

const DEATH_BRACKETS = [
  [30,2000],[25,1500],[20,960],[15,600],[10,400]
];
function deathBenefit(yos){
  for (const [yrs, amt] of DEATH_BRACKETS){ if (yos >= yrs) return amt; }
  return 0;
}
function nextDeathMilestone(yos){
  for (let i=DEATH_BRACKETS.length-1;i>=0;i--){
    const yrs = DEATH_BRACKETS[i][0];
    if (yos < yrs) return yrs;
  }
  return null;
}

function tierCompFactor(tier){ return (tier === "I") ? 0.0225 : 0.015; }
function benefitEstimate(tier, fac, yosAtRet){
  const factor = tierCompFactor(tier);
  const rawPct = factor * yosAtRet;
  const appliedPct = Math.min(rawPct, 0.75);
  const annual = appliedPct * fac;
  return {
    annual,
    monthly: annual/12,
    rawPct,
    appliedPct,
    capped: rawPct > 0.75
  };
}

/* ====== App State ====== */
const state = {
  isNonrep:true,
  tier:"I",
  hasPE:false,
  birth:null,
  hire:null,
  retirementDt:null,
  vestingDt:null,
  periodEnd:null,
  timerId:null
};

/* ====== Background logo load ====== */
(function loadLogo(){
  const img = document.getElementById("bgLogo");
  if (!img) return;
  // Try to load the configured file; if it 404s we just keep it empty.
  fetch(LOGO_FILENAME, {method:"HEAD"})
    .then(res=>{
      if (res.ok){
        img.src = LOGO_FILENAME;
      }
    })
    .catch(()=>{ /* no-op if missing */ });
})();

/* ====== Setup handlers ====== */
document.getElementById("startBtn").addEventListener("click", ()=>{
  const status = document.querySelector('input[name="status"]:checked')?.value || "nonrep";
  state.isNonrep = (status === "nonrep");
  state.tier = document.querySelector('input[name="tier"]:checked')?.value || "I";
  state.hasPE = document.getElementById("hasPE").checked;

  const birthStr = document.getElementById("birthDate").value;
  const hireStr  = document.getElementById("hireDate").value;
  if (!birthStr || !hireStr){
    alert("Please enter both Birth date and Hire date.");
    return;
  }
  const birth = new Date(birthStr);
  const hire  = new Date(hireStr);
  if (isNaN(+birth) || isNaN(+hire)){
    alert("Invalid dates. Please use the date pickers or YYYY-MM-DD.");
    return;
  }
  state.birth = new Date(birth.getFullYear(), birth.getMonth(), birth.getDate());
  state.hire  = new Date(hire.getFullYear(),  hire.getMonth(),  hire.getDate());

  // Compute retirement + vesting
  if (state.tier === "I"){
    state.retirementDt = retirementDateTierI(state.birth, state.hire);
    state.vestingDt = addYears(state.hire, 8);
  }else{
    state.retirementDt = retirementDateTierII(state.birth, state.hire);
    state.vestingDt = addYears(state.hire, 10);
  }
  state.periodEnd = currentPeriodEndSept30(new Date());

  // PE line
  const peLine = document.getElementById("peLine");
  if (state.hasPE){
    const amt = state.isNonrep ? 1500 : 750;
    peLine.style.display = "block";
    peLine.textContent = `PE Stipend: ${money(amt)}/year (${state.isNonrep?'Non-Rep':'Rep'})  •  ≈ ${money2(amt/26)} per check`;
  }else{
    peLine.style.display = "none";
  }

  // Static captions
  document.getElementById("retireCaption").textContent = `Countdown to Retirement (Tier ${state.tier})`;
  document.getElementById("eligDateLine").textContent = `Retirement Eligibility Date: ${fmtDateLong(state.retirementDt)}`;
  document.getElementById("vestingDate").textContent = `Vesting Date: ${fmtDateLong(state.vestingDt)}`;

  // Estimator defaults
  document.getElementById("useEarliest").checked = true;
  const plannedRet = document.getElementById("plannedRet");
  plannedRet.disabled = true;
  plannedRet.value = state.retirementDt.toISOString().slice(0,10);

  // Reveal dashboard
  document.getElementById("setup").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  // Start live updates
  if (state.timerId) clearInterval(state.timerId);
  updateAll();
  state.timerId = setInterval(updateAll, 100);
});

/* planned retirement toggle */
document.getElementById("useEarliest").addEventListener("change", (e)=>{
  const plannedRet = document.getElementById("plannedRet");
  const use = e.target.checked;
  plannedRet.disabled = use;
  if (use && state.retirementDt){
    plannedRet.value = state.retirementDt.toISOString().slice(0,10);
  }
});

/* estimator action */
document.getElementById("estimateBtn").addEventListener("click", ()=>{
  if (!state.hire || !state.retirementDt){ return; }
  const useEarliest = document.getElementById("useEarliest").checked;
  let ret = state.retirementDt;
  if (!useEarliest){
    const s = document.getElementById("plannedRet").value;
    if (!s){ alert("Please pick a planned retirement date."); return; }
    const d = new Date(s);
    if (isNaN(+d)){ alert("Invalid planned retirement date."); return; }
    ret = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const facVal = parseFloat(document.getElementById("fac").value);
  if (!(facVal > 0)){ alert("Enter a positive number for FAC."); return; }

  const rd = diffYMDHMSMs(state.hire, ret);
  const yosAtRet = rd.years + rd.months/12 + rd.days/365.25;
  if (yosAtRet < 0){ alert("Planned retirement date is before your hire date."); return; }

  const est = benefitEstimate(state.tier, facVal, yosAtRet);
  document.getElementById("annualBen").textContent = `Annual Benefit: ${money2(est.annual)}${est.capped?" (CAP APPLIED at 75%)":""}`;
  document.getElementById("monthlyBen").textContent = `Monthly Benefit: ${money2(est.monthly)}`;
  document.getElementById("benDetails").textContent =
    `Inputs → FAC: ${money2(facVal)} • Retirement date: ${fmtDate(ret)} • `
    + `YOS at retirement: ${yosAtRet.toFixed(2)}\n`
    + `Raw % of FAC: ${(est.rawPct*100).toFixed(2)}% • `
    + `Applied %: ${(est.appliedPct*100).toFixed(2)}% `
    + `(Tier ${state.tier} factor = ${(tierCompFactor(state.tier)*100).toFixed(2)}%/YOS)`;
});

/* ====== Live update loop ====== */
function updateAll(){
  const now = new Date();

  // YOS live
  const yos = diffYMDHMSMs(state.hire, now);
  document.getElementById("yos").textContent =
    `${yos.years}y ${yos.months}m ${yos.days}d `
    + `${pad2(yos.hours)}h ${pad2(yos.minutes)}m ${pad2(yos.seconds)}s ${pad3(yos.ms)}ms`;

  // Retirement countdown
  if (now >= state.retirementDt){
    document.getElementById("retireCountdown").textContent = "🎉 TIME TO RETIRE! 🎉";
  }else{
    const rem = diffYMDHMSMs(now, state.retirementDt);
    document.getElementById("retireCountdown").textContent =
      `${rem.years}y ${rem.months}m ${rem.days}d `
      + `${pad2(rem.hours)}h ${pad2(rem.minutes)}m ${pad2(rem.seconds)}s ${pad3(rem.ms)}ms`;
  }

  // Vesting
  if (now >= state.vestingDt){
    document.getElementById("vesting").textContent = "🎖️ VESTED 🎖️";
  }else{
    const v = diffYMDHMSMs(now, state.vestingDt);
    document.getElementById("vesting").textContent = `Countdown to Vesting: ${fmtYMD(v)}`;
  }

  // Vacation
  const yearsCompleted = yos.years;
  let leave, nextM;
  if (state.isNonrep){
    leave = nonrepLeave(yearsCompleted);
    nextM = nextNonrepMilestone(yearsCompleted);
    document.getElementById("leaveLine").textContent = `Non-Rep Annual Leave: ${leave.hours} hours  (${leave.days} days)`;
  }else{
    leave = repLeave(yearsCompleted);
    nextM = nextRepMilestone(yearsCompleted);
    document.getElementById("leaveLine").textContent = `Rep Annual Leave: ${leave.hours} hours  (${leave.days} days)`;
  }
  if (nextM === null){
    document.getElementById("nextLeave").textContent = "Max schedule reached (20+ years).";
  }else{
    const nextAnniv = addYears(state.hire, nextM);
    const d = diffYMDHMSMs(now, nextAnniv);
    document.getElementById("nextLeave").textContent =
      `Next increase at ${nextM} YOS on ${fmtDateLong(nextAnniv)}  —  ${fmtYMD(d)}`;
  }

  // Retention
  if (now > state.periodEnd){
    state.periodEnd = currentPeriodEndSept30(now);
  }
  const yosAtEnd = diffYMDHMSMs(state.hire, state.periodEnd).years;
  const rAmt = retentionAward(Math.max(0, yosAtEnd));
  const rd = diffYMDHMSMs(now, state.periodEnd);
  document.getElementById("retentionLine").textContent =
    `Retention (as of ${fmtDate(state.periodEnd, false)}):  ${money(rAmt)}`;
  document.getElementById("retentionCountdown").textContent =
    `Time until period end: ${fmtYMD(rd)}`;

  // Death benefit
  const amtNow = deathBenefit(yearsCompleted);
  document.getElementById("deathNow").textContent = `Death Benefit (if retired today):  ${money(amtNow)}`;

  const yosAtRet = diffYMDHMSMs(state.hire, state.retirementDt).years;
  const amtRet = deathBenefit(Math.max(0, yosAtRet));
  document.getElementById("deathRet").textContent = `Projected at retirement eligibility: ${money(amtRet)}  (YOS then: ${yosAtRet})`;

  const nxt = nextDeathMilestone(yearsCompleted);
  if (nxt === null){
    document.getElementById("deathNext").textContent = "Death benefit already at maximum schedule (30+ years).";
  }else{
    const nxtDate = addYears(state.hire, nxt);
    const dd = diffYMDHMSMs(now, nxtDate);
    document.getElementById("deathNext").textContent =
      `Next death-benefit bump at ${nxt} YOS on ${fmtDateLong(nxtDate)}  —  ${fmtYMD(dd)}`;
  }

  // Watermark text (in case you want to change centrally)
  const wm = document.querySelector(".watermark");
  if (wm) wm.textContent = VERSION_STRING;
}

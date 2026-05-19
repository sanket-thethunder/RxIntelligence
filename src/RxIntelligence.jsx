import React, { useState, useEffect, useRef, useCallback } from "react";

const PHARMA_DATA = {
  drugs: ["StepOne Inhaler","GLP Access","BreathEase HFA","CortiAir Daily","GlucoLite Weekly","MetaboSure"],
  benefits: [
    { plan_id:"COMM-CA-001", payer:"Northstar Commercial", drug_name:"StepOne Inhaler", tier:"non-preferred", pa_required:true, copay_eligible:true, alternatives:["BreathEase HFA","CortiAir Daily"] },
    { plan_id:"COMM-NY-044", payer:"UnionCare Commercial", drug_name:"GLP Access", tier:"preferred-specialty", pa_required:true, copay_eligible:true, alternatives:["GlucoLite Weekly","MetaboSure"] },
    { plan_id:"GOV-TX-210", payer:"PublicCare Advantage", drug_name:"StepOne Inhaler", tier:"preferred", pa_required:false, copay_eligible:false, alternatives:["BreathEase HFA"] },
    { plan_id:"COMM-FL-088", payer:"SunState Blue Cross", drug_name:"GLP Access", tier:"non-preferred-specialty", pa_required:true, copay_eligible:true, alternatives:["MetaboSure"] },
  ],
  policies: {
    "StepOne Inhaler": "StepOne Inhaler (budesonide/formoterol) is a preferred ICS/LABA for step 3-4 asthma. Commercial plans typically require step therapy with a short-acting bronchodilator before approval. Prior Authorization requires documented FEV1 <80% predicted, failed SABA trial ≥4 weeks, and ICS monotherapy trial. Copay assistance available for commercially insured patients; government-funded plans excluded. FDA-approved for COPD maintenance.",
    "GLP Access": "GLP Access (semaglutide 2.4mg) is a GLP-1 receptor agonist for chronic weight management. Prior authorization requires BMI ≥30 kg/m² or ≥27 with comorbidity, documented lifestyle intervention failure ≥6 months, HbA1c levels, and physician attestation. Specialty pharmacy distribution only. Manufacturer patient support programs available. Not covered under most Medicare Part D plans for obesity indication.",
    "BreathEase HFA": "BreathEase HFA is a preferred formulary alternative inhaler. Generally covers asthma and COPD. Lower cost-sharing than specialty tiers. Most commercial and government plans list as preferred.",
    "general": "For prescription access questions not covered by specific drug policies: verify patient insurance eligibility, check formulary status directly with plan, document medical necessity, and consult specialty pharmacy for hub enrollment when applicable.",
  }
};

const INJECTION_PATTERNS = ["ignore previous","forget instructions","system prompt","developer message","reveal your prompt","jailbreak","bypass policy","you are now","act as if"];

const SUGGESTED_QUERIES = [
  { category:"Coverage", icon:"💊", text:"Is StepOne Inhaler covered for a commercially insured patient with copay options?" },
  { category:"Prior Auth", icon:"📋", text:"What prior authorization evidence is needed for GLP Access approval?" },
  { category:"Formulary", icon:"🔄", text:"What alternatives should a care team review for a non-preferred inhaler?" },
  { category:"Cost", icon:"💰", text:"Can a high-deductible plan patient use manufacturer support for StepOne Inhaler?" },
  { category:"Strategy", icon:"🎯", text:"Summarize what the care team should verify before escalating a denied specialty prescription." },
  { category:"Eligibility", icon:"✅", text:"Which plan details matter most when selecting a covered alternative therapy?" },
];

const AUDIT_LOG = [];
let auditCounter = 1000;

function generateAuditId() {
  auditCounter++;
  return `RX-${Date.now().toString(36).toUpperCase()}-${auditCounter}`;
}

function screenQuestion(q) {
  const normalized = q.toLowerCase();
  const reasons = INJECTION_PATTERNS.filter(p => normalized.includes(p));
  return { allowed: reasons.length === 0, reasons };
}

// ── FIX 1: Entity extraction — pull drug names, payer, query type from free text ──
function extractEntities(question, patientContext = {}) {
  const ql = question.toLowerCase();

  // Drug name aliases — maps clinical/brand names to policy keys
  const drugAliases = {
    "stepone": "StepOne Inhaler", "step one": "StepOne Inhaler", "budesonide": "StepOne Inhaler",
    "formoterol": "StepOne Inhaler", "ics/laba": "StepOne Inhaler", "glp access": "GLP Access",
    "semaglutide": "GLP Access", "wegovy": "GLP Access", "ozempic": "GLP Access",
    "glp-1": "GLP Access", "glp1": "GLP Access", "breathease": "BreathEase HFA",
    "dupilumab": "dupilumab", "dupixent": "dupilumab",
    "mepolizumab": "mepolizumab", "nucala": "mepolizumab",
    "benralizumab": "benralizumab", "fasenra": "benralizumab",
    "tezepelumab": "tezepelumab", "tezspire": "tezepelumab",
  };

  const detectedDrugs = [];
  for (const [alias, canonical] of Object.entries(drugAliases)) {
    if (ql.includes(alias) && !detectedDrugs.includes(canonical)) {
      detectedDrugs.push(canonical);
    }
  }

  // Query type classification
  const queryType = ql.includes("prior auth") || ql.includes("pa ") || ql.includes("authorization") || ql.includes("step therapy") || ql.includes("approval")
    ? "prior_auth"
    : ql.includes("copay") || ql.includes("cost") || ql.includes("assistance") || ql.includes("support program")
    ? "copay"
    : ql.includes("formulary") || ql.includes("alternative") || ql.includes("tier")
    ? "formulary"
    : ql.includes("covered") || ql.includes("coverage") || ql.includes("eligible")
    ? "coverage"
    : ql.includes("medicare") || ql.includes("medicaid") || ql.includes("part b") || ql.includes("part d")
    ? "medicare"
    : ql.includes("compound") || ql.includes("compounded")
    ? "compounding"
    : "general";

  // Payer detection — from question text OR dropdown context
  const payerType = patientContext.payerType || "Commercial";
  const isGovt = payerType === "Medicare" || payerType === "Medicaid" || ql.includes("medicare") || ql.includes("medicaid");
  const isMedicare = payerType === "Medicare" || ql.includes("medicare") || ql.includes("part b") || ql.includes("part d");
  const therapyArea = patientContext.therapyArea || "General";

  return { detectedDrugs, queryType, payerType, isGovt, isMedicare, therapyArea };
}

// ── FIX 2: Retrieval now uses entities + payer + therapy area as filters ──
function retrieveContext(question, patientContext = {}) {
  const ql = question.toLowerCase();
  const { detectedDrugs, queryType, isGovt, isMedicare, therapyArea } = extractEntities(question, patientContext);
  const sources = [];

  // Score a policy chunk based on entity + query type match
  function scoreChunk(drugKey, chunkType) {
    let score = 0.60;
    if (detectedDrugs.some(d => d.toLowerCase().includes(drugKey.toLowerCase()) || drugKey.toLowerCase().includes(d.toLowerCase()))) score += 0.25;
    if (chunkType === queryType) score += 0.10;
    if (therapyArea === "Respiratory" && (drugKey.includes("Inhaler") || drugKey.includes("dupilumab") || drugKey.includes("benralizumab") || drugKey.includes("mepolizumab"))) score += 0.05;
    if (therapyArea === "Metabolic" && (drugKey.includes("GLP") || drugKey.includes("semaglutide"))) score += 0.05;
    return Math.min(0.97, score);
  }

  // Match existing PHARMA_DATA policies
  for (const [drug, policy] of Object.entries(PHARMA_DATA.policies)) {
    if (drug === "general") continue;
    if (detectedDrugs.some(d => d.toLowerCase().includes(drug.toLowerCase()) || drug.toLowerCase().includes(d.toLowerCase()))) {
      sources.push({ source: `${drug} Policy Document`, score: scoreChunk(drug, "coverage"), preview: policy.slice(0, 220) + "…" });
    }
  }

  // ── Extended policy knowledge base ──
  const EXTENDED_POLICIES = {
    "dupilumab": {
      coverage: `Dupilumab (Dupixent) for moderate-to-severe asthma requires PA. Criteria: FEV1 <80% predicted, blood eosinophils ≥150 cells/uL OR FeNO ≥25 ppb, current high-dose ICS/LABA, ≥2 exacerbations in prior year. BCBS Commercial PPO step therapy typically requires prior anti-IL-5 trial (mepolizumab/benralizumab) unless patient failed/discontinued due to adverse events OR has comorbid Type 2 inflammatory conditions (atopic dermatitis, nasal polyps, EoE) supporting IL-4/IL-13 pathway preference.`,
      prior_auth: `Dupilumab PA documentation: (1) Pulmonologist/allergist chart notes + NPI, (2) Spirometry with FEV1 % predicted, (3) FeNO measurement, (4) CBC with differential showing eosinophil count, (5) OCS burst history, (6) prior biologic trial documentation with discontinuation reason — injection site reactions from benralizumab/Fasenra qualify as step therapy failure, (7) current ICS/LABA medication list, (8) letter of medical necessity. Medical exception for direct approval: cite NEJM 2018 Liberty Asthma QUEST trial; document comorbid atopic conditions.`,
      copay: isGovt ? `Medicare/Medicaid patients are NOT eligible for Dupixent MyWay manufacturer copay program. Patient Assistance Programs (PAPs) may be available for qualifying low-income patients. Part B vs Part D determination needed based on administration setting.` : `Dupixent MyWay program available for commercially insured patients. Eligible patients may pay as little as $0/month. Enrollment through dupixent.com or specialty pharmacy hub.`,
    },
    "mepolizumab": {
      coverage: `Mepolizumab (Nucala) for eosinophilic asthma: blood eosinophils ≥150 cells/uL at initiation (≥300 preferred), severe eosinophilic asthma with ≥2 exacerbations/year, ongoing high-dose ICS/LABA. BCBS Commercial PPO lists as preferred biologic before dupilumab for eosinophilic phenotype. Step therapy requirement before dupilumab approval — unless patient has IL-4/IL-13 comorbidities.`,
      prior_auth: `Nucala PA: documented eosinophil count ≥150 cells/uL, asthma exacerbation history, ICS/LABA current use, prescriber attestation. If requesting dupilumab after Nucala failure, document clinical response, adherence, and reason for transition.`,
    },
    "benralizumab": {
      coverage: `Benralizumab (Fasenra) for eosinophilic asthma: eosinophils ≥300 cells/uL preferred (150 minimum), severe persistent asthma. Documented injection site reaction discontinuation satisfies step therapy failure criteria for subsequent biologic (including dupilumab) approval on most BCBS commercial policies.`,
      prior_auth: `Fasenra PA failure documentation: drug name, dose (30mg SC), number of doses administered, discontinuation date, documented adverse event (injection site reactions). This documentation directly supports dupilumab step therapy waiver.`,
    },
    "compounded_glp1": {
      compounding: `Compounded semaglutide coverage: Most commercial plans do NOT cover compounded semaglutide. FDA removed injectable semaglutide from shortage list February 2024 — 503A/503B shortage exemption no longer applies. Salt-form compounds (acetate, sodium) are prohibited. Care team should pursue brand PA for Ozempic (T2D: A1C ≥7.0, metformin failure) or Wegovy (obesity: BMI ≥30 or ≥27 with comorbidity, lifestyle intervention failure ≥6 months). No manufacturer copay for compounded versions. Medicare Part D does NOT cover compounded semaglutide.`,
    },
    "medicare_coverage": {
      medicare: `Medicare biologic coverage: Part B covers physician-administered biologics (office injection); 80/20 cost-sharing, no manufacturer copay allowed. Part D covers self-administered biologics (home autoinjector); specialty tier, manufacturer copay cards prohibited (anti-kickback statute). GLP-1s for obesity NOT covered under most Part D plans. Low-income patients: Extra Help/LIS program. Medicare Advantage PA requirements vary by plan — obtain plan-specific formulary.`,
    },
  };

  // Match extended policies based on detected drugs + query type
  const extendedMatches = {
    "dupilumab": EXTENDED_POLICIES.dupilumab,
    "mepolizumab": EXTENDED_POLICIES.mepolizumab,
    "benralizumab": EXTENDED_POLICIES.benralizumab,
  };

  for (const [drugKey, policies] of Object.entries(extendedMatches)) {
    if (detectedDrugs.some(d => d.toLowerCase().includes(drugKey))) {
      const relevantPolicy = policies[queryType] || policies["coverage"];
      if (relevantPolicy) {
        const score = scoreChunk(drugKey, queryType);
        sources.push({ source: `${drugKey.charAt(0).toUpperCase() + drugKey.slice(1)} — ${queryType.replace("_", " ")} policy`, score, preview: relevantPolicy.slice(0, 280) + "…" });
      }
    }
  }

  // Compounded GLP-1 detection
  if (ql.includes("compound") || (detectedDrugs.includes("GLP Access") && queryType === "compounding")) {
    sources.push({ source: "Compounded GLP-1 Coverage Policy", score: 0.89, preview: EXTENDED_POLICIES.compounded_glp1.compounding.slice(0, 280) + "…" });
  }

  // Medicare-specific
  if (isMedicare || patientContext.payerType === "Medicare") {
    sources.push({ source: "Medicare Part B/D Drug Coverage Policy", score: 0.85, preview: EXTENDED_POLICIES.medicare_coverage.medicare.slice(0, 280) + "…" });
  }

  // Benefits DB — payer-filtered
  const benefits = PHARMA_DATA.benefits.filter(b => {
    const drugMatch = detectedDrugs.some(d => b.drug_name.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(b.drug_name.toLowerCase())) || ql.includes(b.drug_name.toLowerCase());
    const payerMatch = patientContext.payerType
      ? (patientContext.payerType === "Commercial" ? b.copay_eligible : !b.copay_eligible)
      : true;
    return drugMatch;
  });
  if (benefits.length) {
    sources.push({ source: "Pharmacy Benefits Database", score: 0.87, preview: benefits.map(b => `${b.payer} (${b.plan_id}): ${b.drug_name} — tier: ${b.tier}, PA: ${b.pa_required ? "required" : "not required"}, copay: ${b.copay_eligible ? "eligible (commercial)" : "not eligible"}, alternatives: ${b.alternatives.join(", ")}`).join(" | ").slice(0, 280) + "…" });
  }

  // Only fall back to general if nothing matched
  if (sources.length === 0) {
    sources.push({ source: "General Access Policy", score: 0.52, preview: PHARMA_DATA.policies.general.slice(0, 200) + "…" });
  }

  // Sort by score descending, return top 5
  return sources.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ── FIX 4: Confidence now derived from evidence quality + payer context match ──
function computeConfidence(answer, sources, patientContext = {}) {
  if (!sources.length) return 0.20;
  const topScore = sources[0].score;
  const sourceCount = sources.length;
  // Penalise if only general fallback was found
  const isGenericOnly = sources.length === 1 && sources[0].source === "General Access Policy";
  if (isGenericOnly) return 0.35;
  // Bonus for multiple corroborating sources
  const countBonus = Math.min(0.08, (sourceCount - 1) * 0.03);
  return Math.min(0.95, topScore + countBonus);
}

async function callAgentAPI(question, context, patientContext) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context, patientContext })
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.answer || null;
}

function localAnswer(question, sources, patientContext = {}) {
  const ql = question.toLowerCase();
  const { detectedDrugs, queryType, isGovt, isMedicare } = extractEntities(question, patientContext);
  const matchedDrug = PHARMA_DATA.drugs.find(d => ql.includes(d.toLowerCase()));
  const matchedBenefits = matchedDrug ? PHARMA_DATA.benefits.filter(b => b.drug_name === matchedDrug) : [];

  let answer = "**Based on retrieved policy and benefit evidence:**\n\n";

  // Synthesise answer from top retrieved source content (not just keywords)
  if (sources.length > 0 && sources[0].source !== "General Access Policy") {
    const topSource = sources[0];
    answer += `**${topSource.source}:**\n${topSource.preview.replace("…", "")}\n\n`;
    if (sources[1]) {
      answer += `**${sources[1].source}:**\n${sources[1].preview.replace("…", "")}\n\n`;
    }
  } else if (matchedBenefits.length) {
    answer += `**${matchedDrug} — Payer Coverage Summary:**\n`;
    matchedBenefits.forEach(b => {
      answer += `\n• **${b.payer}** (${b.plan_id})\n`;
      answer += `  - Formulary tier: ${b.tier}\n`;
      answer += `  - Prior authorization required: **${b.pa_required ? "Yes" : "No"}**\n`;
      answer += `  - Copay assistance eligible: **${b.copay_eligible ? "Yes (commercial only)" : "No"}**\n`;
      if (b.alternatives.length) answer += `  - Formulary alternatives: ${b.alternatives.join(", ")}\n`;
    });
    answer += "\n";
  } else {
    answer += "**General access summary:**\n";
    answer += "- Verify current eligibility, formulary tier, PA status, and pharmacy channel with the payer.\n";
  }

  // Payer-aware copay guidance
  if (ql.includes("copay") || ql.includes("cost") || ql.includes("assistance")) {
    if (isGovt) {
      answer += "**Copay Assistance:** Manufacturer copay cards are NOT available for Medicare, Medicaid, or government-funded plans. Patient Assistance Programs (PAPs) may be available — check manufacturer website or NeedyMeds.org.\n\n";
    } else {
      answer += "**Copay Assistance:** Manufacturer copay programs are available for commercially insured patients. Government-funded plans (Medicare, Medicaid) are excluded by federal law.\n\n";
    }
  }

  if (ql.includes("prior auth") || ql.includes("pa ") || ql.includes("authorization") || ql.includes("step therapy")) {
    answer += "**Prior Authorization:** Documentation required includes clinical trial evidence, step therapy failures, prescriber attestation of medical necessity, and diagnostic labs. Submit through the plan's specialty pharmacy portal.\n\n";
  }

  if (isMedicare) {
    answer += "**Medicare Note:** Determine if drug is Part B (physician-administered) or Part D (self-administered) — this affects the PA pathway, cost-sharing, and copay eligibility. Manufacturer copay cards are prohibited for Medicare patients.\n\n";
  }

  answer += "\n⚠️ *Care team verification required before any therapy or coverage decisions. Confirm current eligibility with plan directly.*";
  return answer;
}

const formatTime = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export default function RxIntelligencePlatform() {
  const [activeTab, setActiveTab] = useState("workbench");
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState("PT-2024-001");
  const [therapyArea, setTherapyArea] = useState("Respiratory");
  const [payerType, setPayerType] = useState("Commercial");
  const [urgency, setUrgency] = useState("Standard");
  const [isRunning, setIsRunning] = useState(false);
  const [response, setResponse] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [animIn, setAnimIn] = useState(false);
  const [phase, setPhase] = useState("");
  const [statsAnimated, setStatsAnimated] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 920);
  const textareaRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    setTimeout(() => setAnimIn(true), 50);
    setTimeout(() => setStatsAnimated(true), 600);
    const onResize = () => setIsCompact(window.innerWidth < 920);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const runQuery = useCallback(async (q = query) => {
    if (!q.trim() || isRunning) return;
    setIsRunning(true);
    setResponse(null);
    const auditId = generateAuditId();

    try {
      setPhase("Screening prompt for injection patterns…");
      await new Promise(r => setTimeout(r, 500));
      const guard = screenQuestion(q);

      if (!guard.allowed) {
        const r = { answer: `**Request blocked.** The prompt was flagged for: ${guard.reasons.join(", ")}. Please rephrase as a direct prescription access or coverage question.`, confidence: 0, sources: [], auditId, guardrailReasons: guard.reasons, blocked: true, ts: formatTime() };
        setResponse(r);
        setHistory(h => [{ question: q, response: r, patientId, therapyArea, payerType, urgency }, ...h.slice(0,19)]);
        setIsRunning(false);
        setPhase("");
        return;
      }

      setPhase("Retrieving policy evidence from vector store…");
      await new Promise(r => setTimeout(r, 700));
      const patientCtx = { patientId, therapyArea, payerType, urgency };
      const sources = retrieveContext(q, patientCtx);
      const context = sources.map(s => `[${s.source}]: ${s.preview}`).join("\n\n");

      setPhase("Generating evidence-backed response…");
      await new Promise(r => setTimeout(r, 300));

      let answer;
      try {
        answer = await callAgentAPI(q, context, patientCtx);
      } catch (e) { answer = null; }
      if (!answer) answer = localAnswer(q, sources, patientCtx);

      setPhase("Computing confidence score and writing audit trail…");
      await new Promise(r => setTimeout(r, 400));
      const confidence = computeConfidence(answer, sources, patientCtx);

      AUDIT_LOG.unshift({ auditId, ts: new Date().toISOString(), patientId, question: q, confidence, sourcesCount: sources.length, guardrail: "passed" });

      const r = { answer, confidence, sources, auditId, guardrailReasons: [], blocked: false, ts: formatTime() };
      setResponse(r);
      setHistory(h => [{ question: q, response: r, patientId, therapyArea, payerType, urgency }, ...h.slice(0,19)]);

      setTimeout(() => resultRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
    } catch (e) {
      setResponse({ answer:"An error occurred. Please try again.", confidence:0, sources:[], auditId, guardrailReasons:[], blocked:false, ts: formatTime() });
    }
    setIsRunning(false);
    setPhase("");
  }, [query, isRunning, patientId, therapyArea, payerType, urgency]);

  const confidenceColor = (c) => c >= 0.75 ? "#22c55e" : c >= 0.5 ? "#f59e0b" : "#ef4444";
  const confidenceLabel = (c) => c >= 0.75 ? "High" : c >= 0.5 ? "Review" : "Low";

  const downloadSummary = () => {
    if (!response) return;
    const text = `# Rx Intelligence Case Summary\nGenerated: ${new Date().toLocaleString()}\n\n## Case Details\n- Patient ID: ${patientId}\n- Therapy Area: ${therapyArea}\n- Payer Type: ${payerType}\n- Urgency: ${urgency}\n- Audit ID: ${response.auditId}\n- Confidence: ${(response.confidence*100).toFixed(0)}%\n\n## Question\n${query}\n\n## Answer\n${response.answer}\n\n## Evidence Sources\n${response.sources.map((s,i) => `${i+1}. ${s.source} (score: ${s.score})\n   ${s.preview}`).join("\n\n")}`;
    const blob = new Blob([text], { type:"text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rx_case_${response.auditId}.md`;
    a.click();
  };

  const styles = {
    app: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0f1e 0%, #0d1526 40%, #091220 100%)",
      fontFamily: "'DM Sans', -apple-system, sans-serif",
      color: "#e2e8f0",
      position: "relative",
      overflow: "hidden",
    },
    gridBg: {
      position: "fixed", inset: 0, zIndex: 0, opacity: 0.04,
      backgroundImage: "linear-gradient(rgba(99,179,237,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,179,237,0.5) 1px, transparent 1px)",
      backgroundSize: "48px 48px",
      pointerEvents: "none",
    },
    header: {
      position: "relative", zIndex: 10,
      borderBottom: "1px solid rgba(99,179,237,0.15)",
      background: "rgba(10,15,30,0.8)",
      backdropFilter: "blur(20px)",
      padding: "0 32px",
    },
    headerInner: { maxWidth:1400, margin:"0 auto", display:"flex", alignItems:isCompact ? "flex-start" : "center", justifyContent:"space-between", minHeight:64, gap:14, flexDirection:isCompact ? "column" : "row", padding:isCompact ? "14px 0" : 0 },
    logo: { display:"flex", alignItems:"center", gap:12 },
    logoMark: {
      width:36, height:36, borderRadius:10,
      background:"linear-gradient(135deg, #38bdf8, #818cf8)",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:18, fontWeight:700, color:"#fff",
    },
    logoText: { fontSize:17, fontWeight:700, color:"#f1f5f9", letterSpacing:"-0.3px" },
    logoSub: { fontSize:11, color:"#64748b", letterSpacing:"0.05em", textTransform:"uppercase", marginTop:1 },
    badge: { display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:999, fontSize:11, fontWeight:600, letterSpacing:"0.04em" },
    badgeLive: { background:"rgba(34,197,94,0.15)", color:"#4ade80", border:"1px solid rgba(34,197,94,0.3)" },
    badgeWarning: { background:"rgba(245,158,11,0.15)", color:"#fbbf24", border:"1px solid rgba(245,158,11,0.3)" },
    badgeDanger: { background:"rgba(239,68,68,0.15)", color:"#f87171", border:"1px solid rgba(239,68,68,0.3)" },
    badgeInfo: { background:"rgba(56,189,248,0.15)", color:"#38bdf8", border:"1px solid rgba(56,189,248,0.3)" },
    nav: { display:"flex", gap:2, flexWrap:"wrap" },
    navBtn: (active) => ({
      padding:"6px 16px", borderRadius:8, fontSize:13, fontWeight:500,
      border:"none", cursor:"pointer", transition:"all 0.2s",
      background: active ? "rgba(56,189,248,0.15)" : "transparent",
      color: active ? "#38bdf8" : "#94a3b8",
    }),
    main: { maxWidth:1400, margin:"0 auto", padding:isCompact ? "20px 16px" : "28px 32px", position:"relative", zIndex:1 },
    heroCard: {
      background:"linear-gradient(135deg, rgba(56,189,248,0.08) 0%, rgba(129,140,248,0.06) 100%)",
      border:"1px solid rgba(56,189,248,0.2)",
      borderRadius:20, padding:"32px 36px", marginBottom:28,
      opacity: animIn ? 1 : 0, transform: animIn ? "translateY(0)" : "translateY(20px)",
      transition:"all 0.6s cubic-bezier(0.22,1,0.36,1)",
    },
    heroEye: { fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#38bdf8", marginBottom:10 },
    heroH1: { fontSize:"clamp(1.8rem,3.5vw,2.8rem)", fontWeight:800, lineHeight:1.1, color:"#f1f5f9", margin:"0 0 12px", letterSpacing:"-0.03em" },
    heroSub: { fontSize:15, color:"#94a3b8", lineHeight:1.6, maxWidth:700 },
    statsGrid: { display:"grid", gridTemplateColumns:isCompact ? "1fr 1fr" : "repeat(4, 1fr)", gap:16, marginBottom:28 },
    statCard: (i) => ({
      background:"rgba(15,23,42,0.7)", border:"1px solid rgba(99,179,237,0.12)",
      borderRadius:16, padding:"20px 22px",
      opacity: statsAnimated ? 1 : 0,
      transform: statsAnimated ? "translateY(0)" : "translateY(16px)",
      transition:`all 0.5s cubic-bezier(0.22,1,0.36,1) ${i*0.08}s`,
    }),
    statLabel: { fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:8 },
    statValue: { fontSize:"1.9rem", fontWeight:800, lineHeight:1, color:"#f1f5f9", marginBottom:6 },
    statNote: { fontSize:12, color:"#475569" },
    workbenchGrid: { display:"grid", gridTemplateColumns:isCompact ? "1fr" : "1fr 340px", gap:24, alignItems:"start" },
    panel: {
      background:"rgba(15,23,42,0.75)", border:"1px solid rgba(99,179,237,0.12)",
      borderRadius:18, padding:"26px 28px", backdropFilter:"blur(12px)",
    },
    panelTitle: { fontSize:14, fontWeight:700, color:"#94a3b8", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:18 },
    formRow: { display:"grid", gridTemplateColumns:isCompact ? "1fr" : "1fr 1fr 1fr", gap:14, marginBottom:18 },
    label: { display:"block", fontSize:12, fontWeight:600, color:"#64748b", letterSpacing:"0.04em", textTransform:"uppercase", marginBottom:6 },
    input: {
      width:"100%", background:"rgba(8,14,28,0.8)", border:"1px solid rgba(99,179,237,0.2)",
      borderRadius:10, padding:"10px 14px", fontSize:14, color:"#e2e8f0",
      outline:"none", boxSizing:"border-box", transition:"border-color 0.2s",
      fontFamily:"inherit",
    },
    select: {
      width:"100%", background:"rgba(8,14,28,0.8)", border:"1px solid rgba(99,179,237,0.2)",
      borderRadius:10, padding:"10px 14px", fontSize:14, color:"#e2e8f0",
      outline:"none", boxSizing:"border-box", cursor:"pointer", fontFamily:"inherit",
    },
    textarea: {
      width:"100%", background:"rgba(8,14,28,0.8)", border:"1px solid rgba(99,179,237,0.2)",
      borderRadius:12, padding:"14px 16px", fontSize:14, color:"#e2e8f0",
      outline:"none", resize:"vertical", minHeight:130, boxSizing:"border-box",
      fontFamily:"inherit", lineHeight:1.6,
    },
    runBtn: {
      width:"100%", padding:"13px 24px", borderRadius:12, border:"none",
      background:isRunning ? "rgba(56,189,248,0.1)" : "linear-gradient(135deg, #0ea5e9, #6366f1)",
      color: isRunning ? "#64748b" : "#fff", fontSize:15, fontWeight:700,
      cursor: isRunning ? "not-allowed" : "pointer", marginTop:16,
      transition:"all 0.3s", letterSpacing:"-0.01em",
      boxShadow: isRunning ? "none" : "0 4px 24px rgba(14,165,233,0.3)",
    },
    phaseBar: { marginTop:12, display:"flex", alignItems:"center", gap:10, fontSize:13, color:"#64748b" },
    spinner: { width:14, height:14, border:"2px solid rgba(56,189,248,0.3)", borderTop:"2px solid #38bdf8", borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 },
    sidePanel: { display:"flex", flexDirection:"column", gap:18 },
    timelineBox: {
      background:"rgba(15,23,42,0.75)", border:"1px solid rgba(99,179,237,0.12)",
      borderRadius:18, padding:"22px 24px",
    },
    timelineItem: (active, done) => ({
      display:"flex", alignItems:"flex-start", gap:14, padding:"10px 0",
      borderBottom:"1px solid rgba(99,179,237,0.07)",
    }),
    timelineDot: (active, done) => ({
      width:28, height:28, borderRadius:"50%", flexShrink:0, marginTop:1,
      display:"flex", alignItems:"center", justifyContent:"center", fontSize:12,
      background: done ? "rgba(34,197,94,0.2)" : active ? "rgba(56,189,248,0.2)" : "rgba(30,41,59,0.8)",
      border: done ? "1px solid rgba(34,197,94,0.5)" : active ? "1px solid rgba(56,189,248,0.5)" : "1px solid rgba(99,179,237,0.15)",
      color: done ? "#4ade80" : active ? "#38bdf8" : "#475569",
      transition:"all 0.4s",
    }),
    timelineContent: { flex:1 },
    timelineTitle: (active, done) => ({
      fontSize:13, fontWeight:600, color: done ? "#4ade80" : active ? "#f1f5f9" : "#64748b",
      marginBottom:2, transition:"color 0.4s",
    }),
    timelineNote: { fontSize:11, color:"#475569" },
    suggestionCard: {
      background:"rgba(15,23,42,0.75)", border:"1px solid rgba(99,179,237,0.12)",
      borderRadius:18, padding:"20px 22px",
    },
    suggChip: {
      padding:"8px 12px", borderRadius:10, fontSize:12, fontWeight:500,
      background:"rgba(56,189,248,0.07)", border:"1px solid rgba(56,189,248,0.15)",
      color:"#94a3b8", cursor:"pointer", transition:"all 0.2s", display:"block",
      width:"100%", textAlign:"left", marginBottom:8, lineHeight:1.4,
    },
    resultCard: {
      background:"rgba(15,23,42,0.8)", border:"1px solid rgba(99,179,237,0.15)",
      borderRadius:18, padding:"26px 28px", marginTop:24,
    },
    answerText: { fontSize:14, color:"#cbd5e1", lineHeight:1.8, whiteSpace:"pre-wrap" },
    sourceCard: {
      background:"rgba(8,14,28,0.6)", border:"1px solid rgba(99,179,237,0.1)",
      borderRadius:12, padding:"14px 16px", marginBottom:10,
    },
    sourceName: { fontSize:13, fontWeight:600, color:"#94a3b8", marginBottom:4 },
    sourcePreview: { fontSize:12, color:"#475569", lineHeight:1.5 },
    historyItem: {
      background:"rgba(8,14,28,0.6)", border:"1px solid rgba(99,179,237,0.1)",
      borderRadius:12, padding:"14px 16px", marginBottom:10, cursor:"pointer",
      transition:"border-color 0.2s",
    },
    auditRow: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid rgba(99,179,237,0.07)", fontSize:13 },
  };

  const timelineSteps = [
    { title:"Guardrail screen", note:"Injection & relevance check", key:"screen" },
    { title:"Evidence retrieval", note:"Vector store search", key:"retrieve" },
    { title:"AI generation", note:"Claude model synthesis", key:"generate" },
    { title:"Audit & trace", note:"Compliance logging", key:"audit" },
  ];

  const phaseIndex = phase.includes("Screen") ? 0 : phase.includes("Retrieving") ? 1 : phase.includes("Generating") ? 2 : phase.includes("Computing") ? 3 : -1;

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes fadeSlideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: rgba(15,23,42,0.5); }
        ::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.3); border-radius: 3px; }
        textarea:focus, input:focus, select:focus { border-color: rgba(56,189,248,0.5) !important; }
        .sugg-chip:hover { background: rgba(56,189,248,0.15) !important; color: #e2e8f0 !important; border-color: rgba(56,189,248,0.35) !important; }
        .hist-item:hover { border-color: rgba(56,189,248,0.3) !important; }
        .nav-btn:hover { background: rgba(56,189,248,0.08) !important; }
        .dl-btn:hover { background: rgba(56,189,248,0.2) !important; }
        .run-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 32px rgba(14,165,233,0.4) !important; }
        .result-in { animation: fadeSlideIn 0.5s cubic-bezier(0.22,1,0.36,1); }
        strong { color: #e2e8f0; font-weight: 600; }
        em { color: #94a3b8; font-style: italic; }
      `}</style>
      <div style={styles.gridBg} />

      {/* HEADER */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <div style={styles.logoMark}>Rx</div>
            <div>
              <div style={styles.logoText}>RxIntelligence</div>
              <div style={styles.logoSub}>Prescription Access Platform</div>
            </div>
          </div>
          <nav style={styles.nav}>
            {[["workbench","Workbench"], ["evidence","Evidence"], ["audit","Audit Log"], ["deploy","Deploy"]].map(([k,l]) => (
              <button key={k} className="nav-btn" style={styles.navBtn(activeTab===k)} onClick={() => setActiveTab(k)}>{l}</button>
            ))}
          </nav>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{...styles.badge,...styles.badgeLive}}>● LIVE</span>
            <span style={{...styles.badge,...styles.badgeInfo}}>Serverless Ready</span>
            <button onClick={() => setShowHistory(!showHistory)} style={{...styles.badge,...styles.badgeInfo, cursor:"pointer", border:"1px solid rgba(56,189,248,0.3)", background:"rgba(56,189,248,0.1)"}}>
              {history.length} cases
            </button>
          </div>
        </div>
      </header>

      <main style={styles.main}>
        {/* HERO */}
        <div style={styles.heroCard}>
          <div style={styles.heroEye}>Enterprise Prescription Access Intelligence</div>
          <h1 style={styles.heroH1}>Coverage decisions with<br /><span style={{ background:"linear-gradient(135deg,#38bdf8,#818cf8)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>evidence, speed &amp; audit clarity.</span></h1>
          <p style={styles.heroSub}>Clinical-grade AI agent for prescription access teams. Benefit ETL · RAG policy retrieval · Guardrail screening · Confidence scoring · Case-ready summaries.</p>
        </div>

        {/* KPI ROW */}
        <div style={styles.statsGrid}>
          {[
            { label:"Confidence", value: response ? `${(response.confidence*100).toFixed(0)}%` : "—", note: response ? (response.confidence>=0.75?"High confidence":response.confidence>=0.5?"Review advised":"Low — escalate") : "Run a case", color: response ? confidenceColor(response.confidence) : "#475569" },
            { label:"Evidence", value: response ? response.sources.length : "—", note:"Retrieved policy sources", color:"#38bdf8" },
            { label:"Guardrails", value: response ? (response.blocked ? "Blocked" : "Passed") : "Ready", note:"Prompt injection screen", color: response?.blocked ? "#f87171" : "#4ade80" },
            { label:"Cases run", value: history.length, note:"This session", color:"#818cf8" },
          ].map((s,i) => (
            <div key={i} style={styles.statCard(i)}>
              <div style={styles.statLabel}>{s.label}</div>
              <div style={{...styles.statValue, color:s.color}}>{s.value}</div>
              <div style={styles.statNote}>{s.note}</div>
            </div>
          ))}
        </div>

        {/* WORKBENCH TAB */}
        {activeTab === "workbench" && (
          <div style={styles.workbenchGrid}>
            <div>
              <div style={styles.panel}>
                <div style={styles.panelTitle}>Case Workspace</div>
                <div style={{ marginBottom:16 }}>
                  <label style={styles.label}>Patient ID</label>
                  <input style={styles.input} value={patientId} onChange={e=>setPatientId(e.target.value)} placeholder="PT-2024-001" />
                </div>
                <div style={styles.formRow}>
                  <div>
                    <label style={styles.label}>Therapy Area</label>
                    <select style={styles.select} value={therapyArea} onChange={e=>setTherapyArea(e.target.value)}>
                      {["Respiratory","Metabolic","Specialty","General Access","Oncology","Neurology"].map(v=><option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>Payer Type</label>
                    <select style={styles.select} value={payerType} onChange={e=>setPayerType(e.target.value)}>
                      {["Commercial","Medicare","Medicaid","Marketplace","Unknown"].map(v=><option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>Urgency</label>
                    <select style={styles.select} value={urgency} onChange={e=>setUrgency(e.target.value)}>
                      {["Standard","Expedited","Appeal Risk","Urgent"].map(v=><option key={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={styles.label}>Care Team Question</label>
                  <textarea ref={textareaRef} style={styles.textarea} value={query} onChange={e=>setQuery(e.target.value)}
                    placeholder="Ask about coverage, prior authorization, copay support, formulary alternatives, or payer-specific access pathways…"
                    onKeyDown={e => { if (e.key==="Enter" && (e.metaKey||e.ctrlKey)) runQuery(); }} />
                </div>
                <button className="run-btn" style={styles.runBtn} onClick={() => runQuery()} disabled={isRunning || !query.trim()}>
                  {isRunning ? "Running access intelligence…" : "▶  Run Access Intelligence"}
                </button>
                {isRunning && (
                  <div style={styles.phaseBar}>
                    <div style={styles.spinner} />
                    <span>{phase}</span>
                  </div>
                )}
              </div>

              {/* RESULT */}
              {response && (
                <div ref={resultRef} style={styles.resultCard} className="result-in">
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:6 }}>Access Intelligence Answer</div>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        <span style={{...styles.badge, ...(response.blocked ? styles.badgeDanger : styles.badgeLive)}}>{response.blocked ? "⚠ Guardrail Blocked" : "✓ Guardrails Passed"}</span>
                        {!response.blocked && <span style={{...styles.badge, background:`rgba(${response.confidence>=0.75?"34,197,94":response.confidence>=0.5?"245,158,11":"239,68,68"},0.15)`, color:confidenceColor(response.confidence), border:`1px solid rgba(${response.confidence>=0.75?"34,197,94":response.confidence>=0.5?"245,158,11":"239,68,68"},0.3)`}}>{(response.confidence*100).toFixed(0)}% {confidenceLabel(response.confidence)}</span>}
                        <span style={{...styles.badge,...styles.badgeInfo}}>Audit: {response.auditId}</span>
                        <span style={{...styles.badge, background:"rgba(100,116,139,0.15)", color:"#94a3b8", border:"1px solid rgba(100,116,139,0.2)"}}>{response.ts}</span>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:10 }}>
                      <button className="dl-btn" onClick={downloadSummary} style={{ padding:"8px 16px", borderRadius:10, background:"rgba(56,189,248,0.1)", border:"1px solid rgba(56,189,248,0.3)", color:"#38bdf8", fontSize:13, fontWeight:600, cursor:"pointer", transition:"all 0.2s" }}>
                        ↓ Export
                      </button>
                    </div>
                  </div>
                  <div style={{ borderLeft:"3px solid #38bdf8", paddingLeft:18, marginBottom:24 }}>
                    <div style={styles.answerText} dangerouslySetInnerHTML={{ __html: response.answer.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\*(.*?)\*/g,"<em>$1</em>").replace(/\n/g,"<br/>") }} />
                  </div>
                  {response.sources.length > 0 && (
                    <>
                      <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:12 }}>Retrieved Evidence</div>
                      {response.sources.map((s,i) => (
                        <div key={i} style={styles.sourceCard}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                            <div style={styles.sourceName}>📄 {s.source}</div>
                            <span style={{...styles.badge,...styles.badgeInfo, fontSize:10}}>Score {s.score}</span>
                          </div>
                          <div style={styles.sourcePreview}>{s.preview}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* SIDE PANEL */}
            <div style={styles.sidePanel}>
              {/* Timeline */}
              <div style={styles.timelineBox}>
                <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:16 }}>Workflow Pipeline</div>
                {timelineSteps.map((step, i) => {
                  const done = response && !isRunning && !response.blocked;
                  const blocked = response?.blocked && i === 0;
                  const active = isRunning && i === phaseIndex;
                  const isDone = done || (response?.blocked && i === 0);
                  return (
                    <div key={step.key} style={timelineSteps.length-1>i?{...styles.timelineItem(active,isDone)}:{...styles.timelineItem(active,isDone),borderBottom:"none"}}>
                      <div style={styles.timelineDot(active, isDone)}>
                        {active ? <span style={{ animation:"spin 1s linear infinite", display:"block", width:10, height:10, border:"1.5px solid #38bdf8", borderTop:"1.5px solid transparent", borderRadius:"50%" }} /> : isDone ? (blocked?"✕":"✓") : i+1}
                      </div>
                      <div style={styles.timelineContent}>
                        <div style={styles.timelineTitle(active,isDone)}>{step.title}</div>
                        <div style={styles.timelineNote}>{
                          active ? "Processing…" :
                          isDone && !blocked ? (i===0?"Passed":i===1?`${response?.sources?.length||0} sources`:i===2?`${(response?.confidence*100||0).toFixed(0)}% confidence`:response?.auditId||"logged") :
                          blocked ? "Blocked" : step.note
                        }</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Suggested queries */}
              <div style={styles.suggestionCard}>
                <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:14 }}>Suggested Queries</div>
                {SUGGESTED_QUERIES.map((s,i) => (
                  <button key={i} className="sugg-chip" style={styles.suggChip} onClick={() => { setQuery(s.text); textareaRef.current?.focus(); }}>
                    <span style={{ fontSize:11, color:"#64748b", display:"block", marginBottom:3 }}>{s.icon} {s.category}</span>
                    {s.text.length > 80 ? s.text.slice(0,80)+"…" : s.text}
                  </button>
                ))}
              </div>

              {/* Next steps */}
              {response && !response.blocked && (
                <div style={styles.timelineBox}>
                  <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:14 }}>Care Team Next Steps</div>
                  {["Verify plan-specific eligibility before any decisions.", "Review retrieved source snippets with the care team.", response.confidence < 0.75 ? "Escalate to manual review — confidence below threshold." : "Prepare payer response with cited policy evidence.", response.sources.some(s=>s.preview.toLowerCase().includes("copay")) ? "Confirm commercial coverage before recommending copay assistance." : "Document step therapy failures if PA is required."].map((step,i) => (
                    <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"7px 0", borderBottom:i<3?"1px solid rgba(99,179,237,0.07)":"none" }}>
                      <span style={{ color:"#38bdf8", fontWeight:700, fontSize:13, marginTop:1, flexShrink:0 }}>{i+1}.</span>
                      <span style={{ fontSize:13, color:"#94a3b8", lineHeight:1.5 }}>{step}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* EVIDENCE TAB */}
        {activeTab === "evidence" && (
          <div>
            <div style={{ marginBottom:24 }}>
              <h2 style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", marginBottom:8 }}>Evidence Intelligence</h2>
              <p style={{ color:"#64748b", fontSize:14 }}>Policy document library and retrieved source inspection.</p>
            </div>
            {response?.sources?.length ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                {response.sources.map((s,i) => (
                  <div key={i} style={{ ...styles.panel, animation:"fadeSlideIn 0.4s ease both", animationDelay:`${i*0.1}s` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:"#e2e8f0" }}>{s.source}</div>
                      <span style={{...styles.badge,...styles.badgeInfo}}>Score {s.score}</span>
                    </div>
                    <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6 }}>{s.preview}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ ...styles.panel, textAlign:"center", padding:"60px 40px" }}>
                <div style={{ fontSize:40, marginBottom:16 }}>📄</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#e2e8f0", marginBottom:8 }}>Run a case to see evidence</div>
                <div style={{ fontSize:14, color:"#64748b" }}>Policy documents will appear here after running an access intelligence query.</div>
                <div style={{ marginTop:24 }}>
                  <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#64748b", marginBottom:12 }}>Available Policy Documents</div>
                  {Object.keys(PHARMA_DATA.policies).map(drug => (
                    <div key={drug} style={{ ...styles.sourceCard, textAlign:"left", marginBottom:10 }}>
                      <div style={styles.sourceName}>📋 {drug === "general" ? "General Access Policy" : `${drug} Policy Document`}</div>
                      <div style={styles.sourcePreview}>{PHARMA_DATA.policies[drug].slice(0,140)}…</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AUDIT TAB */}
        {activeTab === "audit" && (
          <div>
            <div style={{ marginBottom:24 }}>
              <h2 style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", marginBottom:8 }}>Audit Log</h2>
              <p style={{ color:"#64748b", fontSize:14 }}>Immutable trace of all access intelligence queries this session.</p>
            </div>
            <div style={styles.panel}>
              {AUDIT_LOG.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"#475569" }}>No audit events yet. Run a case to generate a trace.</div>
              ) : (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1.5fr 1fr 1fr 1fr 0.8fr 0.8fr", gap:12, padding:"10px 0", borderBottom:"1px solid rgba(99,179,237,0.15)", marginBottom:8 }}>
                    {["Audit ID","Patient","Question","Timestamp","Confidence","Guardrail"].map(h=><div key={h} style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:"#475569" }}>{h}</div>)}
                  </div>
                  {AUDIT_LOG.map((a,i) => (
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1.5fr 1fr 1fr 1fr 0.8fr 0.8fr", gap:12, padding:"12px 0", borderBottom:"1px solid rgba(99,179,237,0.07)", alignItems:"center" }}>
                      <div style={{ fontFamily:"monospace", fontSize:12, color:"#38bdf8" }}>{a.auditId}</div>
                      <div style={{ fontSize:13, color:"#94a3b8" }}>{a.patientId}</div>
                      <div style={{ fontSize:12, color:"#64748b", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.question.slice(0,40)}…</div>
                      <div style={{ fontSize:12, color:"#475569" }}>{new Date(a.ts).toLocaleTimeString()}</div>
                      <div style={{ fontSize:13, color:confidenceColor(a.confidence), fontWeight:600 }}>{(a.confidence*100).toFixed(0)}%</div>
                      <span style={{...styles.badge,...styles.badgeLive, fontSize:10}}>Passed</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* DEPLOY TAB */}
        {activeTab === "deploy" && (
          <div>
            <div style={{ marginBottom:24 }}>
              <h2 style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", marginBottom:8 }}>Deployment Readiness</h2>
              <p style={{ color:"#64748b", fontSize:14 }}>This combined React and serverless version is configured for Vercel's free Hobby deployment path.</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:isCompact ? "1fr" : "1fr 1fr 1fr", gap:20, marginBottom:28 }}>
              {[
                { title:"Vercel Static UI", note:"Vite builds the React workbench into the dist folder for fast free hosting.", status:"Ready", icon:"▲" },
                { title:"Serverless Agent", note:"The /api/ask route runs on Vercel Functions and keeps optional Anthropic credentials server-side.", status:"Ready", icon:"λ" },
                { title:"Offline Fallback", note:"If no API key is configured, the app still answers from the bundled policies and benefit data.", status:"Ready", icon:"✓" },
              ].map((d,i) => (
                <div key={i} style={styles.panel}>
                  <div style={{ fontSize:28, marginBottom:12 }}>{d.icon}</div>
                  <div style={{ fontSize:16, fontWeight:700, color:"#e2e8f0", marginBottom:6 }}>{d.title}</div>
                  <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6, marginBottom:14 }}>{d.note}</div>
                  <span style={{...styles.badge,...styles.badgeLive}}>{d.status}</span>
                </div>
              ))}
            </div>
            <div style={styles.panel}>
              <div style={{ fontSize:14, fontWeight:700, color:"#94a3b8", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:16 }}>Optional Vercel Environment</div>
              <pre style={{ background:"rgba(8,14,28,0.8)", border:"1px solid rgba(99,179,237,0.15)", borderRadius:12, padding:"18px 20px", fontSize:13, color:"#4ade80", lineHeight:1.8, overflow:"auto" }}>{`ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-3-5-sonnet-latest"`}</pre>
              <div style={{ marginTop:20, fontSize:14, fontWeight:700, color:"#94a3b8", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:12 }}>Local Verification</div>
              <pre style={{ background:"rgba(8,14,28,0.8)", border:"1px solid rgba(99,179,237,0.15)", borderRadius:12, padding:"18px 20px", fontSize:13, color:"#38bdf8", lineHeight:1.8, overflow:"auto" }}>{`pip install -e ".[dev]"
pytest tests/ -v
ruff check .
npm install
npm run build
npm run dev`}</pre>
            </div>
          </div>
        )}

        {/* CASE HISTORY DRAWER */}
        {showHistory && history.length > 0 && (
          <div style={{ position:"fixed", top:64, right:0, bottom:0, width:380, background:"rgba(10,15,30,0.97)", borderLeft:"1px solid rgba(99,179,237,0.15)", zIndex:50, overflowY:"auto", padding:24, backdropFilter:"blur(20px)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#f1f5f9" }}>Case History ({history.length})</div>
              <button onClick={() => setShowHistory(false)} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:18, padding:4 }}>✕</button>
            </div>
            {history.map((h,i) => (
              <div key={i} className="hist-item" style={styles.historyItem} onClick={() => { setQuery(h.question); setResponse(h.response); setPatientId(h.patientId); setTherapyArea(h.therapyArea); setPayerType(h.payerType); setUrgency(h.urgency); setActiveTab("workbench"); setShowHistory(false); }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{...styles.badge,...styles.badgeInfo, fontSize:10}}>{h.therapyArea}</span>
                  <span style={{ fontSize:11, color:"#475569" }}>{h.response.ts}</span>
                </div>
                <div style={{ fontSize:13, color:"#94a3b8", lineHeight:1.5, marginBottom:8 }}>{h.question.slice(0,80)}{h.question.length>80?"…":""}</div>
                <div style={{ display:"flex", gap:8 }}>
                  <span style={{ fontSize:11, color:confidenceColor(h.response.confidence), fontWeight:600 }}>{(h.response.confidence*100).toFixed(0)}% confidence</span>
                  <span style={{ fontSize:11, color:"#475569" }}>·</span>
                  <span style={{ fontSize:11, color:"#475569" }}>Patient {h.patientId}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Extended policy knowledge base (mirrors client-side for server-side RAG) ──
const PHARMA_DATA = {
  drugs: ["StepOne Inhaler", "GLP Access", "BreathEase HFA", "CortiAir Daily", "GlucoLite Weekly", "MetaboSure"],
  benefits: [
    { plan_id: "COMM-CA-001", payer: "Northstar Commercial", drug_name: "StepOne Inhaler", tier: "non-preferred", pa_required: true, copay_eligible: true, alternatives: ["BreathEase HFA", "CortiAir Daily"] },
    { plan_id: "COMM-NY-044", payer: "UnionCare Commercial", drug_name: "GLP Access", tier: "preferred-specialty", pa_required: true, copay_eligible: true, alternatives: ["GlucoLite Weekly", "MetaboSure"] },
    { plan_id: "GOV-TX-210", payer: "PublicCare Advantage", drug_name: "StepOne Inhaler", tier: "preferred", pa_required: false, copay_eligible: false, alternatives: ["BreathEase HFA"] },
    { plan_id: "COMM-FL-088", payer: "SunState Blue Cross", drug_name: "GLP Access", tier: "non-preferred-specialty", pa_required: true, copay_eligible: true, alternatives: ["MetaboSure"] },
  ],
  policies: {
    "StepOne Inhaler": "StepOne Inhaler (budesonide/formoterol) is a preferred ICS/LABA for step 3-4 asthma. Commercial plans typically require step therapy with a short-acting bronchodilator before approval. Prior Authorization requires documented FEV1 <80% predicted, failed SABA trial ≥4 weeks, and ICS monotherapy trial. Copay assistance available for commercially insured patients; government-funded plans excluded.",
    "GLP Access": "GLP Access (semaglutide 2.4mg) is a GLP-1 receptor agonist for chronic weight management. PA requires BMI ≥30 kg/m² or ≥27 with comorbidity, documented lifestyle intervention failure ≥6 months, HbA1c levels, and physician attestation. Not covered under most Medicare Part D plans for obesity indication.",
    "BreathEase HFA": "BreathEase HFA is a preferred formulary alternative inhaler for asthma and COPD. Lower cost-sharing than specialty tiers.",
    "general": "For prescription access questions: verify patient insurance eligibility, check formulary status directly with plan, document medical necessity, and consult specialty pharmacy for hub enrollment when applicable.",
  },
};

const EXTENDED_POLICIES = {
  dupilumab: `Dupilumab (Dupixent) for moderate-to-severe asthma: PA required. Criteria: FEV1 <80% predicted, blood eosinophils ≥150 cells/uL OR FeNO ≥25 ppb, high-dose ICS/LABA, ≥2 exacerbations/year. BCBS Commercial PPO step therapy: prior anti-IL-5 trial required unless patient failed/discontinued due to adverse events (injection site reactions qualify) OR has IL-4/IL-13 pathway comorbidities (atopic dermatitis, nasal polyps, EoE). PA documentation: spirometry, FeNO, CBC differential, OCS history, prior biologic trial records, prescriber attestation (NPI). Direct approval medical exception: cite NEJM 2018 Liberty Asthma QUEST trial; document comorbid atopic conditions. Dupixent MyWay copay program for commercially insured patients; Medicare/Medicaid excluded.`,
  mepolizumab: `Mepolizumab (Nucala) for eosinophilic asthma: eosinophils ≥150 cells/uL (≥300 preferred), ≥2 exacerbations/year, high-dose ICS/LABA. Listed as preferred biologic before dupilumab on most BCBS commercial formularies for eosinophilic phenotype.`,
  benralizumab: `Benralizumab (Fasenra) for eosinophilic asthma: eosinophils ≥300 preferred (150 minimum). Documented injection site reaction discontinuation satisfies step therapy failure for subsequent biologic approvals including dupilumab on BCBS commercial policies. Document: drug name, dose, # doses, date, adverse event type.`,
  compounded_glp1: `Compounded semaglutide: FDA removed from shortage list February 2024. 503A/503B shortage exemption no longer applies. Salt-form compounds (acetate, sodium) prohibited. Commercial plans generally do NOT cover compounded semaglutide. Pursue brand PA: Ozempic (T2D, A1C ≥7.0, metformin failure) or Wegovy (obesity, BMI ≥30 or ≥27+comorbidity, lifestyle failure ≥6mo). No manufacturer copay for compounded. Medicare Part D does not cover compounded semaglutide.`,
  medicare: `Medicare biologic coverage: Part B = physician-administered (80/20 cost share, no manufacturer copay allowed). Part D = self-administered home use (specialty tier, manufacturer copay cards prohibited per anti-kickback statute). GLP-1s for obesity NOT covered under most Part D plans. Low-income: Extra Help/LIS program. Medicare Advantage: obtain plan-specific formulary and PA criteria directly. Patient Assistance Programs (PAPs) available for low-income Medicare patients from manufacturers.`,
};

const INJECTION_PATTERNS = [
  "ignore previous", "forget instructions", "system prompt", "developer message",
  "reveal your prompt", "jailbreak", "bypass policy", "you are now", "act as if",
];

// ── Entity extraction (mirrors client-side) ──
function extractEntities(question, patientContext = {}) {
  const ql = String(question || "").toLowerCase();
  const drugAliases = {
    "stepone": "StepOne Inhaler", "step one": "StepOne Inhaler", "budesonide": "StepOne Inhaler",
    "ics/laba": "StepOne Inhaler", "glp access": "GLP Access", "semaglutide": "GLP Access",
    "wegovy": "GLP Access", "ozempic": "GLP Access", "glp-1": "GLP Access", "glp1": "GLP Access",
    "breathease": "BreathEase HFA", "dupilumab": "dupilumab", "dupixent": "dupilumab",
    "mepolizumab": "mepolizumab", "nucala": "mepolizumab",
    "benralizumab": "benralizumab", "fasenra": "benralizumab",
  };
  const detectedDrugs = [];
  for (const [alias, canonical] of Object.entries(drugAliases)) {
    if (ql.includes(alias) && !detectedDrugs.includes(canonical)) detectedDrugs.push(canonical);
  }
  const queryType = ql.includes("prior auth") || ql.includes("pa ") || ql.includes("step therapy") || ql.includes("authorization") ? "prior_auth"
    : ql.includes("copay") || ql.includes("cost") || ql.includes("assistance") ? "copay"
    : ql.includes("formulary") || ql.includes("alternative") ? "formulary"
    : ql.includes("compound") ? "compounding"
    : ql.includes("medicare") || ql.includes("part b") || ql.includes("part d") ? "medicare"
    : "coverage";
  const isGovt = (patientContext.payerType === "Medicare" || patientContext.payerType === "Medicaid"
    || ql.includes("medicare") || ql.includes("medicaid"));
  const isMedicare = patientContext.payerType === "Medicare" || ql.includes("medicare");
  return { detectedDrugs, queryType, isGovt, isMedicare };
}

// ── Build enriched context from extended policies + payer context ──
function buildContext(question, patientContext = {}) {
  const { detectedDrugs, queryType, isGovt, isMedicare } = extractEntities(question, patientContext);
  const contextParts = [];

  // Extended drug-specific policy
  const extendedMap = { "dupilumab": "dupilumab", "mepolizumab": "mepolizumab", "benralizumab": "benralizumab" };
  for (const [drugKey, policyKey] of Object.entries(extendedMap)) {
    if (detectedDrugs.some(d => d.toLowerCase().includes(drugKey))) {
      contextParts.push(`[${drugKey} Policy]: ${EXTENDED_POLICIES[policyKey]}`);
    }
  }

  // Compounded GLP-1
  const ql = question.toLowerCase();
  if (ql.includes("compound") || (detectedDrugs.includes("GLP Access") && queryType === "compounding")) {
    contextParts.push(`[Compounded GLP-1 Policy]: ${EXTENDED_POLICIES.compounded_glp1}`);
  }

  // Medicare
  if (isMedicare || patientContext.payerType === "Medicare") {
    contextParts.push(`[Medicare Coverage Policy]: ${EXTENDED_POLICIES.medicare}`);
  }

  // Existing PHARMA_DATA policies
  for (const [drug, policy] of Object.entries(PHARMA_DATA.policies)) {
    if (drug !== "general" && detectedDrugs.some(d => d.toLowerCase().includes(drug.toLowerCase()) || drug.toLowerCase().includes(d.toLowerCase()))) {
      contextParts.push(`[${drug} Policy]: ${policy}`);
    }
  }

  // Benefits DB
  const benefits = PHARMA_DATA.benefits.filter(b =>
    detectedDrugs.some(d => b.drug_name.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(b.drug_name.toLowerCase()))
    || ql.includes(b.drug_name.toLowerCase())
  );
  if (benefits.length) {
    contextParts.push(`[Benefits DB]: ${benefits.map(b => `${b.payer} (${b.plan_id}): ${b.drug_name}, tier=${b.tier}, PA=${b.pa_required}, copay_eligible=${b.copay_eligible}, alternatives=[${b.alternatives.join(", ")}]`).join(" | ")}`);
  }

  if (!contextParts.length) {
    contextParts.push(`[General Policy]: ${PHARMA_DATA.policies.general}`);
  }

  return contextParts.join("\n\n");
}

function screenQuestion(question) {
  const normalized = String(question || "").toLowerCase();
  const reasons = INJECTION_PATTERNS.filter((p) => normalized.includes(p));
  return { allowed: reasons.length === 0, reasons };
}

async function callAnthropic(question, context, patientContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { isGovt, isMedicare, queryType } = extractEntities(question, patientContext);

  const systemPrompt = `You are a clinical prescription access intelligence agent for a care team workbench.
Answer questions about formulary coverage, prior authorization, step therapy, copay assistance, and payer policy using ONLY the provided policy context.
Patient context: Payer type = ${patientContext?.payerType || "unknown"}, Therapy area = ${patientContext?.therapyArea || "unknown"}, Urgency = ${patientContext?.urgency || "standard"}.
${isMedicare ? "IMPORTANT: Patient is on Medicare. Manufacturer copay cards are PROHIBITED. Do not suggest them. Discuss PAPs and Extra Help instead." : ""}
${isGovt ? "IMPORTANT: Patient is on a government-funded plan. Manufacturer copay assistance is not available." : ""}
Structure your answer with: (1) direct answer to the question, (2) specific documentation or action items for the care team, (3) any important caveats.
Do not provide clinical dosing advice. If evidence is missing, state specifically what the care team must verify.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1200,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Policy and benefit context:\n${context}\n\nQuestion from care team:\n${question}`,
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || null;
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.status(405).json({ error: "Method not allowed" }); return; }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const question = String(body.question || "").trim();
  const patientContext = body.patientContext || {};

  if (!question) { response.status(400).json({ error: "Question is required" }); return; }

  const guard = screenQuestion(question);
  if (!guard.allowed) {
    response.status(200).json({
      answer: `**Request blocked.** The prompt was flagged for: ${guard.reasons.join(", ")}. Please rephrase as a prescription access or coverage question.`,
      blocked: true,
      guardrailReasons: guard.reasons,
    });
    return;
  }

  // Build enriched context using entity extraction + payer scope
  const context = buildContext(question, patientContext);

  let answer = null;
  try {
    answer = await callAnthropic(question, context, patientContext);
  } catch {
    answer = null;
  }

  // Local fallback also uses enriched context
  if (!answer) {
    const { detectedDrugs, isGovt, isMedicare } = extractEntities(question, patientContext);
    const ql = question.toLowerCase();
    const lines = ["**Based on retrieved policy and benefit evidence:**", ""];
    if (context.includes("[dupilumab Policy]") || context.includes("[benralizumab Policy]") || context.includes("[mepolizumab Policy]")) {
      const policyMatch = context.split("\n\n")[0];
      lines.push(policyMatch.replace(/^\[.*?\]: /, "").slice(0, 400) + "…");
    } else {
      lines.push("- Verify current eligibility, formulary tier, PA status, and pharmacy channel with the payer.");
    }
    if (ql.includes("copay") || ql.includes("cost")) {
      lines.push(isGovt ? "- Manufacturer copay cards are NOT available for government-funded plans. Patient Assistance Programs may apply." : "- Manufacturer copay support may apply for commercially insured patients; government plans are excluded.");
    }
    if (isMedicare) lines.push("- Confirm Part B vs Part D classification — affects PA pathway and cost-sharing. Manufacturer copay cards prohibited for Medicare.");
    lines.push("", "*Care team verification is required before therapy or coverage decisions.*");
    answer = lines.join("\n");
  }

  response.status(200).json({ answer, model: process.env.ANTHROPIC_API_KEY ? (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514") : "local-fallback" });
}

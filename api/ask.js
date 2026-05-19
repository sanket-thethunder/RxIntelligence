const PHARMA_DATA = {
  drugs: ["StepOne Inhaler", "GLP Access", "BreathEase HFA", "CortiAir Daily", "GlucoLite Weekly", "MetaboSure"],
  benefits: [
    {
      plan_id: "COMM-CA-001",
      payer: "Northstar Commercial",
      drug_name: "StepOne Inhaler",
      tier: "non-preferred",
      pa_required: true,
      copay_eligible: true,
      alternatives: ["BreathEase HFA", "CortiAir Daily"]
    },
    {
      plan_id: "COMM-NY-044",
      payer: "UnionCare Commercial",
      drug_name: "GLP Access",
      tier: "preferred-specialty",
      pa_required: true,
      copay_eligible: true,
      alternatives: ["GlucoLite Weekly", "MetaboSure"]
    },
    {
      plan_id: "GOV-TX-210",
      payer: "PublicCare Advantage",
      drug_name: "StepOne Inhaler",
      tier: "preferred",
      pa_required: false,
      copay_eligible: false,
      alternatives: ["BreathEase HFA"]
    },
    {
      plan_id: "COMM-FL-088",
      payer: "SunState Blue Cross",
      drug_name: "GLP Access",
      tier: "non-preferred-specialty",
      pa_required: true,
      copay_eligible: true,
      alternatives: ["MetaboSure"]
    }
  ]
};

const INJECTION_PATTERNS = [
  "ignore previous",
  "forget instructions",
  "system prompt",
  "developer message",
  "reveal your prompt",
  "jailbreak",
  "bypass policy",
  "you are now",
  "act as if"
];

function screenQuestion(question) {
  const normalized = String(question || "").toLowerCase();
  const reasons = INJECTION_PATTERNS.filter((pattern) => normalized.includes(pattern));
  return { allowed: reasons.length === 0, reasons };
}

function localAnswer(question, patientContext = {}) {
  const ql = String(question || "").toLowerCase();
  const matchedDrug = PHARMA_DATA.drugs.find((drug) => ql.includes(drug.toLowerCase()));
  const matchedBenefits = matchedDrug
    ? PHARMA_DATA.benefits.filter((benefit) => benefit.drug_name === matchedDrug)
    : [];

  const lines = ["**Based on retrieved policy and benefit evidence:**", ""];
  if (matchedDrug) {
    lines.push(`**${matchedDrug} - access summary:**`);
  } else {
    lines.push("**General access summary:**");
  }

  if (matchedBenefits.length) {
    for (const benefit of matchedBenefits) {
      lines.push(
        `- **${benefit.payer}** (${benefit.plan_id}) lists ${benefit.drug_name} as ${benefit.tier}; PA required: **${benefit.pa_required ? "Yes" : "No"}**; copay eligible: **${benefit.copay_eligible ? "Yes, commercial only" : "No"}**.`
      );
      if (benefit.alternatives.length) {
        lines.push(`  - Formulary alternatives: ${benefit.alternatives.join(", ")}.`);
      }
    }
  } else {
    lines.push("- Verify current eligibility, formulary tier, PA status, and pharmacy channel with the payer.");
  }

  if (ql.includes("copay") || ql.includes("cost") || patientContext.payerType === "Commercial") {
    lines.push("- Manufacturer copay support may apply for commercially insured patients; government plans are excluded.");
  }
  if (ql.includes("prior auth") || ql.includes("pa ") || ql.includes("authorization")) {
    lines.push("- PA packets should include diagnosis support, step therapy history, chart notes, and prescriber attestation.");
  }
  if (ql.includes("alternative") || ql.includes("formulary")) {
    lines.push("- Review preferred formulary alternatives before appeal or exception escalation.");
  }
  lines.push("", "*Care team verification is required before therapy or coverage decisions.*");
  return lines.join("\n");
}

async function callAnthropic(question, context, patientContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 900,
      temperature: 0.1,
      system:
        "You answer prescription access, formulary, prior authorization, coverage, and copay questions using only the provided context. If evidence is missing, state what the care team must verify. Do not provide clinical dosing advice.",
      messages: [
        {
          role: "user",
          content: `Patient context: ${JSON.stringify(patientContext || {})}\n\nPolicy and benefit context:\n${context || "No extra context supplied."}\n\nQuestion:\n${question}`
        }
      ]
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.content?.map((block) => (block.type === "text" ? block.text : "")).join("") || null;
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const question = String(body.question || "").trim();
  const guard = screenQuestion(question);

  if (!question) {
    response.status(400).json({ error: "Question is required" });
    return;
  }
  if (!guard.allowed) {
    response.status(200).json({
      answer: `**Request blocked.** The prompt was flagged for: ${guard.reasons.join(", ")}. Please rephrase as a prescription access or coverage question.`,
      blocked: true,
      guardrailReasons: guard.reasons
    });
    return;
  }

  let answer = null;
  try {
    answer = await callAnthropic(question, body.context, body.patientContext);
  } catch {
    answer = null;
  }

  response.status(200).json({
    answer: answer || localAnswer(question, body.patientContext),
    model: answer ? process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest" : "local-fallback"
  });
}

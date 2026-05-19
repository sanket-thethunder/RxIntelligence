from __future__ import annotations

import html
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from prescription_agent.agent import AgentResponse, PrescriptionAccessAgent
from prescription_agent.config import get_settings
from prescription_agent.etl.pharmacy_benefits import sync_benefits_from_file

st.set_page_config(
    page_title="Prescription Intelligence Command Center",
    page_icon="Rx",
    layout="wide",
    initial_sidebar_state="expanded",
)


@dataclass(frozen=True)
class Theme:
    name: str
    background: str
    panel: str
    panel_soft: str
    text: str
    muted: str
    border: str
    accent: str
    accent_2: str
    success: str
    warning: str
    danger: str
    shadow: str


THEMES = {
    "Platinum": Theme(
        name="Platinum",
        background="#f5f7fb",
        panel="rgba(255,255,255,0.86)",
        panel_soft="#eef4ff",
        text="#101828",
        muted="#667085",
        border="rgba(16,24,40,0.12)",
        accent="#2463eb",
        accent_2="#00a7a7",
        success="#079455",
        warning="#dc6803",
        danger="#d92d20",
        shadow="0 22px 60px rgba(16,24,40,0.10)",
    ),
    "Midnight": Theme(
        name="Midnight",
        background="#070b14",
        panel="rgba(16,24,40,0.78)",
        panel_soft="#111827",
        text="#f8fafc",
        muted="#a3b2c7",
        border="rgba(226,232,240,0.16)",
        accent="#6ea8ff",
        accent_2="#2dd4bf",
        success="#34d399",
        warning="#f59e0b",
        danger="#fb7185",
        shadow="0 26px 70px rgba(0,0,0,0.45)",
    ),
}

PROMPT_GROUPS = {
    "Coverage and cost": [
        "Is StepOne Inhaler covered and are there copay options for a commercially "
        "insured patient?",
        "Can a patient on a high deductible plan use manufacturer support for "
        "StepOne Inhaler?",
    ],
    "Prior authorization": [
        "What prior authorization evidence is needed for GLP Access?",
        "Summarize what the care team should verify before escalating a denied "
        "specialty prescription.",
    ],
    "Formulary strategy": [
        "What alternatives should a care team review for a non-preferred inhaler?",
        "Which plan details matter when selecting a covered alternative therapy?",
    ],
}

DEFAULT_QUESTION = PROMPT_GROUPS["Coverage and cost"][0]


@st.cache_resource
def get_agent() -> PrescriptionAccessAgent:
    settings = get_settings()
    sync_benefits_from_file(settings.benefits_path, settings.database_url)
    return PrescriptionAccessAgent(settings=settings)


def css(theme: Theme) -> str:
    return f"""
<style>
    :root {{
        --app-bg: {theme.background};
        --panel: {theme.panel};
        --panel-soft: {theme.panel_soft};
        --text: {theme.text};
        --muted: {theme.muted};
        --border: {theme.border};
        --accent: {theme.accent};
        --accent-2: {theme.accent_2};
        --success: {theme.success};
        --warning: {theme.warning};
        --danger: {theme.danger};
        --shadow: {theme.shadow};
    }}

    .stApp {{
        background:
            radial-gradient(
                circle at 12% 8%,
                color-mix(in srgb, var(--accent) 18%, transparent),
                transparent 34%
            ),
            radial-gradient(
                circle at 86% 12%,
                color-mix(in srgb, var(--accent-2) 15%, transparent),
                transparent 28%
            ),
            var(--app-bg);
        color: var(--text);
    }}

    [data-testid="stSidebar"] {{
        background: color-mix(in srgb, var(--panel) 88%, var(--app-bg));
        border-right: 1px solid var(--border);
    }}

    [data-testid="stSidebar"] * {{
        color: var(--text);
    }}

    .block-container {{
        padding-top: 1.2rem;
        padding-bottom: 2.5rem;
        max-width: 1500px;
    }}

    h1, h2, h3, h4, p, label, span {{
        letter-spacing: 0;
    }}

    .hero {{
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 28px 30px;
        margin-bottom: 18px;
        background:
            linear-gradient(135deg, color-mix(in srgb, var(--panel) 92%, white), var(--panel)),
            linear-gradient(
                135deg,
                color-mix(in srgb, var(--accent) 18%, transparent),
                transparent
            );
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
    }}

    .eyebrow {{
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 760;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 10px;
    }}

    .hero h1 {{
        color: var(--text);
        font-size: clamp(2.1rem, 4.2vw, 4.7rem);
        line-height: 0.96;
        margin: 0 0 16px 0;
        letter-spacing: 0;
    }}

    .hero p {{
        color: var(--muted);
        font-size: 1.05rem;
        line-height: 1.6;
        max-width: 900px;
        margin: 0;
    }}

    .panel {{
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 20px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
        min-height: 100%;
    }}

    .panel.tight {{
        padding: 16px;
    }}

    .panel-title {{
        color: var(--text);
        font-size: 1rem;
        font-weight: 760;
        margin: 0 0 8px 0;
    }}

    .panel-copy {{
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.55;
        margin: 0;
    }}

    .metric-card {{
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 17px 18px;
        background: color-mix(in srgb, var(--panel) 90%, var(--panel-soft));
        min-height: 118px;
    }}

    .metric-label {{
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
    }}

    .metric-value {{
        color: var(--text);
        font-size: 1.72rem;
        font-weight: 800;
        margin-top: 7px;
        line-height: 1.05;
    }}

    .metric-note {{
        color: var(--muted);
        font-size: 0.84rem;
        margin-top: 8px;
    }}

    .badge-row {{
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0 2px 0;
    }}

    .badge {{
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 6px 10px;
        background: color-mix(in srgb, var(--panel) 72%, var(--panel-soft));
        color: var(--text);
        font-size: 0.78rem;
        font-weight: 720;
        white-space: nowrap;
    }}

    .badge.success {{ color: var(--success); }}
    .badge.warning {{ color: var(--warning); }}
    .badge.danger {{ color: var(--danger); }}
    .badge.accent {{ color: var(--accent); }}

    .answer-box {{
        border-left: 4px solid var(--accent);
        padding: 16px 18px;
        background: color-mix(in srgb, var(--panel-soft) 72%, transparent);
        border-radius: 8px;
    }}

    .timeline {{
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
    }}

    .timeline-step {{
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 12px;
        background: color-mix(in srgb, var(--panel) 80%, var(--panel-soft));
    }}

    .timeline-step strong {{
        display: block;
        color: var(--text);
        font-size: 0.88rem;
    }}

    .timeline-step span {{
        color: var(--muted);
        font-size: 0.78rem;
    }}

    .source-card {{
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 10px;
        background: var(--panel);
    }}

    .source-title {{
        color: var(--text);
        font-weight: 760;
        margin-bottom: 6px;
    }}

    .source-preview {{
        color: var(--muted);
        line-height: 1.5;
        font-size: 0.9rem;
    }}

    .empty {{
        border: 1px dashed var(--border);
        border-radius: 8px;
        padding: 26px;
        text-align: center;
        background: color-mix(in srgb, var(--panel) 68%, transparent);
    }}

    .empty strong {{
        display: block;
        color: var(--text);
        font-size: 1.05rem;
        margin-bottom: 6px;
    }}

    .empty span {{
        color: var(--muted);
        font-size: 0.9rem;
    }}

    div[data-testid="stButton"] > button,
    div[data-testid="stDownloadButton"] > button {{
        border-radius: 8px;
        border: 1px solid var(--border);
        min-height: 42px;
        font-weight: 720;
    }}

    div[data-testid="stButton"] > button[kind="primary"] {{
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
        color: white;
        border: 0;
    }}

    div[data-testid="stTextArea"] textarea,
    div[data-testid="stTextInput"] input,
    div[data-testid="stSelectbox"] div[data-baseweb="select"] {{
        border-radius: 8px;
    }}

    @media (max-width: 900px) {{
        .timeline {{
            grid-template-columns: 1fr;
        }}
        .hero {{
            padding: 22px;
        }}
        .hero h1 {{
            font-size: 2.15rem;
        }}
    }}
</style>
"""


def e(value: Any) -> str:
    return html.escape(str(value), quote=True)


def metric_card(label: str, value: str, note: str) -> None:
    st.markdown(
        (
            '<div class="metric-card">'
            f'<div class="metric-label">{e(label)}</div>'
            f'<div class="metric-value">{e(value)}</div>'
            f'<div class="metric-note">{e(note)}</div>'
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def badge(label: str, tone: str = "accent") -> str:
    return f'<span class="badge {e(tone)}">{e(label)}</span>'


def badge_row(labels: list[tuple[str, str]]) -> None:
    badges = "".join(badge(label, tone) for label, tone in labels)
    st.markdown(f'<div class="badge-row">{badges}</div>', unsafe_allow_html=True)


def panel(title: str, copy: str | None = None, tight: bool = False) -> None:
    class_name = "panel tight" if tight else "panel"
    copy_markup = f'<p class="panel-copy">{e(copy)}</p>' if copy else ""
    st.markdown(
        (
            f'<div class="{class_name}">'
            f'<div class="panel-title">{e(title)}</div>'
            f"{copy_markup}"
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def render_hero() -> None:
    st.markdown(
        """
        <div class="hero">
            <div class="eyebrow">Prescription access intelligence platform</div>
            <h1>Coverage decisions with evidence, speed, and audit clarity.</h1>
            <p>
                A premium Streamlit command center for prescription access teams:
                benefit ETL, RAG policy retrieval, guardrail screening, confidence
                scoring, and case-ready summaries in one executive workflow.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def confidence_label(confidence: float | None) -> tuple[str, str]:
    if confidence is None:
        return "Not run", "warning"
    if confidence >= 0.72:
        return "High confidence", "success"
    if confidence >= 0.45:
        return "Review advised", "warning"
    return "Low confidence", "danger"


def infer_case_badges(response: AgentResponse | None) -> list[tuple[str, str]]:
    if response is None:
        return [
            ("Ready for intake", "accent"),
            ("Local fallback supported", "success"),
            ("Audit logging enabled", "accent"),
        ]

    answer = response.answer.lower()
    labels: list[tuple[str, str]] = []
    if response.guardrail_reasons:
        labels.append(("Guardrail blocked", "danger"))
    else:
        labels.append(("Guardrails passed", "success"))
    labels.append(confidence_label(response.confidence)[0:2])
    if "pa required: true" in answer or "prior authorization" in answer:
        labels.append(("PA review", "warning"))
    if "copay" in answer:
        labels.append(("Copay path", "success"))
    if "alternatives" in answer or "formulary" in answer:
        labels.append(("Formulary options", "accent"))
    return labels


def next_steps(response: AgentResponse | None) -> list[str]:
    if response is None:
        return [
            "Run a sample case to generate evidence-backed access guidance.",
            "Sync benefit data before demos so payer records are current.",
            "Use the export button after a run to produce a case summary.",
        ]

    if response.guardrail_reasons:
        return [
            "Ask the user to restate the request as a direct coverage question.",
            "Do not route the blocked prompt into downstream care workflows.",
            "Use the audit ID when reviewing guardrail behavior.",
        ]

    steps = [
        "Verify plan-specific eligibility before therapy or coverage decisions.",
        "Review the retrieved source snippets with the care team.",
    ]
    if response.confidence < 0.72:
        steps.append("Escalate to manual review because confidence is below the high threshold.")
    else:
        steps.append("Prepare the payer or patient response with cited policy evidence.")
    if any("copay" in source["preview"].lower() for source in response.sources):
        steps.append("Confirm commercial coverage before recommending copay assistance.")
    return steps


def build_case_summary(
    response: AgentResponse,
    question: str,
    patient_id: str,
    therapy_area: str,
    payer_type: str,
    urgency: str,
) -> str:
    source_lines = "\n".join(
        f"- {source['source']} | score {source['score']}: {source['preview']}"
        for source in response.sources
    )
    guardrails = ", ".join(response.guardrail_reasons) or "Passed"
    steps = "\n".join(f"- {step}" for step in next_steps(response))
    return f"""# Prescription Access Case Summary

Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}

## Case
- Patient ID: {patient_id}
- Therapy area: {therapy_area}
- Payer type: {payer_type}
- Urgency: {urgency}
- Question: {question}

## Intelligence Result
- Confidence: {response.confidence:.0%}
- Guardrails: {guardrails}
- Vector backend: {response.vector_backend}
- Audit ID: {response.audit_id}

## Answer
{response.answer}

## Care-Team Next Steps
{steps}

## Retrieved Evidence
{source_lines}
"""


def render_timeline(response: AgentResponse | None) -> None:
    blocked = bool(response and response.guardrail_reasons)
    audit_id = response.audit_id if response else "Pending"
    confidence = f"{response.confidence:.0%}" if response else "Pending"
    retrieve_note = (
        f"{len(response.sources)} sources retrieved"
        if response and not blocked
        else "Waiting for approved question"
    )
    steps = [
        ("Screen", "Prompt injection and relevance checks complete" if response else "Ready"),
        ("Retrieve", retrieve_note),
        ("Generate", f"Answer confidence {confidence}" if response else "Pending"),
        ("Audit", f"Trace ID {audit_id}" if response else "Pending"),
    ]
    items = "".join(
        (
            '<div class="timeline-step">'
            f"<strong>{e(title)}</strong>"
            f"<span>{e(note)}</span>"
            "</div>"
        )
        for title, note in steps
    )
    st.markdown(f'<div class="timeline">{items}</div>', unsafe_allow_html=True)


def render_empty_state(title: str, copy: str) -> None:
    st.markdown(
        (
            '<div class="empty">'
            f"<strong>{e(title)}</strong>"
            f"<span>{e(copy)}</span>"
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def render_source_card(source: dict[str, Any], index: int) -> None:
    preview = source.get("preview", "")
    score_badge = badge(f"Score {source.get('score', 'n/a')}", "accent")
    chunk_badge = badge(f"Chunk {source.get('chunk_id', 'n/a')}", "warning")
    st.markdown(
        (
            '<div class="source-card">'
            f'<div class="source-title">Evidence {index}: '
            f'{e(source.get("source", "Unknown"))}</div>'
            '<div class="badge-row">'
            f"{score_badge}"
            f"{chunk_badge}"
            "</div>"
            f'<div class="source-preview">{e(preview)}</div>'
            "</div>"
        ),
        unsafe_allow_html=True,
    )


def render_sidebar(agent: PrescriptionAccessAgent) -> tuple[str, str]:
    with st.sidebar:
        st.markdown("### Rx Intelligence")
        st.caption("Executive demo console")
        nav = st.radio(
            "Workspace",
            ["Access Workbench", "Evidence Intelligence", "Deployment Readiness"],
        )
        theme_name = st.selectbox("Theme", list(THEMES.keys()))
        st.divider()
        st.metric("Vector backend", agent.vector_store.backend_name.upper())
        if st.button("Sync benefit data", use_container_width=True):
            settings = get_settings()
            count = sync_benefits_from_file(settings.benefits_path, settings.database_url)
            st.success(f"Synced {count} benefit records.")
        st.divider()
        st.caption("Suggested prompts")
        for group, prompts in PROMPT_GROUPS.items():
            with st.expander(group, expanded=group == "Coverage and cost"):
                for idx, prompt in enumerate(prompts):
                    if st.button(prompt, key=f"{group}-{idx}", use_container_width=True):
                        st.session_state["question"] = prompt
        st.divider()
        st.caption("Streamlit Cloud ready")
        st.write("Main file: `app/streamlit_app.py`")
    return nav, theme_name


def render_kpis(response: AgentResponse | None, agent: PrescriptionAccessAgent) -> None:
    confidence = f"{response.confidence:.0%}" if response else "--"
    evidence_count = str(len(response.sources)) if response else "--"
    guardrail = "Blocked" if response and response.guardrail_reasons else "Passed"
    if response is None:
        guardrail = "Ready"

    cols = st.columns(4)
    with cols[0]:
        confidence_note = confidence_label(response.confidence)[0] if response else "Run a case"
        metric_card("Confidence", confidence, confidence_note)
    with cols[1]:
        metric_card("Evidence", evidence_count, "Retrieved policy snippets")
    with cols[2]:
        metric_card(
            "Vector backend",
            agent.vector_store.backend_name.upper(),
            "Local or FAISS-compatible",
        )
    with cols[3]:
        metric_card("Guardrails", guardrail, "Prompt screening status")


def render_workbench(agent: PrescriptionAccessAgent) -> None:
    if "question" not in st.session_state:
        st.session_state["question"] = DEFAULT_QUESTION

    response: AgentResponse | None = st.session_state.get("last_response")
    render_kpis(response, agent)
    st.write("")
    badge_row(infer_case_badges(response))

    left, right = st.columns([1.38, 1], gap="large")
    with left:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Case workspace</div>', unsafe_allow_html=True)
        patient_id = st.text_input("Patient ID", value="demo-patient-001")
        meta_cols = st.columns(3)
        with meta_cols[0]:
            therapy_area = st.selectbox(
                "Therapy area",
                ["Respiratory", "Metabolic", "Specialty", "General access"],
            )
        with meta_cols[1]:
            payer_type = st.selectbox(
                "Payer type",
                ["Commercial", "Medicare", "Medicaid", "Unknown"],
            )
        with meta_cols[2]:
            urgency = st.selectbox("Urgency", ["Standard", "Expedited", "Appeal risk"])

        question = st.text_area(
            "Patient or care team question",
            height=142,
            key="question",
            help="Ask about coverage, PA evidence, copay support, or alternatives.",
        )

        run = st.button("Run access intelligence", type="primary", use_container_width=True)
        st.markdown("</div>", unsafe_allow_html=True)

        if run:
            context = {
                "patient_id": patient_id,
                "therapy_area": therapy_area,
                "payer_type": payer_type,
                "urgency": urgency,
                "question": question,
            }
            st.session_state["last_case_context"] = context
            with st.spinner("Screening, retrieving policy evidence, and preparing trace..."):
                st.session_state["last_response"] = agent.answer(question, patient_id=patient_id)
            st.rerun()

    with right:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Workflow timeline</div>', unsafe_allow_html=True)
        render_timeline(response)
        st.write("")
        st.markdown('<div class="panel-title">Care-team next steps</div>', unsafe_allow_html=True)
        for step in next_steps(response):
            st.markdown(f"- {step}")
        st.markdown("</div>", unsafe_allow_html=True)

    st.write("")
    response = st.session_state.get("last_response")
    context = st.session_state.get("last_case_context", {})
    if response is None:
        render_empty_state(
            "No case has been run yet",
            "Choose a suggested prompt or enter a coverage question to activate "
            "the command center.",
        )
        return

    output_left, output_right = st.columns([1.38, 1], gap="large")
    with output_left:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown(
            '<div class="panel-title">Access intelligence answer</div>',
            unsafe_allow_html=True,
        )
        st.markdown('<div class="answer-box">', unsafe_allow_html=True)
        st.markdown(response.answer)
        st.markdown("</div>", unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)

    with output_right:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Audit and export</div>', unsafe_allow_html=True)
        st.write(f"Audit ID: `{response.audit_id}`")
        st.write(f"Vector backend: `{response.vector_backend}`")
        if response.guardrail_reasons:
            st.error(", ".join(response.guardrail_reasons))
        else:
            st.success("Prompt injection screen passed.")
        summary = build_case_summary(
            response=response,
            question=context.get("question", st.session_state.get("question", "")),
            patient_id=context.get("patient_id", "demo-patient-001"),
            therapy_area=context.get("therapy_area", "General access"),
            payer_type=context.get("payer_type", "Commercial"),
            urgency=context.get("urgency", "Standard"),
        )
        st.download_button(
            "Download case summary",
            data=summary,
            file_name="prescription_access_case_summary.md",
            mime="text/markdown",
            use_container_width=True,
        )
        st.markdown("</div>", unsafe_allow_html=True)


def render_evidence_view(settings_path: Path) -> None:
    response: AgentResponse | None = st.session_state.get("last_response")
    st.markdown("### Evidence Intelligence")
    if response:
        for index, source in enumerate(response.sources, start=1):
            render_source_card(source, index)
        if not response.sources:
            render_empty_state("No sources returned", "The guardrail may have blocked retrieval.")
        return

    docs = sorted(settings_path.glob("*.md"))
    if not docs:
        render_empty_state("No policy documents found", "Add markdown policy files to data/docs.")
        return

    for index, doc in enumerate(docs, start=1):
        preview = doc.read_text(encoding="utf-8")[:360].replace("\n", " ")
        render_source_card(
            {"source": doc.name, "score": "library", "chunk_id": index, "preview": preview},
            index,
        )


def render_deployment_readiness() -> None:
    st.markdown("### Deployment Readiness")
    cols = st.columns(3)
    with cols[0]:
        panel("Streamlit Cloud", "Primary path for the executive demo.")
    with cols[1]:
        panel("FastAPI", "Still available through Docker or any container host.")
    with cols[2]:
        panel("Local fallback AI", "Runs without paid model keys for reliable demos.")

    st.markdown("#### Streamlit Community Cloud")
    st.markdown(
        """
1. Push this project folder to GitHub.
2. Create a new app in Streamlit Community Cloud.
3. Set the main file path to `app/streamlit_app.py`.
4. Keep `requirements.txt` at the repository root.
5. Add secrets only when you want production-like behavior.
        """
    )
    st.code(
        """ANTHROPIC_API_KEY = "your_key_here"
DATABASE_URL = "sqlite:///./data/pharmacy.db"
AUDIT_LOG_PATH = "artifacts/audit.log"
""",
        language="toml",
    )
    st.markdown("#### Local verification")
    st.code(
        """python -m pip install -e .[dev]
python -m pytest
python -m ruff check .
streamlit run app/streamlit_app.py
""",
        language="bash",
    )


def main() -> None:
    settings = get_settings()
    agent = get_agent()
    nav, theme_name = render_sidebar(agent)
    st.markdown(css(THEMES[theme_name]), unsafe_allow_html=True)

    render_hero()

    if nav == "Access Workbench":
        render_workbench(agent)
    elif nav == "Evidence Intelligence":
        render_evidence_view(settings.docs_path)
    else:
        render_deployment_readiness()


if __name__ == "__main__":
    main()

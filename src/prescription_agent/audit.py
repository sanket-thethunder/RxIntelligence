from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def write_audit_event(path: Path, event: dict) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    audit_id = str(uuid4())
    payload = {
        "audit_id": audit_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **event,
    }
    with path.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(payload, sort_keys=True) + "\n")
    return audit_id

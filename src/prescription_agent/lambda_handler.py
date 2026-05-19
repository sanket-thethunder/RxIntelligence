from __future__ import annotations

from mangum import Mangum

from prescription_agent.api.main import app

handler = Mangum(app)

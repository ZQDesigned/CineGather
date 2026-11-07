#!/usr/bin/env python3
"""Server-only maintenance switch. Use sudo; no database/API access required."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["on", "off", "status"])
    parser.add_argument("--file", default="/etc/cinegather/maintenance.json")
    parser.add_argument("--message", default="服务器正在维护，请稍后重试。")
    parser.add_argument("--until", help="Estimated recovery in ISO 8601 with timezone")
    args = parser.parse_args()
    state = Path(args.file)
    if args.action == "off":
        state.unlink(missing_ok=True)
    elif args.action == "on":
        message = args.message.strip()
        if not message or len(message) > 500:
            parser.error("message must contain 1–500 characters")
        notice = {"code": "SERVER_MAINTENANCE", "message": message}
        if args.until:
            try:
                until = datetime.fromisoformat(args.until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    raise ValueError("Timezone required")
                notice["expectedResumeAt"] = until.astimezone(timezone.utc).isoformat()
            except ValueError:
                parser.error("until must be an ISO 8601 date with timezone")
        state.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", dir=state.parent, delete=False
            ) as f:
                temporary = f.name
                json.dump(notice, f, ensure_ascii=False)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
                os.fchmod(f.fileno(), 0o644)
            os.replace(temporary, state)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
    print(json.dumps({"maintenance": state.exists()}, ensure_ascii=False))


if __name__ == "__main__":
    main()

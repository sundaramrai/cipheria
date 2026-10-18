"""Shared audit log entry creation for API routes."""

from fastapi import Request
from sqlalchemy.orm import Session

from database import AuditLog
from limiter import get_client_ip


def log_action(db: Session, user_id, action: str, request: Request) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )

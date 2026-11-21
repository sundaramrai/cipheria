import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000").rstrip("/")
SMTP_HOST = os.getenv("SMTP_HOST")
_smtp_port = os.getenv("SMTP_PORT")
SMTP_PORT = int(_smtp_port) if _smtp_port else 587
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USERNAME
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").lower() == "true"


def build_app_url(path: str) -> str:
    return f"{APP_BASE_URL}{path}"


def send_email(recipient: str, subject: str, text: str) -> bool:
    if not SMTP_HOST:
        logger.warning("SMTP not configured; email was not sent")
        return False

    message = EmailMessage()
    message["From"] = SMTP_FROM
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            if SMTP_STARTTLS:
                server.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(message)
        return True
    except Exception:
        logger.exception("Failed to send email to %s with subject %r", recipient, subject)
        return False

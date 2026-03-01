"""
api/index.py — FastAPI app wrapped with Mangum for Vercel serverless deployment.
Each route in FastAPI maps to a serverless function invocation on Vercel.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from database import create_tables
from routes.auth import router as auth_router
from routes.vault import router as vault_router

# Create tables on cold start (idempotent — safe to run every time)
try:
    create_tables()
except Exception as e:
    print(f"Warning: Could not create tables: {e}")

app = FastAPI(
    title="Cipheria API",
    description="Secure serverless password manager backend",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS — restrict to your frontend domain in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app|chrome-extension://.*|moz-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router, prefix="/api")
app.include_router(vault_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "cipheria-api"}


# Mangum handler — wraps ASGI app for AWS Lambda / Vercel serverless
handler = Mangum(app, lifespan="off")

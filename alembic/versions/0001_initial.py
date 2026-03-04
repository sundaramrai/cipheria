"""initial schema

Revision ID: 0001_initial
Revises: 
Create Date: 2026-03-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True)),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True)),
        sa.Column('master_hint', sa.String(255), nullable=True),
        sa.Column('vault_salt', sa.String(64), nullable=False),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    op.create_table(
        'vault_items',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('category', sa.String(64), default='login'),
        sa.Column('encrypted_data', sa.Text(), nullable=False),
        sa.Column('favicon_url', sa.String(512), nullable=True),
        sa.Column('is_favourite', sa.Boolean(), default=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True)),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True)),
    )
    op.create_index('ix_vault_items_user_id', 'vault_items', ['user_id'])
    op.create_index('ix_vault_items_user_updated', 'vault_items', ['user_id', 'updated_at'])

    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', UUID(as_uuid=True), nullable=False),
        sa.Column('action', sa.String(64), nullable=False),
        sa.Column('ip_address', sa.String(64), nullable=True),
        sa.Column('user_agent', sa.String(512), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True)),
    )
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])

    op.create_table(
        'refresh_tokens',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(255), nullable=False, unique=True),
        sa.Column('expires_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True)),
        sa.Column('revoked', sa.Boolean(), default=False),
    )
    op.create_index('ix_refresh_tokens_user_id', 'refresh_tokens', ['user_id'])

    # pg_trgm for fast ILIKE search on vault item names
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vault_items_name_trgm "
        "ON vault_items USING gin (name gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_vault_items_name_trgm")
    op.drop_table('refresh_tokens')
    op.drop_table('audit_logs')
    op.drop_table('vault_items')
    op.drop_table('users')
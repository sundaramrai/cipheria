"""Record account-scoped import receipts for retry-safe vault restoration."""

import sqlalchemy as sa
from alembic import op

revision = "0008_vault_imports"
down_revision = "0007_remove_favicons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vault_imports",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("operation_id", sa.UUID(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("imported_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "operation_id"),
    )


def downgrade() -> None:
    op.drop_table("vault_imports")

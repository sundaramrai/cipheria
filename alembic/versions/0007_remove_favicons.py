"""Remove plaintext website URLs previously stored for remote favicons."""

import sqlalchemy as sa
from alembic import op

revision = "0007_remove_favicons"
down_revision = "0006_optimize_vault_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("vault_items", "favicon_url")


def downgrade() -> None:
    # Removed URLs cannot be recovered.
    op.add_column("vault_items", sa.Column("favicon_url", sa.String(512), nullable=True))

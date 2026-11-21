"""Version vault items so stale clients cannot overwrite newer data."""

import sqlalchemy as sa
from alembic import op

revision = "0009_vault_revisions"
down_revision = "0008_vault_imports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vault_items", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("vault_items", "revision")

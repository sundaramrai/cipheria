"""Store password-protected vault keys; existing accounts stay in legacy format."""

import sqlalchemy as sa
from alembic import op

revision = "0010_vault_key_envelopes"
down_revision = "0009_vault_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("key_envelope", sa.JSON(), nullable=True))


def downgrade() -> None:
    raise RuntimeError("Restore a complete pre-migration backup to downgrade encrypted vaults")

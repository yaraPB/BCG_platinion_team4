"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-10-17 04:07:29.771944
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('tenants',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('settings', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tenants', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tenants_slug'), ['slug'], unique=True)

    op.create_table('alerts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('source', sa.String(length=200), nullable=False),
    sa.Column('url', sa.String(length=1000), nullable=True),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_sample', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_alerts_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_alerts_tenant_id'), ['tenant_id'], unique=False)

    op.create_table('analyses',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('engine', sa.String(length=20), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=True),
    sa.Column('alert_ids', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('result', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('analyses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_analyses_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_analyses_tenant_id'), ['tenant_id'], unique=False)

    op.create_table('networks',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('document', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'version', name='uq_network_tenant_version')
    )
    with op.batch_alter_table('networks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_networks_tenant_id'), ['tenant_id'], unique=False)

    op.create_table('simulation_runs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('request', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('result', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('runs', sa.Integer(), nullable=False),
    sa.Column('elapsed_ms', sa.Float(), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('simulation_runs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_simulation_runs_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_simulation_runs_tenant_id'), ['tenant_id'], unique=False)

    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('full_name', sa.String(length=200), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)
        batch_op.create_index(batch_op.f('ix_users_tenant_id'), ['tenant_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
    with op.batch_alter_table('simulation_runs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_simulation_runs_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_simulation_runs_created_at'))

    op.drop_table('simulation_runs')
    with op.batch_alter_table('networks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_networks_tenant_id'))

    op.drop_table('networks')
    with op.batch_alter_table('analyses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_analyses_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_analyses_created_at'))

    op.drop_table('analyses')
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_alerts_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_alerts_created_at'))

    op.drop_table('alerts')
    with op.batch_alter_table('tenants', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tenants_slug'))

    op.drop_table('tenants')

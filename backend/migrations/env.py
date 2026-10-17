from __future__ import annotations

from alembic import context
from sqlalchemy import Connection

from app.db.models import Base
from app.db.session import get_engine

target_metadata = Base.metadata


def run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True,
                      compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    with get_engine().connect() as conn:
        run(conn)

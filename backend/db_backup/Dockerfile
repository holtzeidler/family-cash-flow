FROM postgres:17-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-psycopg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/db_backup/backup.py /app/backup.py

ENTRYPOINT []
CMD ["python3", "/app/backup.py"]

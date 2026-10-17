Isi dua file di folder ini sebelum `docker compose -f docker-compose.prod.yml up -d`:

- `postgres_password.txt` - satu baris, password Postgres
- `minio_password.txt` - satu baris, minimal 8 karakter, password MinIO

Generate yang aman dengan: `openssl rand -base64 24`

Folder ini (isinya) sengaja di-.gitignore - jangan pernah commit password asli ke repo.

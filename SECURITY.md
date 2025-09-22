# Security Notes

- Do not commit secrets. Use environment variables; `.env.sample` is placeholders only.
- Use HTTPS in production (behind reverse proxy/ingress).
- All OSB endpoints are protected with Basic Auth; `/health` is public by design.
- Recommended production install: `npm ci --omit=dev` to exclude dev/test packages.
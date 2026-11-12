# Deployment Strategy: Day 1 Self-Hosted Architecture

**Last Updated**: March 21, 2026

---

## The Critical Decision: Don't Rent What You Plan to Own

This document outlines the production-ready, compliant, and cost-effective deployment architecture for SureVax CMS.

**Key Principle**: Use managed services for high-risk infrastructure (database), but maintain control over your application layer.

---

## Why NOT Supabase → Self-Hosted Migration

### The Migration Trap

Many teams think: "Use Supabase to ship fast, then migrate to self-hosted later."

**This is a trap. Here's why:**

1. **Auth Nightmare**
   - Supabase Auth uses customized GoTrue server
   - Password hashes don't port to standard bcrypt
   - Migration = force every user to reset password
   - Terrible UX for doctors and nurses

2. **RLS to App-Level Security Rewrite**
   - Supabase pushes Row Level Security (RLS)
   - If you build queries relying on RLS, then switch to Express
   - You must rewrite your entire security model
   - Every database query needs to be rewritten

3. **Not Just Data Migration**
   - It's a fundamental architectural rewrite
   - Real-time subscriptions work differently
   - Storage API is proprietary
   - 6 months of technical debt in one "migration"

**The Fix**: Build it right from Day 1. With Docker and Drizzle, a basic Express auth API takes one weekend, not weeks.

---

## Why NOT Raw VPS for Healthcare Data

### The Compliance Trap

"Just use a $10 Hetzner VPS and save money!"

**This is a legal liability. Here's why:**

Under the Philippine Data Privacy Act of 2012 (and similar global health privacy laws), you need:

1. **Encrypted storage at rest** (not just standard Postgres volumes)
2. **Strict network isolation** (VPCs) and intrusion detection
3. **Immutable audit logs** for every patient record access
4. **Automated, tested disaster recovery** protocols

**A raw VPS with bash script backups to Backblaze B2 is not compliant.**

**The Fix**: Use managed database providers (DigitalOcean Managed PostgreSQL, AWS RDS) for the data layer, combined with a VPS for your API.

---

## The Day 1 Architecture: Managed Data + Unmanaged Compute

### The Hybrid Model

**Principle**: Offload high-risk database management to cloud providers, run your API cheaply on a VPS.

```
┌─────────────────────────────────────────┐
│   Frontend: Cloudflare Pages (Free)     │
│   - React SPA                           │
│   - Global CDN                          │
│   - Zero cold starts                    │
└─────────────────────────────────────────┘
                    ↓ HTTPS
┌─────────────────────────────────────────┐
│   API: Hetzner VPS ($6-10/month)        │
│   - Node.js/Express                     │
│   - Standard JWT auth                   │
│   - No serverless cold starts           │
│   - Full control                        │
└─────────────────────────────────────────┘
                    ↓ VPC
┌─────────────────────────────────────────┐
│   Database: Managed PostgreSQL ($15)    │
│   - DigitalOcean or AWS RDS             │
│   - Encrypted at rest                   │
│   - Automated backups                   │
│   - Point-in-time recovery              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   Storage: Cloudflare R2 (Free)         │
│   - S3-compatible API                   │
│   - Zero egress fees                    │
│   - Patient uploads, vaccine cards      │
└─────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Frontend: Cloudflare Pages

**Why NOT Vercel:**

- Vercel's Terms of Service prohibit commercial use on free tier
- Vercel Pro = $20/user/month

**Why Cloudflare Pages:**

- ✅ Free for commercial use
- ✅ Unlimited bandwidth
- ✅ Global CDN (blazing fast)
- ✅ Integrates with React/Vite SPA
- ✅ Auto-deploy from GitHub

**Cost**: $0/month

**Setup:**

```bash
# 1. Push to GitHub
git push origin main

# 2. Connect to Cloudflare Pages
# Go to pages.cloudflare.com
# Connect GitHub repo
# Build command: npm run build
# Output directory: dist

# Done!
```

---

### 2. API: Hetzner VPS (Unmanaged Compute)

**Why VPS instead of serverless:**

- ✅ No cold starts (instant API responses for nurses)
- ✅ Predictable pricing
- ✅ Full control over environment
- ✅ Can run long-running processes
- ✅ WebSocket support (if needed)

**Why Hetzner:**

- Best price/performance ratio
- Located in Germany (GDPR compliant)
- Excellent uptime

**Recommended Specs:**

- CPX11: 2 vCPU, 2GB RAM, 40GB SSD = €4.50/month (~$5)
- CPX21: 3 vCPU, 4GB RAM, 80GB SSD = €8.50/month (~$9)

**Cost**: $6-10/month

**Setup:**

```bash
# 1. Create VPS at Hetzner.com
# 2. SSH into server
ssh root@your-server-ip

# 3. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# 4. Clone repo and deploy
git clone https://github.com/your-repo.git
cd your-repo/backend
docker-compose up -d
```

---

### 3. Database: DigitalOcean Managed PostgreSQL

**Why NOT self-hosted database:**

- Health data = high risk
- Need automated backups
- Need point-in-time recovery
- Need encryption at rest
- Need compliance certifications

**Why DigitalOcean Managed PostgreSQL:**

- ✅ Automatic daily backups
- ✅ Point-in-time recovery (restore to exact minute)
- ✅ Hardware-level encryption at rest
- ✅ VPC support (database only accessible from your VPS)
- ✅ Singapore region (closest to Manila)
- ✅ SOC 2 Type II certified

**Recommended Specs:**

- Basic node: 1GB RAM, 10GB storage = $15/month
- Scales up as you grow

**Cost**: $15/month

**Alternative**: AWS RDS PostgreSQL (similar pricing, more regions)

**Setup:**

```bash
# 1. Create Managed Database at DigitalOcean
# 2. Configure VPC (only allow connections from your VPS IP)
# 3. Get connection string
# 4. Add to your API environment variables

DATABASE_URL=postgresql://user:pass@db-host:25060/surevax?sslmode=require
```

---

### 4. Storage: Cloudflare R2

**Why NOT local VPS storage:**

- Limited disk space
- No CDN for fast delivery
- Backup complexity

**Why Cloudflare R2:**

- ✅ S3-compatible API (use standard AWS SDKs)
- ✅ Zero egress fees (unlike AWS S3)
- ✅ 10GB free tier
- ✅ Global CDN
- ✅ $0.015/GB after free tier

**Cost**: $0/month (under 10GB)

**Setup:**

```bash
# 1. Create R2 bucket at Cloudflare
# 2. Get API credentials
# 3. Use in your Node.js API

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  endpoint: 'https://your-account.r2.cloudflarestorage.com',
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

// Upload file
await s3.send(new PutObjectCommand({
  Bucket: 'surevax-files',
  Key: filename,
  Body: fileBuffer,
}))
```

---

### 5. Security: Cloudflare WAF (Free)

**Non-Negotiables:**

1. **Web Application Firewall (WAF)**
   - Put your API and Frontend behind Cloudflare proxy
   - Absorbs DDoS attacks
   - Blocks malicious traffic before it hits your server

2. **VPC / Trusted Sources**
   - Configure Managed Database to only accept connections from your VPS IP
   - Database never exposed to public internet

3. **SSL/TLS**
   - Cloudflare provides free SSL certificates
   - Automatic renewal

**Cost**: $0/month

---

## Total Cost Breakdown

### Day 1 (0-100 users)

| Component    | Provider             | Purpose           | Cost          |
| ------------ | -------------------- | ----------------- | ------------- |
| Frontend CDN | Cloudflare Pages     | React SPA hosting | $0            |
| Backend API  | Hetzner CPX11        | Node.js Express   | $5            |
| Database     | DigitalOcean Managed | PostgreSQL        | $15           |
| Storage      | Cloudflare R2        | Patient uploads   | $0            |
| Security     | Cloudflare Free      | WAF, SSL, DNS     | $0            |
| **Total**    |                      |                   | **$20/month** |

### Growth (100-1,000 users)

| Component    | Provider           | Purpose           | Cost          |
| ------------ | ------------------ | ----------------- | ------------- |
| Frontend CDN | Cloudflare Pages   | React SPA hosting | $0            |
| Backend API  | Hetzner CPX21      | Node.js Express   | $9            |
| Database     | DigitalOcean (2GB) | PostgreSQL        | $30           |
| Storage      | Cloudflare R2      | Patient uploads   | $1            |
| Security     | Cloudflare Free    | WAF, SSL, DNS     | $0            |
| **Total**    |                    |                   | **$40/month** |

### Scale (1,000-10,000 users)

| Component    | Provider           | Purpose           | Cost          |
| ------------ | ------------------ | ----------------- | ------------- |
| Frontend CDN | Cloudflare Pages   | React SPA hosting | $0            |
| Backend API  | Hetzner CPX31      | Node.js Express   | $17           |
| Database     | DigitalOcean (4GB) | PostgreSQL        | $60           |
| Storage      | Cloudflare R2      | Patient uploads   | $5            |
| Security     | Cloudflare Free    | WAF, SSL, DNS     | $0            |
| Monitoring   | Uptime Kuma        | Self-hosted       | $0            |
| **Total**    |                    |                   | **$82/month** |

---

## Cost Comparison: This vs Supabase + Vercel

### Scenario: 1,000 Active Users

| Item             | Supabase + Vercel      | This Architecture |
| ---------------- | ---------------------- | ----------------- |
| Database (10GB)  | $25/month              | $15/month         |
| API Hosting      | $20/month (Vercel Pro) | $9/month          |
| Frontend Hosting | Included               | $0/month          |
| Storage (5GB)    | Included               | $0/month          |
| **Total**        | **$45/month**          | **$24/month**     |
| **Annual**       | **$540**               | **$288**          |
| **Savings**      | -                      | **$252/year**     |

### Scenario: 10,000 Active Users

| Item             | Supabase + Vercel | This Architecture |
| ---------------- | ----------------- | ----------------- |
| Database (50GB)  | $599/month        | $60/month         |
| API Hosting      | $20/month         | $17/month         |
| Frontend Hosting | Included          | $0/month          |
| Storage (20GB)   | Extra $50/month   | $5/month          |
| **Total**        | **$669/month**    | **$82/month**     |
| **Annual**       | **$8,028**        | **$984**          |
| **Savings**      | -                 | **$7,044/year**   |

---

## Authentication: Standard JWT + bcrypt

**Why NOT Supabase Auth:**

- Vendor lock-in
- Custom password hashing (hard to migrate)
- Less control

**Why Standard JWT + bcrypt:**

- ✅ Industry standard
- ✅ Easy to migrate
- ✅ Full control
- ✅ Works everywhere

**Implementation** (takes 1 weekend):

```ts
// auth.ts
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { db } from './db'
import { users } from './schema'
import { eq } from 'drizzle-orm'

// Register
export async function register(email: string, password: string) {
  const hashedPassword = await bcrypt.hash(password, 10)
  const [user] = await db
    .insert(users)
    .values({
      email,
      password: hashedPassword,
    })
    .returning()

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })

  return { user, token }
}

// Login
export async function login(email: string, password: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  })

  if (!user) throw new Error('Invalid credentials')

  const isValid = await bcrypt.compare(password, user.password)
  if (!isValid) throw new Error('Invalid credentials')

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })

  return { user, token }
}

// Middleware
export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!)
    req.userId = decoded.userId
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
```

**Usage:**

```ts
// Protected route
app.get('/api/patients', authMiddleware, async (req, res) => {
  const patients = await db.query.patients.findMany({
    where: eq(patients.clinicId, req.user.clinicId),
  })
  res.json(patients)
})
```

---

## Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Backend API
  api:
    build: .
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY}
      NODE_ENV: production
    restart: unless-stopped
    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '3'

  # Nginx Reverse Proxy
  nginx:
    image: nginx:alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - api
    restart: unless-stopped
```

---

## Nginx Configuration

```nginx
# nginx.conf
events {
    worker_connections 1024;
}

http {
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name api.surevax.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        server_name api.surevax.com;

        # SSL certificates (Let's Encrypt)
        ssl_certificate /etc/letsencrypt/live/api.surevax.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.surevax.com/privkey.pem;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        # API
        location / {
            limit_req zone=api burst=20 nodelay;

            proxy_pass http://api:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

---

## Deployment Checklist

### Initial Setup (One-Time)

```bash
# 1. Create Hetzner VPS
# - Choose CPX11 or CPX21
# - Select location (Germany recommended)
# - Add SSH key

# 2. Create DigitalOcean Managed Database
# - Choose Basic node ($15/month)
# - Select Singapore region
# - Configure VPC (add your VPS IP to trusted sources)

# 3. Create Cloudflare R2 bucket
# - Go to Cloudflare dashboard
# - Create R2 bucket
# - Generate API credentials

# 4. SSH into VPS
ssh root@your-vps-ip

# 5. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# 6. Install Docker Compose
apt-get update
apt-get install docker-compose-plugin

# 7. Clone repository
git clone https://github.com/your-org/surevax.git
cd surevax/backend

# 8. Set up environment variables
cp .env.example .env
nano .env
# Add: DATABASE_URL, JWT_SECRET, R2 credentials

# 9. Deploy
docker-compose up -d

# 10. Set up SSL with Let's Encrypt
apt-get install certbot python3-certbot-nginx
certbot --nginx -d api.surevax.com

# 11. Set up auto-renewal
certbot renew --dry-run

# Done!
```

### Continuous Deployment

```bash
# On your local machine, set up GitHub Actions
# .github/workflows/deploy.yml

name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: root
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /root/surevax/backend
            git pull origin main
            docker-compose down
            docker-compose up -d --build
```

---

## Backup Strategy

### Automated Daily Backups

**DigitalOcean Managed Database:**

- ✅ Automatic daily backups (included)
- ✅ 7-day retention
- ✅ Point-in-time recovery

**Additional Off-Site Backup** (recommended):

```bash
#!/bin/bash
# /root/backup.sh

# Backup database to local file
pg_dump $DATABASE_URL > /root/backups/backup-$(date +%Y%m%d).sql

# Upload to Cloudflare R2 (using AWS CLI)
aws s3 cp /root/backups/backup-$(date +%Y%m%d).sql \
  s3://surevax-backups/ \
  --endpoint-url https://your-account.r2.cloudflarestorage.com

# Keep only last 30 days locally
find /root/backups -name "backup-*.sql" -mtime +30 -delete

echo "Backup completed: $(date)"
```

**Set up cron job:**

```bash
# Run daily at 2 AM
crontab -e

# Add this line:
0 2 * * * /root/backup.sh >> /var/log/backup.log 2>&1
```

**Cost**: $0 (R2 free tier covers backups)

---

## Monitoring

### Uptime Kuma (Self-Hosted, Free)

```bash
# Install on your VPS
docker run -d \
  --name uptime-kuma \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --restart=unless-stopped \
  louislam/uptime-kuma:1

# Access at: http://your-vps-ip:3001
# Set up monitors for:
# - API health endpoint
# - Database connection
# - Frontend (Cloudflare Pages)
```

**Features:**

- Uptime monitoring
- Response time tracking
- Email/Slack notifications
- Status page

**Cost**: $0

---

## Scaling Path

### Phase 1: Single VPS (0-1,000 users)

- Cost: $24/month
- Setup: As described above

### Phase 2: Vertical Scaling (1,000-5,000 users)

- Upgrade VPS to CPX31 (4 vCPU, 8GB RAM)
- Upgrade database to 4GB node
- Cost: $82/month

### Phase 3: Horizontal Scaling (5,000-20,000 users)

- Add load balancer (Hetzner LB: $6/month)
- Add second API server
- Add database read replica
- Cost: $150/month

### Phase 4: Multi-Region (20,000+ users)

- Deploy to multiple regions
- Use Cloudflare for global routing
- Cost: $300-500/month

---

## Why This Beats Supabase + Vercel

### 1. Zero Migration Debt

- Standard tools (Express, PostgreSQL, S3 API)
- When you scale, just upgrade instance sizes
- No code rewrites

### 2. Instant Compliance Baseline

- Data encrypted at rest (managed database)
- Automated backups off-site
- VPC isolation
- SOC 2 certified providers

### 3. Maximum Speed

- No serverless cold starts
- Instant API responses for nurses
- Consistent performance

### 4. Cost Savings

- Year 1: Save $252
- Year 2: Save $2,000+
- Year 3: Save $7,000+

### 5. Full Control

- Can optimize queries
- Can add custom features
- Can migrate anywhere
- No vendor lock-in

---

## Summary

**Day 1 Architecture:**

- Frontend: Cloudflare Pages ($0)
- API: Hetzner VPS ($6-10)
- Database: DigitalOcean Managed PostgreSQL ($15)
- Storage: Cloudflare R2 ($0)
- Security: Cloudflare WAF ($0)

**Total: $21/month**

**Benefits:**

- ✅ Production-ready from Day 1
- ✅ Healthcare compliant
- ✅ No migration debt
- ✅ Scales to 10,000+ users
- ✅ Saves $7,000+/year at scale

**Next Steps:**

1. Set up Hetzner VPS
2. Set up DigitalOcean Managed Database
3. Deploy API with Docker Compose
4. Deploy frontend to Cloudflare Pages
5. Configure Cloudflare WAF
6. Set up automated backups
7. Set up monitoring

Want me to generate the exact Drizzle ORM schema with multi-tenant Row Level Security, or the complete Docker setup scripts?

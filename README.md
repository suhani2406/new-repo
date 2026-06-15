# Job Apply Gmail MVP

This project demonstrates API 1 safely:
- Filter job posts from CSV/pasted sample data by keywords and last 24 hours.
- Extract recruiter email IDs from post text.
- Send/draft a formal Gmail application email with resume attachment.

> Note: LinkedIn automated login/scraping is intentionally not implemented because it may violate platform rules and trigger account restrictions. For demo, export/copy job-post data into CSV.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Open: `http://localhost:5000`

## Google Cloud Setup
1. Go to Google Cloud Console.
2. Create project.
3. Enable Gmail API.
4. OAuth Consent Screen → External → add test user = your Gmail.
5. Credentials → Create OAuth Client ID → Web Application.
6. Add Authorized redirect URI:
   `http://localhost:5000/auth/google/callback`
7. Copy Client ID and Secret into `.env`.

## CSV format
Use `sample_posts.csv` format:

```csv
title,postText,postedAt,sourceUrl
Java Developer Contract,"Hiring Java Developer Contract role. Send resume to recruiter@example.com",2026-06-13T09:00:00+05:30,https://linkedin.com/example
```

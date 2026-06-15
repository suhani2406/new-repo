require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

let oauthTokens = null;
let lastResumePath = null;
let lastResumeOriginalName = null;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose']
  });
}

function setCredentials() {
  if (!oauthTokens) throw new Error('Gmail is not connected. Please login first.');
  oauth2Client.setCredentials(oauthTokens);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function extractEmails(text = '') {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches.map(email => email.toLowerCase()))];
}

function isWithinLast24Hours(postedAt) {
  const postedDate = new Date(postedAt);
  if (Number.isNaN(postedDate.getTime())) return false;
  const now = new Date();
  const diffMs = now - postedDate;
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

function matchesKeywords(post, keywords = []) {
  const combined = `${post.title || ''} ${post.postText || ''}`.toLowerCase();
  return keywords.every(keyword => combined.includes(keyword.toLowerCase().trim()));
}

function buildApplicationEmail({ candidateName, candidatePhone, candidateEmail, candidateLinkedIn, jobTitle, sourceUrl }) {
  return `Dear Recruiter,

I hope you are doing well.

I am writing to apply for the ${jobTitle || 'open developer'} role that I came across recently. I have hands-on experience with full-stack/backend development, REST APIs, authentication, databases, and deployment.

Please find my resume attached for your review. I would be grateful for the opportunity to discuss how my skills match the role requirements.

Candidate Details:
Name: ${candidateName}
Email: ${candidateEmail}
Phone: ${candidatePhone}
LinkedIn: ${candidateLinkedIn}
Job Source: ${sourceUrl || 'N/A'}

Thank you for your time and consideration.

Sincerely,
${candidateName}`;
}

function makeRawEmail({ to, subject, body, attachmentPath, attachmentName }) {
  const boundary = `boundary_${Date.now()}`;
  const attachment = attachmentPath ? fs.readFileSync(attachmentPath).toString('base64') : null;

  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    ''
  ];

  if (attachment) {
    lines.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachmentName || 'resume.pdf'}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachmentName || 'resume.pdf'}"`,
      '',
      attachment,
      ''
    );
  }

  lines.push(`--${boundary}--`);

  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

app.get('/auth/google', (req, res) => {
  res.redirect(getAuthUrl());
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauthTokens = tokens;
    res.send('<h2>Gmail connected successfully ✅</h2><a href="/">Go back to app</a>');
  } catch (error) {
    res.status(500).send(`Gmail auth failed: ${error.message}`);
  }
});

app.post('/api/upload-resume', upload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Resume file is required.' });
  lastResumePath = req.file.path;
  lastResumeOriginalName = req.file.originalname;
  res.json({ message: 'Resume uploaded successfully.', filename: lastResumeOriginalName });
});

app.post('/api/find-recruiters', upload.single('csv'), (req, res) => {
  try {
    const keywords = (req.body.keywords || 'Java Developer,Contract')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    if (!req.file) return res.status(400).json({ error: 'CSV file is required.' });

    const csvText = fs.readFileSync(req.file.path, 'utf8');
    const records = parse(csvText, { columns: true, skip_empty_lines: true });

    const results = records
      .filter(post => isWithinLast24Hours(post.postedAt))
      .filter(post => matchesKeywords(post, keywords))
      .flatMap(post => extractEmails(post.postText).map(email => ({
        recruiterEmail: email,
        title: post.title,
        postedAt: post.postedAt,
        sourceUrl: post.sourceUrl,
        preview: post.postText.slice(0, 180)
      })));

    res.json({ keywords, count: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/send-application', async (req, res) => {
  try {
    const gmail = setCredentials();
    const {
      recruiterEmail,
      jobTitle,
      sourceUrl,
      mode = 'draft'
    } = req.body;

    if (!recruiterEmail) return res.status(400).json({ error: 'Recruiter email is required.' });

    const candidateName = process.env.CANDIDATE_NAME || 'Candidate Name';
    const candidatePhone = process.env.CANDIDATE_PHONE || 'Phone Number';
    const candidateEmail = process.env.CANDIDATE_EMAIL || 'candidate@gmail.com';
    const candidateLinkedIn = process.env.CANDIDATE_LINKEDIN || 'LinkedIn URL';

    const subject = `Application for ${jobTitle || 'Developer Role'} - ${candidateName}`;
    const body = buildApplicationEmail({ candidateName, candidatePhone, candidateEmail, candidateLinkedIn, jobTitle, sourceUrl });
    const raw = makeRawEmail({
      to: recruiterEmail,
      subject,
      body,
      attachmentPath: lastResumePath,
      attachmentName: lastResumeOriginalName
    });

    if (mode === 'send') {
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return res.json({ message: 'Email sent successfully.', id: sent.data.id });
    }

    const draft = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    res.json({ message: 'Draft created successfully.', id: draft.data.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

# Aarisha Fashion Messenger AI — Backend Starter

এই প্রজেক্টটি Meta Messenger Webhook-এর প্রাথমিক Node.js সার্ভার। এটি:
- Meta-এর GET webhook verification request যাচাই করে
- POST webhook-এর `X-Hub-Signature-256` যাচাই করে
- `messages` ইভেন্টে কাস্টমারের লেখা গ্রহণ করে
- OpenAI API দিয়ে বাংলা উত্তর তৈরি করে
- Meta Graph API দিয়ে Page-এর Messenger-এ উত্তর পাঠায়

## গুরুত্বপূর্ণ সীমাবদ্ধতা
এটি প্রথম ধাপের starter backend; এখনো পণ্যের ক্যাটালগ, অর্ডার ডেটাবেস, অ্যাডমিন ড্যাশবোর্ড, পেমেন্ট বা স্টক ম্যানেজমেন্ট নেই। AI-কে কোনো দাম/স্টক বানিয়ে বলতে নিষেধ করা হয়েছে। এগুলো পরের ধাপে যুক্ত করতে হবে।

## Render-এ Deploy করার জন্য
1. এই ZIP extract করুন।
2. ফাইলগুলো একটি private GitHub repository-তে upload করুন।
3. Render Dashboard → New → Web Service → ওই repository Connect করুন।
4. Runtime: Node; Build Command: `npm install`; Start Command: `npm start`.
5. Deploy হওয়ার পর Render URL হবে `https://YOUR-SERVICE.onrender.com`।
6. Render → Service → Environment-এ `.env.example`-এর ভ্যারিয়েবলগুলো আলাদা Environment Variable হিসেবে দিন।
7. `VERIFY_TOKEN`-এ নিজের তৈরি করা দীর্ঘ random secret দিন। একই secret Meta webhook form-এ দিতে হবে।
8. `META_APP_SECRET`, `PAGE_ACCESS_TOKEN`, `OPENAI_API_KEY` কেবল Render Environment-এ দিন; কখনো Messenger/chat বা public GitHub-এ দেবেন না।

## Meta-তে Webhook
Callback URL: `https://YOUR-SERVICE.onrender.com/webhook`
Verify Token: Render-এ দেওয়া একই `VERIFY_TOKEN`
Webhook fields: `messages`; চাইলে `messaging_postbacks` এবং `message_reads`।

Webhook verification সফল হওয়ার পর Page-টিকে app-এর webhook-এ subscribe করতে হবে। Page access token-এর জন্য `pages_messaging` এবং Page-এ যথাযথ messaging task/permission দরকার। App Review/public access আলাদা ধাপ।

## নিরাপত্তা
- `.env` ফাইল GitHub-এ upload করবেন না।
- Page Access Token, App Secret, OpenAI API Key কাউকে পাঠাবেন না।
- কোনো credential প্রকাশ হয়ে গেলে সংশ্লিষ্ট Dashboard থেকে rotate/regenerate করুন।
- Meta App-এর Standard Access অবস্থায় সাধারণত App-এর Admin/Developer/Tester অ্যাকাউন্ট দিয়েই পরীক্ষা করা যায়; public customer-দের জন্য App Review/প্রয়োজনীয় access লাগতে পারে।

## Local run (ঐচ্ছিক)
```bash
npm install
cp .env.example .env
# .env-এ নিজের secret বসান
npm start
```
